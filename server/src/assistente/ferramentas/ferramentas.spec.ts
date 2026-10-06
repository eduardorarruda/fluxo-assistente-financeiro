import { abrirBanco } from '../../db/conexao';
import { Repositorio } from '../../dados/repositorio';
import { gerarDadosDemo, ID_CONEXAO_DEMO } from '../../provedores/provedor-demo';
import { relogioFixo } from '../../relogio';
import { Financas } from '../../servicos/financas';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { Ferramentas, type Buscador } from './ferramentas';
import { mesLegivel, reais } from './formato';

const HOJE = '2026-09-24';

function montar(buscador?: Partial<Buscador>) {
  const relogio = relogioFixo(HOJE);
  const banco = abrirBanco(':memory:');
  const repo = new Repositorio(banco, relogio);
  repo.criarConexao(ID_CONEXAO_DEMO, 'demo', 'Nubank');
  repo.aplicarSincronizacao(gerarDadosDemo(HOJE));
  const financas = new Financas(repo, relogio);
  const assistente = new RepositorioAssistente(banco, relogio);
  assistente.criarConversa({ id: 'c1', titulo: 't', provedor: 'claude', modelo: null });
  const textos = new Map<string, string>([['x1', 'Página 1: saldo devedor R$ 900,00. '.repeat(10)]]);
  const busca: Buscador = {
    buscar: buscador?.buscar ?? (async () => [{ fonte: 'anexo', refId: 'x1', escopo: 'conversa:c1', texto: 'saldo devedor', pontuacao: 0.03 }]),
    modo: buscador?.modo ?? (() => 'palavras'),
  };
  const ferramentas = new Ferramentas(financas, assistente, busca, { texto: (id) => textos.get(id) ?? null });
  return { ferramentas, financas, assistente };
}

const CTX = { conversaId: 'c1' };

async function chamar(f: Ferramentas, nome: string, entrada: unknown = {}) {
  const r = await f.executar(nome, entrada, CTX);
  return { ...r, dados: r.ok ? (JSON.parse(r.texto) as Record<string, any>) : null };
}

describe('formato', () => {
  it('centavos viram reais com duas casas', () => {
    expect(reais(123456)).toBe(1234.56);
    expect(reais(-5)).toBe(-0.05);
  });

  it('mês legível', () => {
    expect(mesLegivel('2026-09')).toBe('set/2026');
    expect(mesLegivel('2027-01')).toBe('jan/2027');
  });
});

describe('Ferramentas', () => {
  it('lista as ferramentas com esquema JSON de objeto para o MCP', () => {
    const { ferramentas } = montar();
    const lista = ferramentas.lista();
    expect(lista.map((f) => f.nome)).toEqual(expect.arrayContaining([
      'panorama', 'resumo_do_mes', 'serie_mensal', 'buscar_movimentos', 'busca_semantica', 'cartoes_e_faturas', 'itens_da_fatura',
      'orcamento', 'metas', 'recorrencias', 'caixinhas_e_investimentos', 'insights', 'categorias', 'anexos', 'ler_anexo',
    ]));
    for (const f of lista) {
      expect(f.inputSchema.type).toBe('object');
      expect(f.descricao.length).toBeGreaterThan(30);
      expect(f.nome).toMatch(/^[a-z_]+$/);
    }
  });

  it('panorama situa o agente: hoje, mês atual, contas e patrimônio em reais', async () => {
    const { ferramentas, financas } = montar();
    const { ok, dados } = await chamar(ferramentas, 'panorama');
    expect(ok).toBe(true);
    expect(dados).toMatchObject({ hoje: HOJE, mesAtual: '2026-09' });
    expect(dados!.patrimonio.total).toBe(reais(financas.visaoGeral('2026-09').patrimonio.total));
    expect(dados!.contas.length).toBeGreaterThan(0);
    expect(dados!.mesesComDados.ultimo).toBe('2026-09');
  });

  it('resumo do mês bate com o da tela, por categoria e com o mês anterior', async () => {
    const { ferramentas, financas } = montar();
    const { dados } = await chamar(ferramentas, 'resumo_do_mes', { mes: '2026-08' });
    const tela = financas.resumo('2026-08');
    expect(dados).toMatchObject({ mes: '2026-08', despesas: reais(tela.despesas), receitas: reais(tela.receitas) });
    expect(dados!.gastosPorCategoria[0]).toEqual(expect.objectContaining({ categoria: expect.any(String), valor: expect.any(Number) }));
    expect(dados!.mesAnterior.despesas).toBe(reais(financas.resumo('2026-07').despesas));
  });

  it('resumo sem mês usa o mês atual', async () => {
    const { ferramentas } = montar();
    expect((await chamar(ferramentas, 'resumo_do_mes')).dados!.mes).toBe('2026-09');
  });

  it('série mensal respeita o intervalo e recusa intervalos enormes', async () => {
    const { ferramentas } = montar();
    const { dados } = await chamar(ferramentas, 'serie_mensal', { de: '2026-01', ate: '2026-03' });
    expect(dados!.meses.map((m: { mes: string }) => m.mes)).toEqual(['2026-01', '2026-02', '2026-03']);
    const grande = await chamar(ferramentas, 'serie_mensal', { de: '2020-01', ate: '2026-09' });
    expect(grande.ok).toBe(false);
  });

  it('busca movimentos por texto, período e valor, com totais', async () => {
    const { ferramentas, financas } = montar();
    const algum = financas.todosOsMovimentos().find((m) => m.natureza === 'DESPESA' && m.valor > 1000)!;
    const palavra = algum.descricao.split(/\s+/)[0]!;
    const { dados } = await chamar(ferramentas, 'buscar_movimentos', { texto: palavra, de: '2026-01-01', ate: HOJE, valorMin: 0.01, limite: 5 });
    expect(dados!.total).toBeGreaterThan(0);
    expect(dados!.itens.length).toBeLessThanOrEqual(5);
    for (const i of dados!.itens) {
      expect(i.data >= '2026-01-01' && i.data <= HOJE).toBe(true);
      expect(`${i.descricao} ${i.estabelecimento ?? ''} ${i.contraparte ?? ''}`.toLowerCase()).toContain(palavra.toLowerCase());
    }
    expect(typeof dados!.totalGastos).toBe('number');
  });

  it('aceita categoria pelo nome ou pelo id', async () => {
    const { ferramentas } = montar();
    const porNome = await chamar(ferramentas, 'buscar_movimentos', { categoria: 'mercado', mes: '2026-08' });
    const porId = await chamar(ferramentas, 'buscar_movimentos', { categoria: 'Mercado', mes: '2026-08' });
    expect(porNome.dados!.total).toBe(porId.dados!.total);
    expect(porNome.dados!.itens.every((i: { categoria: string }) => i.categoria === 'Mercado')).toBe(true);
  });

  it('categoria desconhecida é erro com a lista das válidas', async () => {
    const { ferramentas } = montar();
    const r = await chamar(ferramentas, 'buscar_movimentos', { categoria: 'foguetes' });
    expect(r.ok).toBe(false);
    expect(r.texto).toContain('Mercado');
  });

  it('ordena por valor quando pedido', async () => {
    const { ferramentas } = montar();
    const { dados } = await chamar(ferramentas, 'buscar_movimentos', { mes: '2026-08', ordem: 'valor', limite: 10 });
    const valores = dados!.itens.map((i: { valor: number }) => i.valor);
    expect(valores).toEqual([...valores].sort((a: number, b: number) => b - a));
  });

  it('entrada inválida volta como erro legível, sem lançar', async () => {
    const { ferramentas } = montar();
    const r = await chamar(ferramentas, 'resumo_do_mes', { mes: 'setembro' });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/mes/);
  });

  it('ferramenta que não existe é erro', async () => {
    const { ferramentas } = montar();
    expect((await ferramentas.executar('apagar_tudo', {}, CTX)).ok).toBe(false);
  });

  it('busca semântica procura nos movimentos e nos anexos da própria conversa', async () => {
    let escopos: string[] = [];
    const { ferramentas } = montar({ buscar: async (_c, o) => ((escopos = o.escopos), []) });
    await chamar(ferramentas, 'busca_semantica', { consulta: 'comida fora de casa' });
    expect(escopos).toEqual(['movimentos', 'conversa:c1']);
    await chamar(ferramentas, 'busca_semantica', { consulta: 'extrato', fontes: ['anexos'] });
    expect(escopos).toEqual(['conversa:c1']);
  });

  it('busca semântica completa os movimentos achados com os dados deles', async () => {
    const { ferramentas: f0, financas } = montar();
    const m = financas.todosOsMovimentos()[0]!;
    const { ferramentas } = montar({ buscar: async () => [{ fonte: 'movimento', refId: m.id, escopo: 'movimentos', texto: m.descricao, pontuacao: 1 }] });
    const { dados } = await chamar(ferramentas, 'busca_semantica', { consulta: 'algo' });
    expect(dados!.resultados[0]).toMatchObject({ fonte: 'movimento', movimento: { id: m.id, data: m.data, valor: reais(m.valor) } });
    expect(f0).toBeDefined();
  });

  it('cartões, orçamento, metas, recorrências, caixinhas, insights e categorias respondem', async () => {
    const { ferramentas } = montar();
    for (const nome of ['cartoes_e_faturas', 'orcamento', 'metas', 'recorrencias', 'caixinhas_e_investimentos', 'insights', 'categorias']) {
      const r = await chamar(ferramentas, nome);
      expect(r.ok, nome).toBe(true);
    }
  });

  it('itens da fatura de um cartão', async () => {
    const { ferramentas, financas } = montar();
    const cartao = financas.cartoes()[0]!;
    const { dados } = await chamar(ferramentas, 'itens_da_fatura', { contaId: cartao.contaId, mes: cartao.faturaAtual });
    expect(dados!.itens.length).toBeGreaterThan(0);
    expect(dados!.total).toBeCloseTo(dados!.itens.reduce((s: number, i: { valor: number; sentido: string }) => s + (i.sentido === 'SAIDA' ? i.valor : -i.valor), 0), 2);
  });

  it('anexos e leitura paginada do texto de um anexo da conversa', async () => {
    const { ferramentas, assistente } = montar();
    assistente.criarAnexo({ id: 'x1', conversaId: 'c1', nome: 'extrato.pdf', mime: 'application/pdf', tipo: 'pdf', tamanho: 10, arquivo: 'x1.pdf', sha256: 'h' });
    const lista = await chamar(ferramentas, 'anexos');
    expect(lista.dados!.anexos).toEqual([expect.objectContaining({ id: 'x1', nome: 'extrato.pdf' })]);
    const pagina = await chamar(ferramentas, 'ler_anexo', { anexoId: 'x1', inicio: 0, limite: 100 });
    expect(pagina.dados).toMatchObject({ nome: 'extrato.pdf', inicio: 0, temMais: true });
    expect(pagina.dados!.texto).toHaveLength(100);
  });

  it('não lê anexo de outra conversa', async () => {
    const { ferramentas, assistente } = montar();
    assistente.criarConversa({ id: 'c2', titulo: 'outra', provedor: 'claude', modelo: null });
    assistente.criarAnexo({ id: 'x1', conversaId: 'c2', nome: 'segredo.pdf', mime: 'application/pdf', tipo: 'pdf', tamanho: 10, arquivo: 'x1.pdf', sha256: 'h' });
    expect((await chamar(ferramentas, 'ler_anexo', { anexoId: 'x1' })).ok).toBe(false);
  });

  it('rótulos legíveis para a tela', () => {
    const { ferramentas } = montar();
    expect(ferramentas.rotulo('resumo_do_mes', { mes: '2026-09' })).toBe('Resumo de set/2026');
    expect(ferramentas.rotulo('buscar_movimentos', { texto: 'ifood' })).toBe('Movimentos: “ifood”');
    expect(ferramentas.rotulo('busca_semantica', { consulta: 'comida' })).toBe('Busca: “comida”');
    expect(ferramentas.rotulo('nao_existe', {})).toBe('nao_existe');
  });
});
