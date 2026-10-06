import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerLinhaJson, texto } from '../cli/comum';
import type { AdaptadorCli, EventoAgente } from '../cli/tipos';
import { executarCli, type PedidoCli } from './executor-cli';

let raiz: string;
let cliFalso: string;

/**
 * Um "CLI" de mentira em Node: lê o prompt da stdin e responde conforme ele.
 * Imprime JSON por linha, como os de verdade.
 */
const SCRIPT = `
const fs = require('node:fs');
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  if (entrada.includes('SESSAO')) { process.stderr.write('No conversation found with session ID: s1'); process.exit(1); }
  if (entrada.includes('ERRO')) { process.stderr.write('\\u001b[31mInvalid API key · Please run /login\\u001b[0m'); process.exit(1); }
  if (entrada.includes('QUEBRA')) { process.stderr.write('linha 1\\nfalha estranha no final\\n'); process.exit(7); }
  const config = process.argv[2];
  const modo = (fs.statSync(config).mode & 0o777).toString(8);
  out({ t: 'sessao', id: 'nova' });
  out({ t: 'texto', d: 'cwd=' + process.cwd() + ' ' });
  out({ t: 'texto', d: 'modo=' + modo + ' ' });
  out({ t: 'texto', d: 'pluggy=' + (process.env.PLUGGY_CLIENT_SECRET ? 'vazou' : 'nao') + ' ' });
  out({ t: 'texto', d: 'ponte=' + (process.env.FLUXO_PONTE_ACESSO || '') + ' ' });
  out({ t: 'texto', d: 'conta=' + (process.env.CONTA_DIR || '-') + ' ' });
  out({ t: 'texto', d: 'entrada=' + entrada });
});
`;

const adaptadorFalso: AdaptadorCli = {
  provedor: 'claude',
  nome: 'CLI falso',
  binario: 'node',
  comoInstalar: '',
  comoEntrar: '',
  variavelDeConta: 'CONTA_DIR',
  modelos: [],
  variaveisPermitidas: [],
  montar: (p) => ({
    args: [cliFalso, join(p.pastaExecucao, 'config.json')],
    entrada: p.prompt,
    arquivos: [{ caminho: join(p.pastaExecucao, 'config.json'), conteudo: JSON.stringify({ segredo: p.mcp.segredo.valor }) }],
    env: { [p.mcp.segredo.variavel]: p.mcp.segredo.valor },
  }),
  novoInterprete: () => (linha) => {
    const o = lerLinhaJson(linha);
    if (o?.t === 'sessao') return [{ tipo: 'sessao', sessaoId: texto(o.id)!, modelo: null }];
    if (o?.t === 'texto') return [{ tipo: 'texto', delta: texto(o.d)! }];
    return [];
  },
  explicarFalha: (_c, stderr) => (/login/.test(stderr) ? { codigo: 'autenticacao', mensagem: 'Faça login.' } : null),
  sessaoPerdida: (_c, stderr) => /No conversation found/.test(stderr),
};

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'fluxo-executor-'));
  cliFalso = join(raiz, 'cli-falso.js');
  writeFileSync(cliFalso, SCRIPT);
});

afterAll(() => rmSync(raiz, { recursive: true, force: true }));

function pedido(prompt: string, extra: Partial<PedidoCli> = {}): { eventos: EventoAgente[]; p: PedidoCli } {
  const eventos: EventoAgente[] = [];
  return {
    eventos,
    p: {
      adaptador: adaptadorFalso,
      caminho: process.execPath,
      pasta: join(raiz, 'conversas', 'c1'),
      pastaExecucao: join(raiz, 'execucoes', `e-${Math.random()}`),
      prompt,
      instrucoes: 'x',
      modelo: null,
      sessaoId: null,
      imagens: [],
      mcp: { nome: 'fluxo', comando: process.execPath, args: [], env: {}, segredo: { variavel: 'FLUXO_PONTE_ACESSO', valor: 'tok123' } },
      tempoMaximoMs: 20_000,
      sinal: new AbortController().signal,
      env: { PATH: process.env.PATH, HOME: '/home/teste', PLUGGY_CLIENT_SECRET: 'segredo' },
      aoEvento: (e) => eventos.push(e),
      ...extra,
    },
  };
}

const textoDe = (eventos: EventoAgente[]) => eventos.map((e) => (e.tipo === 'texto' ? e.delta : '')).join('');

describe('executarCli', () => {
  it('roda na pasta da conversa, com arquivos 0600, ambiente limpo e o segredo da ponte só pelo ambiente', async () => {
    const { eventos, p } = pedido('Quanto gastei?');
    const r = await executarCli(p);
    expect(r.falha).toBeNull();
    const t = textoDe(eventos);
    expect(t).toContain(`cwd=${p.pasta}`);
    expect(t).toContain('modo=600');
    expect(t).toContain('pluggy=nao');
    expect(t).toContain('ponte=tok123');
    expect(t).toContain('entrada=Quanto gastei?');
    expect(eventos[0]).toEqual({ tipo: 'sessao', sessaoId: 'nova', modelo: null });
  });

  it('a pasta de login da conta chega ao CLI pela variável dele', async () => {
    const { eventos, p } = pedido('x', { envDaConta: { CONTA_DIR: '/home/teste/.claude-trabalho' } });
    await executarCli(p);
    expect(textoDe(eventos)).toContain('conta=/home/teste/.claude-trabalho');
    const semConta = pedido('x');
    await executarCli(semConta.p);
    expect(textoDe(semConta.eventos)).toContain('conta=-');
  });

  it('explica a falha que o adaptador reconhece (login), sem códigos de cor', async () => {
    const { p } = pedido('ERRO');
    const r = await executarCli(p);
    expect(r.falha).toEqual({ codigo: 'autenticacao', mensagem: 'Faça login.' });
  });

  it('falha desconhecida mostra o código e a última linha útil do stderr', async () => {
    const { p } = pedido('QUEBRA');
    const r = await executarCli(p);
    expect(r.falha?.codigo).toBe('desconhecido');
    expect(r.falha?.mensagem).toContain('código 7');
    expect(r.falha?.mensagem).toContain('falha estranha no final');
  });

  it('reconhece sessão perdida só quando havia sessão e nada foi respondido', async () => {
    expect((await executarCli(pedido('SESSAO', { sessaoId: 's1' }).p)).sessaoPerdida).toBe(true);
    expect((await executarCli(pedido('SESSAO').p)).sessaoPerdida).toBe(false);
  });

  it('CLI que não inicia vira falha legível', async () => {
    const r = await executarCli(pedido('x', { caminho: join(raiz, 'nao-existe') }).p);
    expect(r.falha?.codigo).toBe('cli');
    expect(r.falha?.mensagem).toMatch(/Não consegui iniciar o CLI falso/);
  });

  it('cancelado não é falha (quem chamou decide o que mostrar)', async () => {
    const controle = new AbortController();
    controle.abort();
    const r = await executarCli(pedido('x', { sinal: controle.signal }).p);
    expect(r.fim.motivo).toBe('cancelado');
    expect(r.falha).toBeNull();
  });
});
