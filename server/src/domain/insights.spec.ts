import { gerarInsights } from './insights';
import { montarMovimentos } from './movimentos';
import { cartao } from './testing/fabrica';
import type { Transacao } from './types';

const mov = (ts: Transacao[]) => montarMovimentos(ts, { documentosDoTitular: [], nomesDoTitular: [] }, [], new Map());

describe('gerarInsights', () => {
  const movimentos = mov([
    ...['04', '05', '06'].map((m, i) => cartao({ id: `d${i}`, descricao: 'iFood', valor: 30000, data: `2026-${m}-10` })),
    cartao({ id: 'a1', descricao: 'iFood', valor: 50000, data: '2026-07-03' }),
    cartao({ id: 'a2', descricao: 'iFood', valor: 40000, data: '2026-07-05' }), // domingo
    cartao({ id: 'a3', descricao: 'Supermercado', valor: 20000, data: '2026-07-05' }),
  ]);
  const i = gerarInsights(movimentos, '2026-07', '2026-07-10');

  it('compara cada categoria com a média dos 3 meses anteriores', () => {
    expect(i.variacoes[0]).toEqual({ categoriaId: 'delivery', atual: 90000, anterior: 30000, media3: 30000, delta: 60000 });
  });

  it('agrupa os estabelecimentos e ordena pelo total', () => {
    expect(i.estabelecimentos[0]).toMatchObject({ nome: 'iFood', total: 90000, vezes: 2 });
  });

  it('curva de ritmo acumulada, parando em hoje no mês corrente', () => {
    expect(i.ritmo[2]).toEqual({ dia: 3, atual: 50000, anterior: 0 });
    expect(i.ritmo[9]).toEqual({ dia: 10, atual: 110000, anterior: 30000 });
    expect(i.ritmo[10]?.atual).toBeNull();
    expect(i.ritmo).toHaveLength(31);
  });

  it('gasto por dia da semana, ticket médio e média diária', () => {
    expect(i.porDiaDaSemana[0]).toBe(60000);
    expect(i.quantidade).toBe(3);
    expect(i.ticketMedio).toBe(36667);
    expect(i.mediaDiaria).toBe(11000);
    expect(i.maioresGastos.map((g) => g.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('mês passado usa o mês inteiro', () => {
    const passado = gerarInsights(movimentos, '2026-06', '2026-07-10');
    expect(passado.ritmo.at(-1)?.atual).toBe(30000);
    expect(passado.mediaDiaria).toBe(1000);
  });
});
