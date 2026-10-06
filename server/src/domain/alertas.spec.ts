import { gerarAlertas, type EntradaAlertas } from './alertas';
import type { FaturaMes } from './cartao';

const base: EntradaAlertas = {
  hoje: '2026-07-10', orcamento: [], faturas: [], recorrencias: [], saldoContas: 100000, conexoes: [],
  nomeCategoria: (id) => id.toUpperCase(),
};
const fatura = (p: Partial<FaturaMes>): FaturaMes => ({
  contaId: 'k', mes: '2026-07', vencimento: '2026-07-15', total: 150000, somaItens: 150000, pago: 0,
  quantidade: 3, situacao: 'FECHADA', quitacao: null, porCategoria: [], ...p,
});

describe('gerarAlertas', () => {
  it('conexão quebrada é crítica e vem primeiro', () => {
    const a = gerarAlertas({
      ...base,
      faturas: [fatura({})],
      conexoes: [{ id: 'i', nome: 'Nubank', situacao: 'LOGIN_ERROR', ultimaSincronizacao: null }],
    });
    expect(a.map((x) => x.gravidade)).toEqual(['CRITICO', 'ATENCAO']);
    expect(a[0]?.titulo).toBe('Nubank precisa de você');
  });

  it('conexão sem atualizar há mais de 3 dias', () => {
    const [a] = gerarAlertas({ ...base, conexoes: [{ id: 'i', nome: 'Nubank', situacao: 'UPDATED', ultimaSincronizacao: '2026-07-01T10:00:00Z' }] });
    expect(a?.id).toBe('desatualizada:i');
  });

  it('fatura a vencer avisa quando o saldo não cobre', () => {
    const [a] = gerarAlertas({ ...base, faturas: [fatura({})] });
    expect(a?.titulo).toBe('Fatura vence em 5 dias');
    expect(a?.detalhe).toContain('O saldo em conta não cobre.');
  });

  it('fatura vencida é crítica; paga ou distante não avisa', () => {
    expect(gerarAlertas({ ...base, faturas: [fatura({ vencimento: '2026-07-08' })] })[0]?.gravidade).toBe('CRITICO');
    expect(gerarAlertas({ ...base, faturas: [fatura({ pago: 150000 })] })).toEqual([]);
    expect(gerarAlertas({ ...base, faturas: [fatura({ vencimento: '2026-08-15' })] })).toEqual([]);
  });

  it('orçamento estourado e perto do limite', () => {
    const a = gerarAlertas({
      ...base,
      orcamento: [
        { categoriaId: 'lazer', limite: 1000, gasto: 1500, restante: -500, percentual: 1.5, situacao: 'ESTOUROU', esperadoAteHoje: 300, projecao: 1500 },
        { categoriaId: 'mercado', limite: 1000, gasto: 850, restante: 150, percentual: 0.85, situacao: 'ATENCAO', esperadoAteHoje: 300, projecao: 2600 },
        { categoriaId: 'saude', limite: 1000, gasto: 10, restante: 990, percentual: 0.01, situacao: 'TRANQUILO', esperadoAteHoje: 300, projecao: 30 },
      ],
    });
    expect(a.map((x) => x.titulo)).toEqual(['LAZER passou do limite', 'MERCADO perto do limite']);
  });

  it('assinatura que aumentou de preço', () => {
    const [a] = gerarAlertas({
      ...base,
      recorrencias: [{
        chave: 'spotify', nome: 'Spotify', categoriaId: 'assinaturas', valorTipico: 2190, ultimoValor: 2390,
        ultimaData: '2026-07-01', proximaData: '2026-08-01', meses: 4, custoAnual: 26280, ativa: true, aumento: { de: 2190, para: 2390 },
      }],
    });
    expect(a?.titulo).toBe('Spotify ficou mais caro');
  });
});

describe('gerarAlertas — fuso', () => {
  it('sincronização às 22h de Brasília ainda conta como o mesmo dia local', () => {
    // 2026-07-07T01:00Z = 06/07 22h em Brasília. Hoje é 10/07: 4 dias, e não 3.
    const a = gerarAlertas({ ...base, conexoes: [{ id: 'i', nome: 'Nubank', situacao: 'UPDATED', ultimaSincronizacao: new Date(2026, 6, 6, 22, 0).toISOString() }] });
    expect(a.map((x) => x.id)).toContain('desatualizada:i');
  });
});

describe('gerarAlertas — contas a pagar', () => {
  /** O toLocaleString separa "R$" do número com espaço que não quebra. */
  const espacos = (t: string) => t.replace(/\s/g, ' ');
  const conta = (p: Partial<NonNullable<EntradaAlertas['contasAPagar']>[number]>) => ({
    id: 'luz', descricao: 'Conta de luz', valor: 15000, vencimento: '2026-07-12', pagaEm: null, ...p,
  });

  it('vence em até 3 dias: atenção; mais longe não avisa', () => {
    const a = gerarAlertas({ ...base, contasAPagar: [conta({}), conta({ id: 'longe', vencimento: '2026-07-14' })] });
    expect(a.map((x) => ({ ...x, detalhe: espacos(x.detalhe) }))).toEqual([{
      id: 'conta-a-pagar:luz', gravidade: 'ATENCAO', titulo: 'Conta de luz vence em 2 dias',
      detalhe: 'R$ 150,00 a pagar em 12/07.', destino: '/contas-a-pagar',
    }]);
  });

  it('vence hoje, amanhã, e atrasada é crítica', () => {
    const a = gerarAlertas({ ...base, contasAPagar: [
      conta({ id: 'hoje', vencimento: '2026-07-10' }), conta({ id: 'amanha', vencimento: '2026-07-11' }),
      conta({ id: 'atrasada', vencimento: '2026-07-05' }),
    ] });
    expect(a.map((x) => [x.gravidade, x.titulo])).toEqual([
      ['CRITICO', 'Conta de luz está atrasada'],
      ['ATENCAO', 'Conta de luz vence hoje'],
      ['ATENCAO', 'Conta de luz vence amanhã'],
    ]);
    expect(espacos(a[0]?.detalhe ?? '')).toBe('R$ 150,00 · venceu há 5 dias (05/07).');
  });

  it('conta paga não avisa; saldo que não cobre avisa', () => {
    expect(gerarAlertas({ ...base, contasAPagar: [conta({ pagaEm: '2026-07-09' })] })).toEqual([]);
    const [a] = gerarAlertas({ ...base, saldoContas: 100, contasAPagar: [conta({})] });
    expect(a?.detalhe).toContain('O saldo em conta não cobre.');
  });
});
