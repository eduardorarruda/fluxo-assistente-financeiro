import { calcularPatrimonio } from './patrimonio';
import { conta } from './testing/fabrica';
import type { Caixinha, Investimento } from './types';

const caixinha = (p: Partial<Caixinha>): Caixinha =>
  ({ id: 'cx', contaId: 'conta', nome: 'Viagem', valor: 0, indexador: 'CDI', percentualIndexador: 1, ...p });
const investimento = (p: Partial<Investimento>): Investimento => ({
  id: 'i', conexaoId: 'c1', nome: 'CDB', tipo: 'FIXED_INCOME', subtipo: 'CDB', saldo: 0,
  valorAplicado: null, rendimento: null, vencimento: null, taxa: null, indexador: null, ...p,
});

describe('calcularPatrimonio', () => {
  const contas = [conta({ saldo: 300000 }), conta({ id: 'cartao', tipo: 'CARTAO', saldo: 120000 })];

  it('contas + caixinhas + investimentos − fatura em aberto', () => {
    const p = calcularPatrimonio(contas, [caixinha({ valor: 500000 })], [investimento({ saldo: 100000 })], { caixinhasNoSaldo: false });
    expect(p).toMatchObject({ contas: 300000, caixinhas: 500000, investimentos: 100000, faturaAberta: 120000, total: 780000 });
  });

  it('caixinha que também vem como investimento não conta duas vezes', () => {
    const p = calcularPatrimonio(
      contas,
      [caixinha({ nome: 'Reserva de Emergência', valor: 500000 })],
      [investimento({ id: 'rdb', nome: 'Reserva de emergencia', saldo: 500000 }), investimento({ id: 'x', nome: 'Caixinha Turbo', saldo: 1 })],
      { caixinhasNoSaldo: false },
    );
    expect(p.investimentos).toBe(0);
    expect(p.duplicados).toEqual(['rdb', 'x']);
    expect(p.total).toBe(300000 + 500000 - 120000);
  });

  it('se o banco já inclui as caixinhas no saldo, elas não somam de novo', () => {
    const p = calcularPatrimonio(contas, [caixinha({ valor: 500000 })], [], { caixinhasNoSaldo: true });
    expect(p.total).toBe(300000 - 120000);
    expect(p.caixinhas).toBe(500000);
  });

  it('saldo credor no cartão (pagou a mais) não vira dívida negativa', () => {
    const p = calcularPatrimonio([conta({ id: 'k', tipo: 'CARTAO', saldo: -5000 })], [], [], { caixinhasNoSaldo: false });
    expect(p.faturaAberta).toBe(0);
  });
});
