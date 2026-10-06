import { adaptadorGemini } from './gemini';
import type { EventoAgente, ParametrosExecucao } from './tipos';

const PARAMETROS: ParametrosExecucao = {
  pasta: '/dados/conversas/c1',
  pastaExecucao: '/dados/execucoes/e1',
  prompt: 'Quanto gastei?',
  instrucoes: 'Você é o assistente do Fluxo.',
  modelo: null,
  sessaoId: null,
  mcp: {
    nome: 'fluxo', comando: '/usr/bin/node', args: ['/app/ponte.js'], env: { FLUXO_PONTE_URL: 'http://127.0.0.1:8778' },
    segredo: { variavel: 'FLUXO_PONTE_ACESSO', valor: 'segredo-da-ponte' },
  },
  imagens: [],
};

/** Linhas no formato do `gemini -p "" -o stream-json` (0.62.x). */
const L = {
  init: JSON.stringify({ type: 'init', timestamp: '2026-10-01T12:00:00.000Z', session_id: 'b6f4c1de-0000-4000-8000-000000000001', model: 'gemini-2.5-pro' }),
  eco: JSON.stringify({ type: 'message', timestamp: 't', role: 'user', content: 'Quanto gastei?' }),
  texto: (conteudo: string) => JSON.stringify({ type: 'message', timestamp: 't', role: 'assistant', content: conteudo, delta: true }),
  ferramenta: (nome = 'mcp_fluxo_resumo_do_mes', id = 'mcp_fluxo_resumo_do_mes-1') =>
    JSON.stringify({ type: 'tool_use', timestamp: 't', tool_name: nome, tool_id: id, parameters: { mes: '2026-09' } }),
  retorno: (extra: Record<string, unknown>, id = 'mcp_fluxo_resumo_do_mes-1') =>
    JSON.stringify({ type: 'tool_result', timestamp: 't', tool_id: id, ...extra }),
  aviso: (mensagem: string, severity = 'warning') => JSON.stringify({ type: 'error', timestamp: 't', severity, message: mensagem }),
  resultado: (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'result', timestamp: 't', status: 'success',
      stats: { total_tokens: 1350, input_tokens: 1200, output_tokens: 150, cached: 300, input: 900, duration_ms: 5400, tool_calls: 1, models: {} },
      ...extra,
    }),
};

function interpretar(linhas: string[]): EventoAgente[] {
  const interprete = adaptadorGemini.novoInterprete();
  return linhas.flatMap((l) => interprete(l));
}

const textoDe = (eventos: EventoAgente[]) =>
  eventos.filter((e): e is Extract<EventoAgente, { tipo: 'texto' }> => e.tipo === 'texto').map((e) => e.delta).join('');

const valorDe = (args: string[], opcao: string) => args[args.indexOf(opcao) + 1];

describe('adaptadorGemini.montar', () => {
  it('roda travado: sem extensões, só o MCP do Fluxo, política de administrador', () => {
    const { args } = adaptadorGemini.montar(PARAMETROS);
    expect(valorDe(args, '-p')).toBe('');
    expect(valorDe(args, '-o')).toBe('stream-json');
    expect(args).toContain('--skip-trust');
    expect(valorDe(args, '-e')).toBe('none');
    expect(valorDe(args, '--allowed-mcp-server-names')).toBe('fluxo');
    expect(valorDe(args, '--admin-policy')).toBe('/dados/execucoes/e1/politica-gemini.toml');
  });

  it('nunca aprova tudo sozinho', () => {
    const { args } = adaptadorGemini.montar({ ...PARAMETROS, sessaoId: 's', modelo: 'pro' });
    for (const proibida of ['-y', '--yolo', '--approval-mode', '--allowed-tools', '--raw-output', '--sandbox']) {
      expect(args).not.toContain(proibida);
    }
    expect(args.join(' ')).not.toMatch(/yolo|auto_edit|dangerously/);
  });

  it('o token da ponte só vai pelo ambiente: nunca na linha de comando nem em arquivo', () => {
    const { args, arquivos, env } = adaptadorGemini.montar(PARAMETROS);
    expect(args.join(' ')).not.toContain('segredo-da-ponte');
    expect(arquivos.every((a) => !a.conteudo.includes('segredo-da-ponte'))).toBe(true);
    expect(env).toEqual({ FLUXO_PONTE_ACESSO: 'segredo-da-ponte' });
  });

  it('não põe o prompt na linha de comando', () => {
    expect(adaptadorGemini.montar(PARAMETROS).args.join(' ')).not.toContain('Quanto gastei');
  });

  it('grava as configurações do espaço de trabalho com o MCP, que lê o token do ambiente', () => {
    const { arquivos } = adaptadorGemini.montar(PARAMETROS);
    const config = arquivos.find((a) => a.caminho === '/dados/conversas/c1/.gemini/settings.json');
    expect(JSON.parse(config!.conteudo)).toEqual({
      mcpServers: {
        fluxo: {
          command: '/usr/bin/node',
          args: ['/app/ponte.js'],
          env: { FLUXO_PONTE_URL: 'http://127.0.0.1:8778', FLUXO_PONTE_ACESSO: '$FLUXO_PONTE_ACESSO' },
          trust: true,
          timeout: 200000,
        },
      },
      general: { sessionRetention: { enabled: false } },
      skills: { enabled: false },
      hooksConfig: { enabled: false },
    });
    expect(config!.conteudo).not.toMatch(/"core"|"exclude"/);
  });

  it('cria .env vazios na pasta da conversa para o Gemini não subir até o .env do projeto', () => {
    const { arquivos } = adaptadorGemini.montar(PARAMETROS);
    expect(arquivos).toContainEqual({ caminho: '/dados/conversas/c1/.env', conteudo: '' });
    expect(arquivos).toContainEqual({ caminho: '/dados/conversas/c1/.gemini/.env', conteudo: '' });
  });

  it('as instruções vão para o GEMINI.md da pasta da conversa', () => {
    const { arquivos } = adaptadorGemini.montar(PARAMETROS);
    expect(arquivos).toContainEqual({ caminho: '/dados/conversas/c1/GEMINI.md', conteudo: 'Você é o assistente do Fluxo.' });
  });

  it('a política nega tudo e libera só o MCP do Fluxo e a leitura de arquivos', () => {
    const { args, arquivos } = adaptadorGemini.montar(PARAMETROS);
    const politica = arquivos.find((a) => a.caminho === valorDe(args, '--admin-policy'))!.conteudo;
    const regras = politica.split('[[rule]]').slice(1).map((r) => r.trim());
    expect(regras).toHaveLength(4);
    expect(regras[0]).toMatch(/toolName = "\*"\ndecision = "deny"\npriority = 100\ndenyMessage = ".+"/);
    expect(regras[1]).toBe('mcpName = "fluxo"\ndecision = "allow"\npriority = 200');
    expect(regras[2]).toBe('toolName = "read_file"\ndecision = "allow"\npriority = 200');
    expect(regras[3]).toBe('toolName = "read_many_files"\ndecision = "allow"\npriority = 200');
  });

  it('usa o nome configurado do servidor MCP em todo lugar', () => {
    const p = { ...PARAMETROS, mcp: { ...PARAMETROS.mcp, nome: 'financas' } };
    const { args, arquivos } = adaptadorGemini.montar(p);
    expect(valorDe(args, '--allowed-mcp-server-names')).toBe('financas');
    expect(arquivos.find((a) => a.caminho.endsWith('politica-gemini.toml'))!.conteudo).toContain('mcpName = "financas"');
    expect(Object.keys(JSON.parse(arquivos.find((a) => a.caminho.endsWith('settings.json'))!.conteudo).mcpServers)).toEqual(['financas']);
  });

  it('continua a sessão anterior e usa o modelo escolhido', () => {
    const { args } = adaptadorGemini.montar({ ...PARAMETROS, sessaoId: 'b6f4c1de-0000-4000-8000-000000000009', modelo: 'pro' });
    expect(valorDe(args, '--resume')).toBe('b6f4c1de-0000-4000-8000-000000000009');
    expect(valorDe(args, '-m')).toBe('pro');
    expect(args).not.toContain('--session-id');
  });

  it('sem sessão e sem modelo, não passa --resume, --session-id nem -m', () => {
    const { args } = adaptadorGemini.montar(PARAMETROS);
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--session-id');
    expect(args).not.toContain('-m');
  });

  it('o prompt simples vai como está pela entrada padrão', () => {
    expect(adaptadorGemini.montar(PARAMETROS).entrada).toBe('Quanto gastei?');
  });

  it('escapa todo @ do prompt para o Gemini não ler arquivos por conta própria', () => {
    const { entrada } = adaptadorGemini.montar({ ...PARAMETROS, prompt: 'Pix para @fulano e @../../.env (a@b.com)' });
    expect(entrada).toBe('Pix para \\@fulano e \\@../../.env (a\\@b.com)');
  });

  it('não deixa o prompt começar com / (viraria comando do CLI)', () => {
    for (const prompt of ['/quit', '  /mcp list', '\n/help']) {
      const { entrada } = adaptadorGemini.montar({ ...PARAMETROS, prompt });
      expect(entrada.trimStart().startsWith('/')).toBe(false);
      expect(entrada).toContain(prompt.trim());
    }
  });

  it('anexa as imagens como @caminho relativo à pasta, sem escapar, com espaços escapados', () => {
    const { entrada } = adaptadorGemini.montar({
      ...PARAMETROS,
      prompt: 'O que é @isto?',
      imagens: ['/dados/conversas/c1/anexos/a1.png', '/dados/conversas/c1/anexos/meu recibo.jpg'],
    });
    expect(entrada.startsWith('O que é \\@isto?\n\n')).toBe(true);
    expect(entrada).toContain('\n@anexos/a1.png');
    expect(entrada).toContain('\n@anexos/meu\\ recibo.jpg');
    expect(entrada).not.toContain('\\@anexos');
  });
});

describe('adaptadorGemini.novoInterprete', () => {
  it('informa a sessão e o modelo no init', () => {
    expect(interpretar([L.init])).toEqual([{ tipo: 'sessao', sessaoId: 'b6f4c1de-0000-4000-8000-000000000001', modelo: 'gemini-2.5-pro' }]);
  });

  it('ignora o eco da mensagem do usuário', () => {
    expect(interpretar([L.eco])).toEqual([]);
  });

  it('transmite o texto em pedaços', () => {
    const eventos = interpretar([L.init, L.eco, L.texto('Você gastou '), L.texto('R$ 10.')]);
    expect(eventos.filter((e) => e.tipo === 'texto')).toEqual([
      { tipo: 'texto', delta: 'Você gastou ' },
      { tipo: 'texto', delta: 'R$ 10.' },
    ]);
  });

  it('separa com linha em branco o texto de antes e de depois de uma ferramenta', () => {
    const eventos = interpretar([
      L.texto('Vou consultar.'), L.ferramenta(), L.retorno({ status: 'success', output: '{}' }), L.texto('Foram '), L.texto('R$ 1.234,50.'),
    ]);
    expect(textoDe(eventos)).toBe('Vou consultar.\n\nForam R$ 1.234,50.');
  });

  it('anuncia a ferramenta com o nome no padrão mcp__<servidor>__<ferramenta>', () => {
    expect(interpretar([L.ferramenta()])).toEqual([
      { tipo: 'ferramenta', id: 'mcp_fluxo_resumo_do_mes-1', nome: 'mcp__fluxo__resumo_do_mes', entrada: { mes: '2026-09' } },
    ]);
  });

  it('ferramenta embutida passa com o nome original, sem parâmetros vira {}', () => {
    const linha = JSON.stringify({ type: 'tool_use', tool_name: 'read_file', tool_id: 'rf-1' });
    expect(interpretar([linha])).toEqual([{ tipo: 'ferramenta', id: 'rf-1', nome: 'read_file', entrada: {} }]);
  });

  it('traduz o retorno da ferramenta, com sucesso e com erro (casando pelo tool_id)', () => {
    expect(interpretar([L.retorno({ status: 'success', output: '{"despesas": 1234.5}' })])).toEqual([
      { tipo: 'ferramenta_fim', id: 'mcp_fluxo_resumo_do_mes-1', ok: true, resultado: '{"despesas": 1234.5}' },
    ]);
    expect(interpretar([L.retorno({ status: 'error', error: { type: 'execution_failed', message: 'Mês inválido' } })])).toEqual([
      { tipo: 'ferramenta_fim', id: 'mcp_fluxo_resumo_do_mes-1', ok: false, resultado: 'Mês inválido' },
    ]);
  });

  it('ferramenta negada pela política volta como erro', () => {
    const linha = L.retorno({ status: 'error', error: { type: 'policy_violation', message: 'Somente as ferramentas do Fluxo estão disponíveis.' } }, 'sh-1');
    expect(interpretar([linha])).toEqual([{ tipo: 'ferramenta_fim', id: 'sh-1', ok: false, resultado: expect.stringContaining('Somente') }]);
  });

  it('corta retorno de ferramenta muito longo', () => {
    const [evento] = interpretar([L.retorno({ status: 'success', output: 'x'.repeat(20000) })]);
    expect(evento).toMatchObject({ tipo: 'ferramenta_fim', ok: true });
    expect((evento as { resultado: string }).resultado.length).toBe(8000);
  });

  it('erro que não interrompe vira aviso', () => {
    expect(interpretar([L.aviso('Loop detected, stopping execution')])).toEqual([{ tipo: 'aviso', mensagem: expect.stringContaining('Loop detected') }]);
    expect(interpretar([L.aviso('MCP server fluxo failed', 'error')])[0]).toMatchObject({ tipo: 'aviso' });
  });

  it('fecha com o uso: tokens e duração, sem custo', () => {
    expect(interpretar([L.resultado()])).toEqual([
      { tipo: 'uso', uso: { tokensEntrada: 1200, tokensSaida: 150, custoUsd: null, duracaoMs: 5400 } },
    ]);
  });

  it('resultado com cota esgotada vira erro de limite', () => {
    const eventos = interpretar([L.resultado({ status: 'error', error: { type: 'Error', message: 'You have exhausted your capacity on this model. Quota exceeded (429)' } })]);
    expect(eventos.filter((e) => e.tipo === 'erro')).toEqual([{ tipo: 'erro', codigo: 'limite', mensagem: expect.any(String) }]);
    expect(eventos).toContainEqual(expect.objectContaining({ tipo: 'uso' }));
  });

  it('resultado com falha de login vira erro de autenticação', () => {
    const eventos = interpretar([L.resultado({ status: 'error', error: { type: 'Error', message: 'Request had invalid authentication credentials' } })]);
    expect(eventos).toContainEqual({ tipo: 'erro', codigo: 'autenticacao', mensagem: expect.stringContaining('gemini') });
  });

  it('resultado com outro erro vira erro desconhecido, só uma vez', () => {
    const falha = L.resultado({ status: 'error', error: { type: 'Error', message: 'Something odd' } });
    const erros = interpretar([falha, falha]).filter((e) => e.tipo === 'erro');
    expect(erros).toEqual([{ tipo: 'erro', codigo: 'desconhecido', mensagem: expect.stringContaining('Something odd') }]);
  });

  it('resultado com erro sem detalhe ainda vira erro', () => {
    expect(interpretar([L.resultado({ status: 'error' })])).toContainEqual({ tipo: 'erro', codigo: 'desconhecido', mensagem: expect.any(String) });
  });

  it('ignora linhas que não são JSON e tipos que não conhece', () => {
    expect(interpretar(['', 'Loaded cached credentials.', '{"type":"desconhecido"}', '[1,2]', '{"type":"tool_use"}', '{"type":"tool_result"}'])).toEqual([]);
  });
});

describe('adaptadorGemini.explicarFalha', () => {
  it('código 41 ou texto de login vira autenticação', () => {
    expect(adaptadorGemini.explicarFalha(41, '')?.codigo).toBe('autenticacao');
    const stderr = 'Please set an Auth method in your /home/x/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY';
    expect(adaptadorGemini.explicarFalha(1, stderr)).toEqual({ codigo: 'autenticacao', mensagem: expect.stringContaining('Login with Google') });
  });

  it('código 173 (429) ou texto de cota vira limite', () => {
    expect(adaptadorGemini.explicarFalha(173, '')?.codigo).toBe('limite');
    expect(adaptadorGemini.explicarFalha(1, 'RESOURCE_EXHAUSTED: Quota exceeded')?.codigo).toBe('limite');
  });

  it('código 55 é a pasta de trabalho recusada', () => {
    expect(adaptadorGemini.explicarFalha(55, 'untrusted')).toEqual({ codigo: 'cli', mensagem: expect.stringContaining('pasta de trabalho') });
  });

  it('não inventa explicação para erro desconhecido', () => {
    expect(adaptadorGemini.explicarFalha(1, 'algo estranho')).toBeNull();
    expect(adaptadorGemini.explicarFalha(null, '')).toBeNull();
  });
});

describe('adaptadorGemini.sessaoPerdida', () => {
  it('reconhece sessão que não existe mais', () => {
    expect(adaptadorGemini.sessaoPerdida(42, 'Error resuming session: Invalid session identifier "abc". Use --list-sessions to see available sessions.')).toBe(true);
    expect(adaptadorGemini.sessaoPerdida(42, 'No previous sessions found for this project.')).toBe(true);
    expect(adaptadorGemini.sessaoPerdida(1, 'No previous sessions found for this project.')).toBe(true);
  });

  it('não confunde com outros erros de entrada', () => {
    expect(adaptadorGemini.sessaoPerdida(42, 'Unknown argument: --foo')).toBe(false);
    expect(adaptadorGemini.sessaoPerdida(1, 'outra coisa')).toBe(false);
    expect(adaptadorGemini.sessaoPerdida(null, '')).toBe(false);
  });
});
