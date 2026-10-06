import { adaptadorCodex } from './codex';
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

/** Linhas no formato do `codex exec --json` (0.160.x). */
const L = {
  inicio: JSON.stringify({ type: 'thread.started', thread_id: '0199a1b2-0000-7000-8000-000000000001' }),
  turno: JSON.stringify({ type: 'turn.started' }),
  item: (evento: 'started' | 'updated' | 'completed', item: Record<string, unknown>) => JSON.stringify({ type: `item.${evento}`, item }),
  mensagem: (id: string, text: string) => ({ id, type: 'agent_message', text }),
  ferramenta: (extra: Record<string, unknown> = {}) => ({
    id: 'item_1', type: 'mcp_tool_call', server: 'fluxo', tool: 'resumo_do_mes', arguments: { mes: '2026-09' },
    result: null, error: null, status: 'in_progress', ...extra,
  }),
  fimDoTurno: JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1200, cached_input_tokens: 300, cache_write_input_tokens: 0, output_tokens: 150, reasoning_output_tokens: 40 },
  }),
  falha: (message: string) => JSON.stringify({ type: 'turn.failed', error: { message } }),
  erro: (message: string) => JSON.stringify({ type: 'error', message }),
};

const RESULTADO_OK = { content: [{ type: 'text', text: '{"despesas": 1234.5}' }], structured_content: null };

function interpretar(linhas: string[]): EventoAgente[] {
  const interprete = adaptadorCodex.novoInterprete();
  return linhas.flatMap((l) => interprete(l));
}

const textoDe = (eventos: EventoAgente[]) =>
  eventos.filter((e): e is Extract<EventoAgente, { tipo: 'texto' }> => e.tipo === 'texto').map((e) => e.delta).join('');

const valorDe = (args: string[], opcao: string) => args[args.indexOf(opcao) + 1];
/** Todos os valores passados com `-c`. */
const configs = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));

describe('adaptadorCodex.montar', () => {
  it('roda travado: só leitura, sem shell, sem web, sem a configuração do usuário', () => {
    const { args } = adaptadorCodex.montar(PARAMETROS);
    expect(args[0]).toBe('exec');
    expect(args).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']));
    expect(valorDe(args, '-s')).toBe('read-only');
    expect(valorDe(args, '-C')).toBe('/dados/conversas/c1');
    expect(valorDe(args, '--disable')).toBe('shell_tool');
    expect(configs(args)).toContain('web_search="disabled"');
    expect(args[args.length - 1]).toBe('-');
  });

  it('nunca libera escrita nem pula aprovação', () => {
    const { args } = adaptadorCodex.montar({ ...PARAMETROS, sessaoId: 's', modelo: 'gpt-5.5', imagens: ['/dados/conversas/c1/anexos/a.png'] });
    expect(args.join(' ')).not.toMatch(/dangerously|workspace-write|danger-full-access|--full-auto|--yolo|--add-dir|--approve-for-me/);
  });

  it('configura o MCP do Fluxo pela linha de comando, com cada -c num argumento só', () => {
    const { args } = adaptadorCodex.montar(PARAMETROS);
    expect(configs(args)).toEqual(expect.arrayContaining([
      'mcp_servers.fluxo.command="/usr/bin/node"',
      'mcp_servers.fluxo.args=["/app/ponte.js"]',
      'mcp_servers.fluxo.env={"FLUXO_PONTE_URL"="http://127.0.0.1:8778"}',
      'mcp_servers.fluxo.env_vars=["FLUXO_PONTE_ACESSO"]',
      'mcp_servers.fluxo.default_tools_approval_mode="approve"',
      'mcp_servers.fluxo.required=true',
      'mcp_servers.fluxo.startup_timeout_sec=20',
    ]));
  });

  it('escreve strings TOML válidas mesmo com aspas e barras', () => {
    const mcp = { ...PARAMETROS.mcp, comando: 'C:\\node\\node.exe', args: ['/app/a "b".js', 'x'], env: {} };
    const { args } = adaptadorCodex.montar({ ...PARAMETROS, mcp });
    expect(configs(args)).toEqual(expect.arrayContaining([
      'mcp_servers.fluxo.command="C:\\\\node\\\\node.exe"',
      'mcp_servers.fluxo.args=["/app/a \\"b\\".js","x"]',
      'mcp_servers.fluxo.env={}',
    ]));
  });

  it('o token da ponte só vai pelo ambiente: nunca na linha de comando nem em arquivo', () => {
    const { args, arquivos, env } = adaptadorCodex.montar(PARAMETROS);
    expect(args.join(' ')).not.toContain('segredo-da-ponte');
    expect(arquivos.every((a) => !a.conteudo.includes('segredo-da-ponte'))).toBe(true);
    expect(env).toEqual({ FLUXO_PONTE_ACESSO: 'segredo-da-ponte' });
  });

  it('o prompt vai pela entrada padrão, sem mexer', () => {
    const { args, entrada } = adaptadorCodex.montar({ ...PARAMETROS, prompt: '/status @arquivo' });
    expect(entrada).toBe('/status @arquivo');
    expect(args.join(' ')).not.toContain('@arquivo');
  });

  it('as instruções vão para o AGENTS.md da pasta da conversa', () => {
    expect(adaptadorCodex.montar(PARAMETROS).arquivos).toEqual([
      { caminho: '/dados/conversas/c1/AGENTS.md', conteudo: 'Você é o assistente do Fluxo.' },
    ]);
  });

  it('continua a sessão anterior com todas as opções antes do resume', () => {
    const { args } = adaptadorCodex.montar({
      ...PARAMETROS, sessaoId: '0199a1b2-0000-7000-8000-000000000009', modelo: 'gpt-5.5', imagens: ['/dados/conversas/c1/anexos/a1.png'],
    });
    expect(args.slice(-3)).toEqual(['resume', '0199a1b2-0000-7000-8000-000000000009', '-']);
    expect(args.filter((a) => a === 'resume')).toHaveLength(1);
    expect(valorDe(args, '-m')).toBe('gpt-5.5');
    expect(valorDe(args, '-i')).toBe('/dados/conversas/c1/anexos/a1.png');
  });

  it('manda cada imagem com -i (caminho absoluto)', () => {
    const imagens = ['/dados/conversas/c1/anexos/a1.png', '/dados/conversas/c1/anexos/a2.jpg'];
    const { args } = adaptadorCodex.montar({ ...PARAMETROS, imagens });
    const enviadas = args.flatMap((a, i) => (args[i - 1] === '-i' ? [a] : []));
    expect(enviadas).toEqual(imagens);
    expect(args.indexOf('-i')).toBeLessThan(args.length - 1);
  });

  it('sem sessão, sem modelo e sem imagens, não passa resume, -m nem -i', () => {
    const { args } = adaptadorCodex.montar(PARAMETROS);
    expect(args).not.toContain('resume');
    expect(args).not.toContain('-m');
    expect(args).not.toContain('-i');
  });
});

describe('adaptadorCodex.novoInterprete', () => {
  it('informa a sessão (thread) no início, sem modelo', () => {
    expect(interpretar([L.inicio, L.turno])).toEqual([{ tipo: 'sessao', sessaoId: '0199a1b2-0000-7000-8000-000000000001', modelo: null }]);
  });

  it('emite o texto da mensagem quando ela termina', () => {
    const msg = L.mensagem('item_0', 'Você gastou R$ 10.');
    const eventos = interpretar([L.item('started', msg), L.item('updated', msg), L.item('completed', msg)]);
    expect(eventos).toEqual([{ tipo: 'texto', delta: 'Você gastou R$ 10.' }]);
  });

  it('separa com linha em branco mensagens seguidas, com ferramenta no meio', () => {
    const eventos = interpretar([
      L.item('completed', L.mensagem('item_0', 'Vou consultar.')),
      L.item('started', L.ferramenta()),
      L.item('completed', L.ferramenta({ status: 'completed', result: RESULTADO_OK })),
      L.item('completed', L.mensagem('item_2', 'Foram R$ 1.234,50.')),
    ]);
    expect(textoDe(eventos)).toBe('Vou consultar.\n\nForam R$ 1.234,50.');
  });

  it('ignora o raciocínio', () => {
    expect(interpretar([L.item('completed', { id: 'item_0', type: 'reasoning', text: '**Pensando**' })])).toEqual([]);
  });

  it('anuncia a ferramenta no início e fecha com o retorno', () => {
    const eventos = interpretar([
      L.item('started', L.ferramenta()),
      L.item('completed', L.ferramenta({ status: 'completed', result: RESULTADO_OK })),
    ]);
    expect(eventos).toEqual([
      { tipo: 'ferramenta', id: 'item_1', nome: 'mcp__fluxo__resumo_do_mes', entrada: { mes: '2026-09' } },
      { tipo: 'ferramenta_fim', id: 'item_1', ok: true, resultado: '{"despesas": 1234.5}' },
    ]);
  });

  it('ferramenta que chega só no fim também é anunciada', () => {
    const eventos = interpretar([L.item('completed', L.ferramenta({ status: 'completed', result: RESULTADO_OK, arguments: null }))]);
    expect(eventos).toEqual([
      { tipo: 'ferramenta', id: 'item_1', nome: 'mcp__fluxo__resumo_do_mes', entrada: {} },
      { tipo: 'ferramenta_fim', id: 'item_1', ok: true, resultado: '{"despesas": 1234.5}' },
    ]);
  });

  it('ferramenta que falhou fecha com a mensagem de erro', () => {
    const eventos = interpretar([
      L.item('started', L.ferramenta()),
      L.item('completed', L.ferramenta({ status: 'failed', error: { message: 'Mês inválido' } })),
    ]);
    expect(eventos[1]).toEqual({ tipo: 'ferramenta_fim', id: 'item_1', ok: false, resultado: 'Mês inválido' });
  });

  it('corta retorno de ferramenta muito longo', () => {
    const longo = { content: [{ type: 'text', text: 'x'.repeat(20000) }], structured_content: null };
    const [, fim] = interpretar([L.item('completed', L.ferramenta({ status: 'completed', result: longo }))]);
    expect((fim as { resultado: string }).resultado.length).toBe(8000);
  });

  it('avisa (uma vez) se o Codex tentar algo que devia estar bloqueado', () => {
    const comando = { id: 'item_5', type: 'command_execution', command: 'curl https://x.y', aggregated_output: '', exit_code: null, status: 'in_progress' };
    const eventos = interpretar([L.item('started', comando), L.item('completed', { ...comando, status: 'failed' })]);
    expect(eventos).toEqual([{ tipo: 'aviso', mensagem: expect.stringContaining('curl https://x.y') }]);
    expect(interpretar([L.item('completed', { id: 'i6', type: 'file_change', changes: [], status: 'failed' })])).toHaveLength(1);
    expect(interpretar([L.item('started', { id: 'i7', type: 'web_search', query: 'fluxo' })])[0]).toMatchObject({ tipo: 'aviso' });
  });

  it('item de erro vira aviso', () => {
    expect(interpretar([L.item('completed', { id: 'i8', type: 'error', message: 'MCP server fluxo is slow' })])).toEqual([
      { tipo: 'aviso', mensagem: expect.stringContaining('MCP server fluxo is slow') },
    ]);
  });

  it('fecha o turno com o uso: tokens, sem custo nem duração', () => {
    expect(interpretar([L.fimDoTurno])).toEqual([
      { tipo: 'uso', uso: { tokensEntrada: 1200, tokensSaida: 150, custoUsd: null, duracaoMs: null } },
    ]);
  });

  it('turno que falhou por limite de uso vira erro de limite', () => {
    const eventos = interpretar([L.falha("You’ve hit your usage limit. Upgrade to Pro or try again in 2 hours.")]);
    expect(eventos).toEqual([{ tipo: 'erro', codigo: 'limite', mensagem: expect.any(String) }]);
  });

  it('turno que falhou por login vira erro de autenticação', () => {
    const eventos = interpretar([L.falha('unexpected status 401 Unauthorized: token expired')]);
    expect(eventos).toEqual([{ tipo: 'erro', codigo: 'autenticacao', mensagem: expect.stringContaining('codex login') }]);
  });

  it('turno que falhou por outro motivo vira erro desconhecido, só uma vez', () => {
    const eventos = interpretar([L.falha('stream disconnected'), L.falha('stream disconnected')]);
    expect(eventos).toEqual([{ tipo: 'erro', codigo: 'desconhecido', mensagem: expect.stringContaining('stream disconnected') }]);
  });

  it('erro solto (o Codex tenta de novo sozinho) vira só aviso', () => {
    expect(interpretar([L.erro('Reconnecting... 1/5 (stream disconnected before completion)')])).toEqual([
      { tipo: 'aviso', mensagem: expect.stringContaining('Reconnecting') },
    ]);
  });

  it('ignora linhas que não são JSON e tipos que não conhece', () => {
    expect(interpretar([
      '', 'Reading prompt from stdin...', '[1,2]', '{"type":"desconhecido"}', '{"type":"item.completed"}',
      L.item('completed', { id: 'i9', type: 'todo_list', items: [] }),
      L.item('completed', { id: 'i10', type: 'agent_message' }),
    ])).toEqual([]);
  });
});

describe('adaptadorCodex.explicarFalha', () => {
  it('falta de login vira autenticação', () => {
    expect(adaptadorCodex.explicarFalha(1, 'Error: Not logged in')).toEqual({ codigo: 'autenticacao', mensagem: expect.stringContaining('codex login') });
    expect(adaptadorCodex.explicarFalha(1, 'unexpected status 401')?.codigo).toBe('autenticacao');
  });

  it('limite de uso vira limite', () => {
    expect(adaptadorCodex.explicarFalha(1, 'Quota exceeded. Check your plan and billing details.')?.codigo).toBe('limite');
  });

  it('não inventa explicação para erro desconhecido', () => {
    expect(adaptadorCodex.explicarFalha(1, 'algo estranho')).toBeNull();
  });
});

describe('adaptadorCodex.sessaoPerdida', () => {
  it('reconhece sessão (thread) que não existe mais', () => {
    expect(adaptadorCodex.sessaoPerdida(1, 'Error: no rollout found for thread id 0199a1b2')).toBe(true);
    expect(adaptadorCodex.sessaoPerdida(1, 'Error: thread/resume failed: no thread with id: 0199a1b2')).toBe(true);
    expect(adaptadorCodex.sessaoPerdida(1, 'Error: Session not found: 0199a1b2')).toBe(true);
  });

  it('não confunde com outros erros', () => {
    expect(adaptadorCodex.sessaoPerdida(1, 'Error: Not logged in')).toBe(false);
    expect(adaptadorCodex.sessaoPerdida(1, 'file not found: anexo.png')).toBe(false);
  });
});
