import { conversa, corpoSse, mensagem, passo, quadro } from '../testes/fixtures/assistente';
import { aplicarEvento, assinarExecucao, criarLeitorSse, lerEvento, recomecarGeracao } from './eventos-execucao';
import type { EventoExecucao } from './tipos-assistente';

describe('criarLeitorSse', () => {
  it('lê um quadro completo com id e data', () => {
    const leitor = criarLeitorSse();
    expect(leitor.empurrar('id: 3\ndata: {"tipo":"texto","delta":"oi"}\n\n')).toEqual([{ id: 3, dados: '{"tipo":"texto","delta":"oi"}' }]);
  });

  it('junta um quadro partido no meio em vários pedaços', () => {
    const leitor = criarLeitorSse();
    expect(leitor.empurrar('id: 1\nda')).toEqual([]);
    expect(leitor.empurrar('ta: {"tipo":"tex')).toEqual([]);
    expect(leitor.empurrar('to","delta":"a"}\n')).toEqual([]);
    expect(leitor.empurrar('\n')).toEqual([{ id: 1, dados: '{"tipo":"texto","delta":"a"}' }]);
  });

  it('separa vários quadros que chegam no mesmo pedaço e guarda o resto', () => {
    const leitor = criarLeitorSse();
    const quadros = leitor.empurrar('id: 1\ndata: a\n\nid: 2\ndata: b\n\nid: 3\ndata: c');
    expect(quadros).toEqual([{ id: 1, dados: 'a' }, { id: 2, dados: 'b' }]);
    expect(leitor.empurrar('\n\n')).toEqual([{ id: 3, dados: 'c' }]);
  });

  it('ignora comentários de batimento (linhas com ":")', () => {
    const leitor = criarLeitorSse();
    expect(leitor.empurrar(': ping\n\n:keepalive\n\nid: 5\n: no meio\ndata: x\n\n')).toEqual([{ id: 5, dados: 'x' }]);
  });

  it('aceita \\r\\n, inclusive partido entre dois pedaços', () => {
    const leitor = criarLeitorSse();
    expect(leitor.empurrar('id: 7\r\ndata: y\r')).toEqual([]);
    expect(leitor.empurrar('\n\r\n')).toEqual([{ id: 7, dados: 'y' }]);
  });

  it('junta várias linhas data com quebra de linha e aceita "data:" sem espaço', () => {
    const leitor = criarLeitorSse();
    expect(leitor.empurrar('data:linha 1\ndata: linha 2\n\n')).toEqual([{ id: null, dados: 'linha 1\nlinha 2' }]);
  });

  it('id inválido vira null; quadro sem data é descartado', () => {
    const leitor = criarLeitorSse();
    expect(leitor.empurrar('id: abc\ndata: z\n\nid: 9\n\nevent: x\nretry: 100\n\n')).toEqual([{ id: null, dados: 'z' }]);
  });
});

describe('lerEvento', () => {
  it('reconhece os três tipos do contrato', () => {
    expect(lerEvento('{"tipo":"texto","delta":"oi"}')).toEqual({ tipo: 'texto', delta: 'oi' });
    expect(lerEvento(JSON.stringify({ tipo: 'passo', passo: passo() }))?.tipo).toBe('passo');
    expect(lerEvento(JSON.stringify({ tipo: 'fim', mensagem: mensagem() }))?.tipo).toBe('fim');
  });

  it('descarta JSON quebrado ou tipo desconhecido', () => {
    expect(lerEvento('{nao é json')).toBeNull();
    expect(lerEvento('"texto"')).toBeNull();
    expect(lerEvento('{"tipo":"outro"}')).toBeNull();
    expect(lerEvento('{"tipo":"texto","delta":3}')).toBeNull();
  });
});

describe('aplicarEvento', () => {
  const base = () =>
    conversa({
      execucaoAtiva: 'e1',
      gerando: true,
      mensagens: [mensagem({ id: 'u1', papel: 'usuario', texto: 'pergunta' }), mensagem({ id: 'a1', texto: '', situacao: 'gerando' })],
    });

  it('soma o texto na mensagem em geração sem mexer no original', () => {
    const original = base();
    const depois = aplicarEvento(aplicarEvento(original, { tipo: 'texto', delta: 'Olá, ' }), { tipo: 'texto', delta: 'mundo' });
    expect(depois.mensagens[1]?.texto).toBe('Olá, mundo');
    expect(original.mensagens[1]?.texto).toBe('');
  });

  it('insere passo novo e atualiza o mesmo id', () => {
    let c = aplicarEvento(base(), { tipo: 'passo', passo: passo({ situacao: 'rodando', resultado: null }) });
    c = aplicarEvento(c, { tipo: 'passo', passo: passo({ id: 'p2', rotulo: 'Buscar movimentos' }) });
    c = aplicarEvento(c, { tipo: 'passo', passo: passo({ situacao: 'ok' }) });
    expect(c.mensagens[1]?.passos.map((p) => [p.id, p.situacao])).toEqual([['p1', 'ok'], ['p2', 'ok']]);
  });

  it('no fim troca a mensagem pela gravada e encerra a execução', () => {
    const final = mensagem({ id: 'a1', texto: 'Pronto', situacao: 'ok' });
    const c = aplicarEvento(base(), { tipo: 'fim', mensagem: final });
    expect(c.mensagens[1]).toBe(final);
    expect(c.execucaoAtiva).toBeNull();
    expect(c.gerando).toBe(false);
  });

  it('sem mensagem em geração, texto não muda nada', () => {
    const c = conversa({ mensagens: [mensagem()] });
    expect(aplicarEvento(c, { tipo: 'texto', delta: 'x' })).toBe(c);
  });

  it('recomecarGeracao zera texto e passos da mensagem em geração', () => {
    const c = aplicarEvento(base(), { tipo: 'texto', delta: 'parcial' });
    expect(recomecarGeracao(c).mensagens[1]).toMatchObject({ texto: '', passos: [] });
  });
});

describe('assinarExecucao', () => {
  const semEspera = () => Promise.resolve();

  it('reconecta com desde=<último id> quando o fluxo cai antes do fim, sem repetir eventos', async () => {
    const urls: string[] = [];
    const respostas = [
      corpoSse([quadro(1, { tipo: 'texto', delta: 'A' }), quadro(2, { tipo: 'texto', delta: 'B' })]),
      corpoSse([quadro(2, { tipo: 'texto', delta: 'B' }), quadro(3, { tipo: 'fim', mensagem: mensagem({ id: 'a1' }) })]),
    ];
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      return new Response(respostas.shift() ?? null, { status: 200 });
    }) as typeof fetch;
    const eventos: [EventoExecucao['tipo'], boolean][] = [];
    const fim = await assinarExecucao({ execucaoId: 'e1', sinal: new AbortController().signal, aoEvento: (e, r) => eventos.push([e.tipo, r]), esperar: semEspera });
    expect(fim).toBe('fim');
    expect(urls).toEqual(['/api/assistente/execucoes/e1/eventos?desde=0', '/api/assistente/execucoes/e1/eventos?desde=2']);
    expect(eventos).toEqual([['texto', true], ['texto', false], ['fim', false]]);
  });

  it('execução que não existe mais (404) termina como "perdido"', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;
    const fim = await assinarExecucao({ execucaoId: 'x', sinal: new AbortController().signal, aoEvento: () => undefined, esperar: semEspera });
    expect(fim).toBe('perdido');
  });

  it('desiste depois de falhar várias vezes seguidas', async () => {
    const chamada = vi.fn(async () => {
      throw new TypeError('rede caiu');
    });
    globalThis.fetch = chamada as unknown as typeof fetch;
    const fim = await assinarExecucao({ execucaoId: 'x', sinal: new AbortController().signal, aoEvento: () => undefined, esperar: semEspera, maxTentativas: 2 });
    expect(fim).toBe('perdido');
    expect(chamada).toHaveBeenCalledTimes(3);
  });

  it('para quando a tela aborta', async () => {
    const controle = new AbortController();
    globalThis.fetch = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      controle.abort();
      throw init?.signal?.reason ?? new DOMException('abortado', 'AbortError');
    }) as typeof fetch;
    const fim = await assinarExecucao({ execucaoId: 'x', sinal: controle.signal, aoEvento: () => undefined, esperar: semEspera });
    expect(fim).toBe('abortado');
  });
});
