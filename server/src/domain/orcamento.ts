import { diaDoMes, diasNoMes, mesDe } from './datas';
import { proporcao } from './dinheiro';
import type { ResumoMes } from './resumo';
import type { Centavos, Dia, Mes } from './types';

export type SituacaoOrcamento = 'TRANQUILO' | 'ATENCAO' | 'ESTOUROU';

export interface LinhaOrcamento {
  categoriaId: string;
  limite: Centavos;
  gasto: Centavos;
  restante: Centavos;
  percentual: number;
  situacao: SituacaoOrcamento;
  /** Quanto "deveria" ter sido gasto até hoje para fechar o mês no limite. */
  esperadoAteHoje: Centavos;
  /** Onde o mês termina se o ritmo continuar. Igual ao gasto em mês fechado. */
  projecao: Centavos;
}

/**
 * Orçamento do mês por categoria. No mês corrente, compara o gasto com o
 * ritmo esperado: 60% do limite gasto no dia 10 é bem diferente de no dia 28.
 */
export function avaliarOrcamento(limites: ReadonlyMap<string, Centavos>, resumo: ResumoMes, hoje: Dia): LinhaOrcamento[] {
  const gastoPorCategoria = new Map(resumo.porCategoria.map((c) => [c.categoriaId, c.valor]));
  const fracao = fracaoDoMes(resumo.mes, hoje);

  return [...limites.entries()]
    .filter(([, limite]) => limite > 0)
    .map(([categoriaId, limite]) => {
      const gasto = Math.max(0, gastoPorCategoria.get(categoriaId) ?? 0);
      const percentual = proporcao(gasto, limite);
      const projecao = fracao >= 1 || fracao === 0 ? gasto : Math.round(gasto / fracao);
      const situacao: SituacaoOrcamento =
        percentual > 1 ? 'ESTOUROU' : percentual >= 0.8 || projecao > limite ? 'ATENCAO' : 'TRANQUILO';
      return {
        categoriaId,
        limite,
        gasto,
        restante: limite - gasto,
        percentual,
        situacao,
        esperadoAteHoje: Math.round(limite * Math.min(1, fracao)),
        projecao,
      };
    })
    .sort((a, b) => b.percentual - a.percentual);
}

/** Quanto do mês já passou: 0 no futuro, 1 no passado, dia/dias no corrente. */
export function fracaoDoMes(mes: Mes, hoje: Dia): number {
  const atual = mesDe(hoje);
  if (mes < atual) return 1;
  if (mes > atual) return 0;
  return diaDoMes(hoje) / diasNoMes(mes);
}
