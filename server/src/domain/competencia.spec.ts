import { cicloDoCartao, competencia, mesDaFatura } from './competencia';
import { cartao, conta, transacao } from './testing/fabrica';

describe('competencia', () => {
  it('movimento comum pertence ao mês da data', () => {
    expect(competencia(transacao({ data: '2026-07-31' }))).toBe('2026-07');
  });

  it('parcela k de compra com todas as parcelas na mesma data vai para compra + (k-1)', () => {
    const t = cartao({ data: '2026-07-10', parcela: { numero: 3, total: 10, valorTotal: 100000, dataCompra: '2026-07-10' } });
    expect(competencia(t)).toBe('2026-09');
  });

  it('parcela que o provedor já datou no mês dela não é deslocada de novo', () => {
    const t = cartao({ data: '2026-09-10', parcela: { numero: 3, total: 10, valorTotal: 100000, dataCompra: '2026-07-10' } });
    expect(competencia(t)).toBe('2026-09');
  });

  it('parcela sem data de compra usa a data do movimento', () => {
    const t = cartao({ data: '2026-07-10', parcela: { numero: 2, total: 3, valorTotal: null, dataCompra: null } });
    expect(competencia(t)).toBe('2026-07');
  });
});

describe('mesDaFatura', () => {
  const nubank = conta({ id: 'cartao', tipo: 'CARTAO', fechamento: '2026-07-08', vencimento: '2026-07-15' });

  it('usa a fatura informada pelo provedor quando existe', () => {
    const faturas = new Map([['f1', { vencimento: '2026-08-15' }]]);
    expect(mesDaFatura(cartao({ faturaId: 'f1', data: '2026-07-01' }), nubank, faturas)).toBe('2026-08');
  });

  it('usa a previsão de fatura do Open Finance quando não há fatura', () => {
    expect(mesDaFatura(cartao({ faturaPrevista: '2026-09', data: '2026-07-01' }), nubank, new Map())).toBe('2026-09');
  });

  it('compra antes do fechamento cai na fatura que vence no mesmo mês (vence depois de fechar)', () => {
    expect(mesDaFatura(cartao({ data: '2026-07-05' }), nubank, new Map())).toBe('2026-07');
  });

  it('compra no dia do fechamento ou depois vai para a fatura seguinte', () => {
    expect(mesDaFatura(cartao({ data: '2026-07-08' }), nubank, new Map())).toBe('2026-08');
    expect(mesDaFatura(cartao({ data: '2026-07-20' }), nubank, new Map())).toBe('2026-08');
  });

  it('quando o vencimento vem antes do fechamento no calendário, a fatura vence no mês seguinte ao fechamento', () => {
    const c = conta({ tipo: 'CARTAO', fechamento: '2026-07-28', vencimento: '2026-08-05' });
    expect(mesDaFatura(cartao({ data: '2026-07-10' }), c, new Map())).toBe('2026-08');
    expect(mesDaFatura(cartao({ data: '2026-07-29' }), c, new Map())).toBe('2026-09');
  });

  it('parcelas com a mesma data se espalham pelas faturas seguintes', () => {
    const t = cartao({ data: '2026-07-05', parcela: { numero: 4, total: 6, valorTotal: 60000, dataCompra: '2026-07-05' } });
    expect(mesDaFatura(t, nubank, new Map())).toBe('2026-10');
  });

  it('sem dados de fechamento, assume o ciclo mais comum do Nubank (fecha 7 dias antes de vencer)', () => {
    const semDatas = conta({ tipo: 'CARTAO', fechamento: null, vencimento: null });
    expect(mesDaFatura(cartao({ data: '2026-07-01' }), semDatas, new Map())).toBe('2026-07');
    expect(mesDaFatura(cartao({ data: '2026-07-25' }), semDatas, new Map())).toBe('2026-08');
  });
});

describe('competencia — casos da revisão', () => {
  it('data da compra um dia antes da parcela (fuso) não impede o deslocamento', () => {
    const t = cartao({ data: '2026-01-20', parcela: { numero: 3, total: 10, valorTotal: 1000, dataCompra: '2026-01-19' } });
    expect(competencia(t)).toBe('2026-03');
  });

  it('compra no dia 31 com a parcela datada no dia 1º do mês seguinte', () => {
    const t = cartao({ data: '2026-02-01', parcela: { numero: 3, total: 10, valorTotal: 1000, dataCompra: '2026-01-31' } });
    expect(competencia(t)).toBe('2026-03');
  });
});

describe('ciclo do cartão sem fechamento informado', () => {
  const semFechamento = conta({ id: 'cartao', tipo: 'CARTAO', fechamento: null, vencimento: '2026-08-11' });
  const faturas = new Map([
    ['fago', { vencimento: '2026-08-11', fechamento: '2026-08-04' }],
    ['fset', { vencimento: '2026-09-11', fechamento: '2026-09-04' }],
  ]);

  it('deriva o dia de fechamento e de vencimento da fatura mais recente do banco', () => {
    expect(cicloDoCartao(semFechamento, faturas.values())).toEqual({ fechamento: '2026-09-04', vencimento: '2026-09-11' });
  });

  it('fechamento da conta mais novo que a última fatura vale', () => {
    const atual = { ...semFechamento, fechamento: '2026-10-05', vencimento: '2026-10-12' };
    expect(cicloDoCartao(atual, faturas.values())).toEqual({ fechamento: '2026-10-05', vencimento: '2026-10-12' });
  });

  it('compra depois do dia 4 (e antes do padrão, dia 8) vai para a fatura seguinte', () => {
    expect(mesDaFatura(cartao({ data: '2026-09-06' }), semFechamento, faturas)).toBe('2026-10');
    expect(mesDaFatura(cartao({ data: '2026-09-03' }), semFechamento, faturas)).toBe('2026-09');
  });
});
