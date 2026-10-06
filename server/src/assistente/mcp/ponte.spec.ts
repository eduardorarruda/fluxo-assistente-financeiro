import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarPonte, urlPermitida } from './ponte';

const URL = 'http://127.0.0.1:8778/api/assistente/ferramentas';

interface Chamada {
  url: string;
  metodo: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
}

/** fetch falso que responde como a API do Fluxo. */
function apiFalsa(resposta: (c: Chamada) => { status: number; corpo: unknown } | Error) {
  const chamadas: Chamada[] = [];
  const buscar = (async (url: string, init?: RequestInit) => {
    const c: Chamada = {
      url: String(url), metodo: init?.method ?? 'GET', cabecalhos: init?.headers as Record<string, string>,
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    chamadas.push(c);
    const r = resposta(c);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { buscar, chamadas };
}

async function conectar(buscar: typeof fetch) {
  const ponte = criarPonte({ url: URL, acesso: 'tok', buscar });
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: 'teste', version: '1' });
  await Promise.all([ponte.connect(lado1), cliente.connect(lado2)]);
  return cliente;
}

const LISTA = [{ nome: 'resumo_do_mes', descricao: 'Resumo de um mês.', inputSchema: { type: 'object', properties: { mes: { type: 'string' } } } }];

describe('ponte MCP', () => {
  it('lista as ferramentas do Fluxo, marcadas como só leitura', async () => {
    const { buscar, chamadas } = apiFalsa(() => ({ status: 200, corpo: LISTA }));
    const cliente = await conectar(buscar);
    const { tools } = await cliente.listTools();
    expect(tools).toEqual([
      expect.objectContaining({
        name: 'resumo_do_mes', description: 'Resumo de um mês.', inputSchema: LISTA[0]!.inputSchema,
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false, openWorldHint: false }),
      }),
    ]);
    expect(chamadas[0]).toMatchObject({ url: URL, metodo: 'GET', cabecalhos: expect.objectContaining({ 'x-fluxo-ponte': 'tok' }) });
  });

  it('ferramentas que mudam dados saem sem readOnlyHint; as que mudam o que existe, com destructiveHint', async () => {
    const lista = [
      { ...LISTA[0]!, efeito: 'leitura' },
      { nome: 'criar_regra_de_categoria', descricao: 'Propõe.', inputSchema: { type: 'object' }, efeito: 'escrita' },
      { nome: 'confirmar_proposta', descricao: 'Executa.', inputSchema: { type: 'object' }, efeito: 'destrutiva' },
    ];
    const { buscar } = apiFalsa(() => ({ status: 200, corpo: lista }));
    const { tools } = await (await conectar(buscar)).listTools();
    expect(tools.map((t) => [t.name, t.annotations])).toEqual([
      ['resumo_do_mes', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }],
      ['criar_regra_de_categoria', { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }],
      ['confirmar_proposta', { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }],
    ]);
  });

  it('repassa a chamada com o token e devolve o texto', async () => {
    const { buscar, chamadas } = apiFalsa(() => ({ status: 200, corpo: { ok: true, texto: '{"despesas":10}' } }));
    const cliente = await conectar(buscar);
    const r = await cliente.callTool({ name: 'resumo_do_mes', arguments: { mes: '2026-09' } });
    expect(r).toMatchObject({ content: [{ type: 'text', text: '{"despesas":10}' }], isError: false });
    expect(chamadas[0]).toMatchObject({
      url: `${URL}/resumo_do_mes`, metodo: 'POST', corpo: { entrada: { mes: '2026-09' } },
      cabecalhos: expect.objectContaining({ 'x-fluxo-ponte': 'tok', 'X-Fluxo': '1', 'Content-Type': 'application/json' }),
    });
  });

  it('erro da ferramenta vira resultado com isError (o modelo pode corrigir)', async () => {
    const { buscar } = apiFalsa(() => ({ status: 200, corpo: { ok: false, texto: 'Entrada inválida — mes' } }));
    const cliente = await conectar(buscar);
    expect(await cliente.callTool({ name: 'resumo_do_mes', arguments: {} })).toMatchObject({ isError: true, content: [{ text: 'Entrada inválida — mes' }] });
  });

  it('Fluxo fora do ar ou recusando não derruba a ponte', async () => {
    const { buscar } = apiFalsa((c) => (c.metodo === 'POST' ? new Error('ECONNREFUSED') : { status: 200, corpo: LISTA }));
    const cliente = await conectar(buscar);
    const r = await cliente.callTool({ name: 'resumo_do_mes', arguments: {} });
    expect(r).toMatchObject({ isError: true });
    expect(JSON.stringify(r)).toContain('Não consegui falar com o Fluxo');
    const recusa = apiFalsa(() => ({ status: 403, corpo: { erro: 'proibido' } }));
    const r2 = await (await conectar(recusa.buscar)).callTool({ name: 'resumo_do_mes', arguments: {} });
    expect(JSON.stringify(r2)).toContain('403');
  });

  it('nome de ferramenta vai codificado na URL', async () => {
    const { buscar, chamadas } = apiFalsa(() => ({ status: 200, corpo: { ok: true, texto: '' } }));
    const cliente = await conectar(buscar);
    await cliente.callTool({ name: '../../conexoes', arguments: {} });
    expect(chamadas[0]?.url).toBe(`${URL}/..%2F..%2Fconexoes`);
  });
});

describe('urlPermitida', () => {
  it('só aceita a API local do próprio Fluxo', () => {
    expect(urlPermitida(URL)).toBe(true);
    expect(urlPermitida('http://localhost:8778/api/assistente/ferramentas')).toBe(true);
    expect(urlPermitida('https://evil.example/api/assistente/ferramentas')).toBe(false);
    expect(urlPermitida('http://127.0.0.1.evil.example/api/assistente/ferramentas')).toBe(false);
    expect(urlPermitida('http://127.0.0.1:8778/api/conexoes')).toBe(false);
    expect(urlPermitida('lixo')).toBe(false);
  });
});
