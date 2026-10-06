import { diferencaEmMeses, mesDe, somarMeses } from './datas';
import type { Centavos, Dia, Mes } from './types';

export interface Meta {
  id: string;
  nome: string;
  alvo: Centavos;
  prazo: Mes | null;
  caixinhaId: string | null;
  valorManual: Centavos;
  icone: string;
  cor: string;
}

export interface ProgressoMeta {
  metaId: string;
  atual: Centavos;
  falta: Centavos;
  percentual: number;
  concluida: boolean;
  /** Quanto guardar por mês para chegar no prazo (null sem prazo). */
  porMes: Centavos | null;
  /** Ritmo real, pelo histórico da caixinha nos últimos meses. */
  ritmoMensal: Centavos | null;
  /** Mês em que chega, mantendo o ritmo real (null se o ritmo não chega nunca). */
  previsao: Mes | null;
  noRitmo: boolean | null;
}

/**
 * Progresso de uma meta. Metas ligadas a uma caixinha andam sozinhas: o valor
 * é o saldo dela e o ritmo vem do histórico (`serie`, um ponto por mês).
 */
export function progressoDaMeta(
  meta: Meta,
  valorCaixinha: Centavos | null,
  serie: readonly { mes: Mes; valor: Centavos }[],
  hoje: Dia,
): ProgressoMeta {
  const atual = meta.caixinhaId && valorCaixinha !== null ? valorCaixinha : meta.valorManual;
  const falta = Math.max(0, meta.alvo - atual);
  const mesAtual = mesDe(hoje);

  const mesesAtePrazo = meta.prazo ? diferencaEmMeses(mesAtual, meta.prazo) : null;
  const porMes = mesesAtePrazo === null ? null : falta === 0 ? 0 : Math.ceil(falta / Math.max(1, mesesAtePrazo));

  const ordenada = [...serie].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-4);
  let ritmoMensal: Centavos | null = null;
  if (ordenada.length >= 2) {
    const primeiro = ordenada[0]!;
    const ultimo = ordenada[ordenada.length - 1]!;
    const meses = diferencaEmMeses(primeiro.mes, ultimo.mes);
    if (meses > 0) ritmoMensal = Math.round((ultimo.valor - primeiro.valor) / meses);
  }

  let previsao: Mes | null = null;
  if (falta === 0) previsao = mesAtual;
  else if (ritmoMensal && ritmoMensal > 0) previsao = somarMeses(mesAtual, Math.ceil(falta / ritmoMensal));

  return {
    metaId: meta.id,
    atual,
    falta,
    percentual: meta.alvo > 0 ? Math.min(1, atual / meta.alvo) : 0,
    concluida: falta === 0,
    porMes,
    ritmoMensal,
    previsao,
    noRitmo: meta.prazo === null ? null : falta === 0 || (previsao !== null && previsao <= meta.prazo),
  };
}
