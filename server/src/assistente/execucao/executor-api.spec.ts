import { APICallError } from 'ai';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chamada, modeloFalso, modeloQueFalha, texto, type Pedaco } from '../apis/testing/modelo-falso';
import type { EventoAgente } from '../cli/tipos';
import type { Ferramentas } from '../ferramentas/ferramentas';
import { executarApi, montarMensagens, type PedidoApi } from './executor-api';
import { INSTRUCOES_DE_VOZ, montarPrompt } from './prompt';

/** Chave de mentira: nunca uma de verdade, e nada aqui chama API de verdade. */
const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';

function ferramentasFalsas() {
  const chamadas: { nome: string; entrada: unknown; conversaId: string }[] = [];
  const ferramentas = {
    lista: () => [
      { nome: 'panorama', descricao: 'Panorama', inputSchema: { type: 'object', properties: {} } },
      { nome: 'resumo_do_mes', descricao: 'Resumo', inputSchema: { type: 'object', properties: { mes: { type: 'string' } } } },
    ],
    executar: async (nome: string, entrada: unknown, ctx: { conversaId: string }) => {
      chamadas.push({ nome, entrada, conversaId: ctx.conversaId });
      return nome === 'resumo_do_mes' ? { ok: false, texto: 'Entrada inválida — mes: obrigatório' } : { ok: true, texto: '{"hoje":"2026-10-01"}' };
    },
  } as unknown as Ferramentas;
  return { ferramentas, chamadas };
}

function pedido(modelo: PedidoApi['modelo'], extra: Partial<PedidoApi> = {}) {
  const eventos: EventoAgente[] = [];
  const p: PedidoApi = {
    provedor: 'claude', modelo, idDoModelo: 'claude-sonnet-5', chave: CHAVE, instrucoes: 'Seja útil.', historico: [],
    turno: 'Quanto gastei?', imagens: [], ferramentas: null, conversaId: 'c1', tempoMaximoMs: 60_000,
    tentativas: 0, sinal: new AbortController().signal, aoEvento: (e) => eventos.push(e), ...extra,
  };
  return { p, eventos };
}

const textoDe = (eventos: EventoAgente[]) => eventos.flatMap((e) => (e.tipo === 'texto' ? [e.delta] : [])).join('');

describe('executarApi', () => {
  it('transmite o texto em pedaços e informa o uso', async () => {
    const { p, eventos } = pedido(modeloFalso([texto('Olá', ', tudo ', 'certo?')]));
    const r = await executarApi(p);
    expect(r).toMatchObject({ motivo: 'normal', falha: null });
    expect(eventos.filter((e) => e.tipo === 'texto').map((e) => (e as { delta: string }).delta)).toEqual(['Olá', ', tudo ', 'certo?']);
    expect(eventos.at(-1)).toEqual({ tipo: 'uso', uso: { tokensEntrada: 120, tokensSaida: 30, duracaoMs: expect.any(Number) } });
  });

  it('roda as ferramentas do Fluxo direto e emite ferramenta/ferramenta_fim com o nome da ponte', async () => {
    const { ferramentas, chamadas } = ferramentasFalsas();
    const modelo = modeloFalso([
      [{ type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'Vou olhar.' }, { type: 'text-end', id: 'a' } as Pedaco, ...chamada('f1', 'panorama', {})],
      chamada('f2', 'resumo_do_mes', {}),
      texto('Pronto.'),
    ]);
    const { p, eventos } = pedido(modelo, { ferramentas, conversaId: 'conv-9' });
    await executarApi(p);
    expect(chamadas).toEqual([{ nome: 'panorama', entrada: {}, conversaId: 'conv-9' }, { nome: 'resumo_do_mes', entrada: {}, conversaId: 'conv-9' }]);
    expect(eventos.filter((e) => e.tipo === 'ferramenta' || e.tipo === 'ferramenta_fim')).toEqual([
      { tipo: 'ferramenta', id: 'f1', nome: 'mcp__fluxo__panorama', entrada: {} },
      { tipo: 'ferramenta', id: 'f1', nome: 'mcp__fluxo__panorama', entrada: {} },
      { tipo: 'ferramenta_fim', id: 'f1', ok: true, resultado: '{"hoje":"2026-10-01"}' },
      { tipo: 'ferramenta', id: 'f2', nome: 'mcp__fluxo__resumo_do_mes', entrada: {} },
      { tipo: 'ferramenta', id: 'f2', nome: 'mcp__fluxo__resumo_do_mes', entrada: {} },
      // ok:false da ferramenta vira texto para o modelo (não exceção) e passo com erro na tela.
      { tipo: 'ferramenta_fim', id: 'f2', ok: false, resultado: 'Entrada inválida — mes: obrigatório' },
    ]);
    // O texto depois das ferramentas é outro parágrafo.
    expect(textoDe(eventos)).toBe('Vou olhar.\n\nPronto.');
    // O modelo recebeu o resultado da ferramenta e as ferramentas como definição.
    const terceira = modelo.doStreamCalls[2]!;
    expect(JSON.stringify(terceira.prompt)).toContain('Entrada inválida');
    expect(terceira.tools?.map((t) => (t as { name: string }).name)).toEqual(['panorama', 'resumo_do_mes']);
  });

  it('manda instruções, histórico em turnos e o turno atual com o modo voz', async () => {
    const modelo = modeloFalso([texto('ok')]);
    const turno = montarPrompt({ texto: 'e agora?', hoje: '2026-10-01', anexos: [], historico: [], voz: true });
    const historico = [{ papel: 'usuario' as const, texto: 'oi' }, { papel: 'assistente' as const, texto: 'olá!' }];
    await executarApi(pedido(modelo, { historico, turno }).p);
    const prompt = modelo.doStreamCalls[0]!.prompt;
    expect(prompt[0]).toMatchObject({ role: 'system', content: 'Seja útil.' });
    expect(prompt.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(prompt.at(-1))).toContain(JSON.stringify(INSTRUCOES_DE_VOZ).slice(1, 40));
  });

  it('manda as imagens anexadas como imagem (e avisa da que não dá)', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'fluxo-api-img-'));
    try {
      const png = join(pasta, 'a.png');
      writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]));
      const modelo = modeloFalso([texto('vi')]);
      const { p, eventos } = pedido(modelo, { imagens: [png, join(pasta, 'sumiu.png')] });
      await executarApi(p);
      const ultima = modelo.doStreamCalls[0]!.prompt.at(-1)!;
      expect(JSON.stringify(ultima)).toContain('image/png');
      expect(eventos).toContainEqual({ tipo: 'aviso', mensagem: 'Não consegui ler a imagem sumiu.png (ENOENT).' });
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('401 vira "chave recusada"; 429 vira limite — sem a chave na mensagem', async () => {
    const erro = (status: number) => new APICallError({
      message: `Incorrect API key provided: ${CHAVE}`, url: 'https://api.anthropic.com/v1/messages', statusCode: status, isRetryable: false, requestBodyValues: {},
    });
    const r401 = await executarApi(pedido(modeloQueFalha(erro(401))).p);
    expect(r401.falha).toEqual({ codigo: 'autenticacao', mensagem: 'A chave da API foi recusada (inválida, revogada ou sem permissão). Troque a chave nos Ajustes.' });
    const r429 = await executarApi(pedido(modeloQueFalha(erro(429))).p);
    expect(r429.falha?.codigo).toBe('limite');
    expect(JSON.stringify([r401, r429])).not.toContain(CHAVE);
  });

  it('cancelar interrompe e devolve "cancelado", sem falha', async () => {
    const controle = new AbortController();
    const { p, eventos } = pedido(modeloFalso([texto('a', 'b', 'c', 'd', 'e')], { atrasoMs: 50 }), { sinal: controle.signal });
    p.aoEvento = (e) => {
      eventos.push(e);
      if (e.tipo === 'texto') controle.abort();
    };
    const r = await executarApi(p);
    expect(r).toMatchObject({ motivo: 'cancelado', falha: null });
    expect(textoDe(eventos).length).toBeLessThan(5);
  });

  it('passou do tempo máximo: falha "tempo"', async () => {
    const { p } = pedido(modeloFalso([texto('a', 'b', 'c')], { atrasoMs: 200 }), { tempoMaximoMs: 50 });
    const r = await executarApi(p);
    expect(r.motivo).toBe('tempo');
    expect(r.falha?.codigo).toBe('tempo');
  });
});

describe('montarMensagens', () => {
  it('corta, tira vazios, junta turnos seguidos do mesmo papel e começa pela pessoa', () => {
    const historico = [
      { papel: 'assistente' as const, texto: 'sobra do começo' },
      { papel: 'usuario' as const, texto: 'a' },
      { papel: 'usuario' as const, texto: '   ' },
      { papel: 'usuario' as const, texto: 'b' },
      { papel: 'assistente' as const, texto: 'x'.repeat(5000) },
      { papel: 'usuario' as const, texto: 'c (a resposta falhou)' },
    ];
    const m = montarMensagens(historico, 'agora', []);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[0]!.content).toBe('a\n\nb');
    expect((m[1]!.content as string).length).toBeLessThanOrEqual(4001);
    expect(m[2]!.content).toBe('c (a resposta falhou)\n\nagora');
  });

  it('guarda só as 20 mais recentes', () => {
    const historico = Array.from({ length: 30 }, (_, i) => ({ papel: (i % 2 ? 'assistente' : 'usuario') as 'usuario' | 'assistente', texto: `m${i}` }));
    const m = montarMensagens(historico, 'agora', []);
    expect(m[0]!.content).toBe('m10');
    expect(m).toHaveLength(21);
  });
});
