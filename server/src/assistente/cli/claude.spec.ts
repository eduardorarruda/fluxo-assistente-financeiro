import { adaptadorClaude } from './claude';
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
    segredo: { variavel: 'FLUXO_PONTE_ACESSO', valor: 'segredo' },
  },
  imagens: [],
};

/** Linhas no formato real do `claude -p --output-format stream-json --verbose --include-partial-messages` (2.1.x). */
const L = {
  init: JSON.stringify({
    type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-haiku-4-5-20251001',
    tools: ['Read', 'mcp__fluxo__resumo_do_mes'], mcp_servers: [{ name: 'fluxo', status: 'connected' }],
  }),
  inicioMensagem: (id: string) => JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', content: [] } } }),
  inicioTexto: (indice: number) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: indice, content_block: { type: 'text', text: '' } } }),
  delta: (texto: string) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: texto } } }),
  inicioFerramenta: JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__fluxo__resumo_do_mes', input: {} } },
  }),
  assistente: (id: string, conteudo: unknown[], extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', content: conteudo }, session_id: 'sess-1', ...extra }),
  resultadoFerramenta: (ok: boolean) =>
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: !ok, content: [{ type: 'text', text: '{"despesas": 1234.5}' }] }] },
    }),
  resultado: (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, duration_ms: 5400, result: 'Você gastou R$ 1.234,50.', session_id: 'sess-1',
      total_cost_usd: 0.0123, usage: { input_tokens: 1200, cache_read_input_tokens: 300, cache_creation_input_tokens: 0, output_tokens: 80 }, ...extra,
    }),
};

function interpretar(linhas: string[]): EventoAgente[] {
  const interprete = adaptadorClaude.novoInterprete();
  return linhas.flatMap((l) => interprete(l));
}

const textoDe = (eventos: EventoAgente[]) =>
  eventos.filter((e): e is Extract<EventoAgente, { tipo: 'texto' }> => e.tipo === 'texto').map((e) => e.delta).join('');

describe('adaptadorClaude.montar', () => {
  it('roda travado: só leitura, sem shell, sem web, só o MCP do Fluxo', () => {
    const { args } = adaptadorClaude.montar(PARAMETROS);
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']));
    expect(args).toEqual(expect.arrayContaining(['--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk']));
    expect(args[args.indexOf('--tools') + 1]).toBe('Read');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__fluxo Read');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args.join(' ')).not.toMatch(/Bash|WebFetch|WebSearch|Edit|Write/);
  });

  it('não põe o prompt nem o token da ponte na linha de comando', () => {
    const { args } = adaptadorClaude.montar(PARAMETROS);
    expect(args.join(' ')).not.toContain('Quanto gastei');
    expect(args.join(' ')).not.toContain('segredo');
  });

  it('grava a configuração do MCP e as instruções fora da pasta que o Read alcança', () => {
    const { args, arquivos } = adaptadorClaude.montar(PARAMETROS);
    const mcp = arquivos.find((a) => a.caminho === args[args.indexOf('--mcp-config') + 1]);
    expect(mcp?.caminho.startsWith('/dados/execucoes/e1/')).toBe(true);
    expect(arquivos.every((a) => !a.caminho.startsWith('/dados/conversas/'))).toBe(true);
    expect(JSON.parse(mcp!.conteudo)).toEqual({
      mcpServers: {
        fluxo: { type: 'stdio', command: '/usr/bin/node', args: ['/app/ponte.js'], env: { FLUXO_PONTE_URL: 'http://127.0.0.1:8778', FLUXO_PONTE_ACESSO: 'segredo' } },
      },
    });
    const instrucoes = arquivos.find((a) => a.caminho === args[args.indexOf('--append-system-prompt-file') + 1]);
    expect(instrucoes?.conteudo).toBe('Você é o assistente do Fluxo.');
  });

  it('não carrega CLAUDE.md nem .claude/rules (instruções de programação) nem memória automática', () => {
    const { args, arquivos } = adaptadorClaude.montar(PARAMETROS);
    const config = arquivos.find((a) => a.caminho === args[args.indexOf('--settings') + 1]);
    expect(config?.caminho.startsWith('/dados/execucoes/e1/')).toBe(true);
    expect(JSON.parse(config!.conteudo)).toEqual({
      claudeMdExcludes: ['**/CLAUDE.md', '**/CLAUDE.local.md', '**/.claude/**'],
      autoMemoryEnabled: false,
    });
  });

  it('continua a sessão anterior e usa o modelo escolhido', () => {
    const { args } = adaptadorClaude.montar({ ...PARAMETROS, sessaoId: 'sess-9', modelo: 'sonnet' });
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-9');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });

  it('o prompt vai pela entrada padrão, com as imagens apontadas para o Read', () => {
    const { entrada } = adaptadorClaude.montar({ ...PARAMETROS, imagens: ['/dados/conversas/c1/anexos/a1.png'] });
    expect(entrada.startsWith('Quanto gastei?')).toBe(true);
    expect(entrada).toContain('anexos/a1.png');
    expect(adaptadorClaude.montar(PARAMETROS).entrada).toBe('Quanto gastei?');
  });

  it('sem sessão e sem modelo, não passa --resume nem --model', () => {
    const { args } = adaptadorClaude.montar(PARAMETROS);
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--model');
  });
});

describe('adaptadorClaude.novoInterprete', () => {
  it('informa a sessão e o modelo no init', () => {
    expect(interpretar([L.init])).toEqual([{ tipo: 'sessao', sessaoId: 'sess-1', modelo: 'claude-haiku-4-5-20251001' }]);
  });

  it('avisa quando o MCP do Fluxo não conectou', () => {
    const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'm', mcp_servers: [{ name: 'fluxo', status: 'failed' }] });
    expect(interpretar([init])).toContainEqual({ tipo: 'aviso', mensagem: expect.stringContaining('ferramentas do Fluxo') });
  });

  it('transmite o texto em pedaços e não repete quando a mensagem completa chega', () => {
    const eventos = interpretar([
      L.init, L.inicioMensagem('msg_1'), L.inicioTexto(0), L.delta('Você gastou '), L.delta('R$ 10.'),
      L.assistente('msg_1', [{ type: 'text', text: 'Você gastou R$ 10.' }]),
    ]);
    expect(textoDe(eventos)).toBe('Você gastou R$ 10.');
  });

  it('usa o texto da mensagem completa quando não houve pedaços', () => {
    const eventos = interpretar([L.assistente('msg_1', [{ type: 'text', text: 'Olá!' }])]);
    expect(textoDe(eventos)).toBe('Olá!');
  });

  it('separa com linha em branco o texto de antes e de depois de uma ferramenta', () => {
    const eventos = interpretar([
      L.inicioMensagem('msg_1'), L.inicioTexto(0), L.delta('Vou consultar.'),
      L.assistente('msg_1', [{ type: 'text', text: 'Vou consultar.' }, { type: 'tool_use', id: 'toolu_1', name: 'mcp__fluxo__resumo_do_mes', input: { mes: '2026-09' } }]),
      L.resultadoFerramenta(true),
      L.inicioMensagem('msg_2'), L.inicioTexto(0), L.delta('Foram R$ 1.234,50.'),
    ]);
    expect(textoDe(eventos)).toBe('Vou consultar.\n\nForam R$ 1.234,50.');
  });

  it('anuncia a ferramenta no início e completa a entrada quando a mensagem chega', () => {
    const eventos = interpretar([
      L.inicioMensagem('msg_1'), L.inicioFerramenta,
      L.assistente('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__fluxo__resumo_do_mes', input: { mes: '2026-09' } }]),
    ]);
    expect(eventos).toEqual([
      { tipo: 'ferramenta', id: 'toolu_1', nome: 'mcp__fluxo__resumo_do_mes', entrada: {} },
      { tipo: 'ferramenta', id: 'toolu_1', nome: 'mcp__fluxo__resumo_do_mes', entrada: { mes: '2026-09' } },
    ]);
  });

  it('traduz o retorno da ferramenta, com sucesso e com erro', () => {
    expect(interpretar([L.resultadoFerramenta(true)])).toEqual([{ tipo: 'ferramenta_fim', id: 'toolu_1', ok: true, resultado: '{"despesas": 1234.5}' }]);
    expect(interpretar([L.resultadoFerramenta(false)])[0]).toMatchObject({ tipo: 'ferramenta_fim', ok: false });
  });

  it('aceita retorno de ferramenta em texto puro', () => {
    const linha = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } });
    expect(interpretar([linha])).toEqual([{ tipo: 'ferramenta_fim', id: 't2', ok: true, resultado: 'ok' }]);
  });

  it('fecha com o uso: tokens (somando cache), custo e duração', () => {
    expect(interpretar([L.resultado()])).toContainEqual(
      { tipo: 'uso', uso: { tokensEntrada: 1500, tokensSaida: 80, custoUsd: 0.0123, duracaoMs: 5400 } },
    );
  });

  it('usa o texto final do resultado quando nada foi transmitido antes', () => {
    const eventos = interpretar([JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Pronto.' })]);
    expect(textoDe(eventos)).toBe('Pronto.');
  });

  it('não repete o texto final quando ele já foi transmitido', () => {
    const eventos = interpretar([L.assistente('msg_1', [{ type: 'text', text: 'Você gastou R$ 1.234,50.' }]), L.resultado()]);
    expect(textoDe(eventos)).toBe('Você gastou R$ 1.234,50.');
  });

  it('login expirado vira erro de autenticação, sem virar resposta', () => {
    const eventos = interpretar([
      L.assistente('x', [{ type: 'text', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' }], {
        error: 'authentication_failed', is_api_error_message: true,
      }),
      L.resultado({ result: 'Failed to authenticate', terminal_reason: 'api_error' }),
    ]);
    expect(textoDe(eventos)).toBe('');
    expect(eventos.filter((e) => e.tipo === 'erro')).toEqual([{ tipo: 'erro', codigo: 'autenticacao', mensagem: expect.stringContaining('/login') }]);
  });

  it('limite de uso vira erro de limite', () => {
    const eventos = interpretar([L.assistente('x', [{ type: 'text', text: 'Limit reached' }], { error: 'rate_limit', is_api_error_message: true })]);
    expect(eventos).toContainEqual({ tipo: 'erro', codigo: 'limite', mensagem: expect.any(String) });
  });

  it('resultado com erro de execução vira erro', () => {
    const eventos = interpretar([L.resultado({ subtype: 'error_during_execution', is_error: true, result: undefined })]);
    expect(eventos).toContainEqual({ tipo: 'erro', codigo: 'desconhecido', mensagem: expect.any(String) });
  });

  it('ignora linhas que não são JSON e tipos que não conhece', () => {
    expect(interpretar(['', 'aviso solto no stdout', '{"type":"system","subtype":"status"}', '[1,2]'])).toEqual([]);
  });
});

describe('adaptadorClaude.explicarFalha', () => {
  it('reconhece falta de login no stderr', () => {
    expect(adaptadorClaude.explicarFalha(1, 'Invalid API key · Please run /login')?.codigo).toBe('autenticacao');
  });

  it('reconhece sessão que não existe mais', () => {
    expect(adaptadorClaude.sessaoPerdida(1, 'No conversation found with session ID: abc')).toBe(true);
    expect(adaptadorClaude.sessaoPerdida(1, 'outra coisa')).toBe(false);
  });

  it('não inventa explicação para erro desconhecido', () => {
    expect(adaptadorClaude.explicarFalha(1, 'algo estranho')).toBeNull();
  });
});
