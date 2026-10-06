import type { ResumoConversa } from '../../api/tipos-assistente';

export interface GrupoConversas {
  nome: string;
  conversas: ResumoConversa[];
}

const ORDEM = ['Fixadas', 'Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 30 dias', 'Mais antigas'] as const;
type NomeGrupo = (typeof ORDEM)[number];

const MS_DIA = 86_400_000;

/** Dias de calendário (no fuso local) entre a data e "agora": 0 = hoje, 1 = ontem. */
function diasAtras(iso: string, agora: Date): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((inicio(agora) - inicio(d)) / MS_DIA);
}

function grupoDe(c: ResumoConversa, agora: Date): NomeGrupo {
  if (c.fixada) return 'Fixadas';
  const dias = diasAtras(c.atualizadaEm, agora);
  if (dias <= 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  if (dias <= 7) return 'Últimos 7 dias';
  if (dias <= 30) return 'Últimos 30 dias';
  return 'Mais antigas';
}

/**
 * Agrupa como no Claude: fixadas no topo, depois por quando foram mexidas pela
 * última vez. Dentro de cada grupo, a mais recente primeiro. `agora` é injetável
 * para os testes não dependerem do relógio.
 */
export function agruparConversas(conversas: ResumoConversa[], agora: Date = new Date()): GrupoConversas[] {
  const mapa = new Map<NomeGrupo, ResumoConversa[]>();
  for (const c of conversas) {
    const nome = grupoDe(c, agora);
    mapa.set(nome, [...(mapa.get(nome) ?? []), c]);
  }
  return ORDEM.filter((nome) => mapa.has(nome)).map((nome) => ({
    nome,
    conversas: [...(mapa.get(nome) ?? [])].sort((a, b) => (Date.parse(b.atualizadaEm) || 0) - (Date.parse(a.atualizadaEm) || 0)),
  }));
}
