import { montarMovimentos } from './movimentos';
import { fluxoDeCaixa, resumoDoMes } from './resumo';
import { cartao, transacao } from './testing/fabrica';
import type { Transacao } from './types';

// A transferência para si mesmo daqui tem o outro lado numa conta conectada (nenhuma "de fora"):
// é dinheiro trocando de lugar. As que cruzam a fronteira do Fluxo estão em movimentos.spec.ts.
const ctx = { documentosDoTitular: ['12345678909'], nomesDoTitular: ['fulano de tal'], transferenciasDeFora: new Set<string>() };
const mov = (ts: Transacao[]) => montarMovimentos(ts, ctx, [], new Map());

// Um mês típico: salário, mercado no débito, compra no cartão, fatura paga,
// dinheiro guardado na caixinha e um estorno.
const julho = mov([
  transacao({ id: 's', sentido: 'ENTRADA', descricao: 'Salario', valor: 500000, data: '2026-07-05' }),
  transacao({ id: 'm', descricao: 'Supermercado', valor: 40000, data: '2026-07-06' }),
  cartao({ id: 'c', descricao: 'iFood', valor: 8000, data: '2026-07-07' }),
  cartao({ id: 'e', sentido: 'ENTRADA', descricao: 'Estorno iFood', valor: 3000, data: '2026-07-08' }),
  transacao({ id: 'f', descricao: 'Pagamento de fatura', valor: 120000, data: '2026-07-15' }),
  cartao({ id: 'fp', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 120000, data: '2026-07-15' }),
  transacao({ id: 'g', descricao: 'Aplicação RDB', valor: 100000, data: '2026-07-16' }),
  transacao({ id: 'r', sentido: 'ENTRADA', descricao: 'Resgate RDB', valor: 20000, data: '2026-07-20' }),
  transacao({ id: 'p', descricao: 'Pix', contraparteNome: 'Fulano de Tal', valor: 5000, data: '2026-07-21' }),
  transacao({ id: 'x', descricao: 'Supermercado', valor: 999, data: '2026-08-01' }),
]);

describe('resumoDoMes (competência)', () => {
  const r = resumoDoMes(julho, '2026-07');

  it('receita é só o que entrou de fora', () => {
    expect(r.receitas).toBe(500000);
  });

  it('despesa soma débito e cartão, abate estorno e ignora fatura, caixinha e transferência', () => {
    expect(r.despesas).toBe(40000 + 8000 - 3000);
  });

  it('guardado é o líquido da caixinha no mês', () => {
    expect(r.guardado).toBe(100000 - 20000);
  });

  it('resultado = receitas − despesas', () => {
    expect(r.resultado).toBe(500000 - 45000);
  });

  it('quebra por categoria em ordem decrescente, com estorno abatido na categoria certa', () => {
    expect(r.porCategoria).toEqual([
      { categoriaId: 'mercado', valor: 40000, quantidade: 1 },
      { categoriaId: 'delivery', valor: 5000, quantidade: 2 },
    ]);
    expect(r.receitasPorCategoria).toEqual([{ categoriaId: 'salario', valor: 500000, quantidade: 1 }]);
  });

  it('mês sem movimento dá tudo zero', () => {
    const vazio = resumoDoMes(julho, '2025-01');
    expect(vazio).toMatchObject({ receitas: 0, despesas: 0, guardado: 0, resultado: 0, porCategoria: [] });
  });
});

describe('fluxoDeCaixa', () => {
  const f = fluxoDeCaixa(julho, '2026-07');

  it('só olha a conta: compras no cartão não saem do caixa', () => {
    expect(f.entradas.receitas).toBe(500000);
    expect(f.saidas.despesas).toBe(40000);
  });

  it('o cartão sai do caixa quando a fatura é paga', () => {
    expect(f.saidas.faturas).toBe(120000);
  });

  it('caixinha e transferências aparecem separadas', () => {
    expect(f.saidas.guardado).toBe(100000);
    expect(f.entradas.resgates).toBe(20000);
    expect(f.saidas.transferencias).toBe(5000);
  });

  it('variação = tudo que entrou − tudo que saiu da conta', () => {
    expect(f.variacao).toBe(500000 + 20000 - 40000 - 120000 - 100000 - 5000);
  });
});
