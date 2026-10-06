import { avaliarOrcamento, fracaoDoMes } from './orcamento';
import type { ResumoMes } from './resumo';

const resumo = (porCategoria: ResumoMes['porCategoria'], mes = '2026-07'): ResumoMes =>
  ({ mes, receitas: 0, despesas: 0, guardado: 0, resultado: 0, porCategoria, receitasPorCategoria: [] });

describe('avaliarOrcamento', () => {
  const limites = new Map([['mercado', 100000], ['lazer', 50000], ['viagem', 0]]);

  it('mês fechado: compara o gasto com o limite', () => {
    const linhas = avaliarOrcamento(limites, resumo([
      { categoriaId: 'mercado', valor: 110000, quantidade: 5 },
      { categoriaId: 'lazer', valor: 10000, quantidade: 1 },
    ]), '2026-08-10');
    expect(linhas.map((l) => [l.categoriaId, l.situacao, l.restante])).toEqual([
      ['mercado', 'ESTOUROU', -10000],
      ['lazer', 'TRANQUILO', 40000],
    ]);
  });

  it('limite zero não aparece', () => {
    expect(avaliarOrcamento(limites, resumo([]), '2026-08-10').some((l) => l.categoriaId === 'viagem')).toBe(false);
  });

  it('mês corrente: alerta pelo ritmo mesmo abaixo de 80%', () => {
    // Dia 10 de 31 com 50% gasto → projeção de ~155%.
    const [mercado] = avaliarOrcamento(new Map([['mercado', 100000]]), resumo([
      { categoriaId: 'mercado', valor: 50000, quantidade: 2 },
    ]), '2026-07-10');
    expect(mercado?.situacao).toBe('ATENCAO');
    expect(mercado?.projecao).toBe(155000);
    expect(mercado?.esperadoAteHoje).toBe(32258);
  });

  it('estorno maior que o gasto não deixa o gasto negativo', () => {
    const [l] = avaliarOrcamento(new Map([['compras', 1000]]), resumo([
      { categoriaId: 'compras', valor: -500, quantidade: 1 },
    ]), '2026-08-01');
    expect(l?.gasto).toBe(0);
  });

  it('fração do mês', () => {
    expect(fracaoDoMes('2026-06', '2026-07-10')).toBe(1);
    expect(fracaoDoMes('2026-08', '2026-07-10')).toBe(0);
  });
});
