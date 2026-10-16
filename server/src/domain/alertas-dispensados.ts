import type { Alerta, Gravidade } from './alertas';

/**
 * Avisos que a pessoa dispensou (o "X" do sino). Cada dispensa é guardada pela
 * ASSINATURA do aviso — `id|gravidade` — com o instante em que foi dispensado.
 * Nunca pelo título: ele muda todo dia ("vence em 3 dias", "vence amanhã") e o
 * aviso voltaria sozinho.
 *
 * - Dispensado, o aviso some enquanto continuar o MESMO (mesmo id, gravidade
 *   igual ou menor: quem dispensou o "atrasada" não quer ver o "vence hoje").
 * - Se ele PIORA (perto do limite → estourou, vence logo → atrasada), a
 *   assinatura muda e ele volta.
 * - Quando o aviso deixa de existir (resolvido), a dispensa é esquecida: se o
 *   problema voltar um dia, o aviso volta também.
 */
export type Dispensas = Readonly<Record<string, string>>;

const PESO: Record<Gravidade, number> = { INFO: 0, ATENCAO: 1, CRITICO: 2 };
const GRAVIDADES = Object.keys(PESO) as Gravidade[];

export const assinatura = (a: Pick<Alerta, 'id' | 'gravidade'>): string => `${a.id}|${a.gravidade}`;

/** As assinaturas que escondem este aviso: a dele e as do mesmo id com gravidade maior. */
function quemEsconde(a: Alerta): string[] {
  return GRAVIDADES.filter((g) => PESO[g] >= PESO[a.gravidade]).map((g) => assinatura({ id: a.id, gravidade: g }));
}

export const estaDispensado = (a: Alerta, dispensas: Dispensas): boolean => quemEsconde(a).some((c) => c in dispensas);

/** Separa o que aparece do que a pessoa já dispensou, mantendo a ordem. */
export function separarDispensados(alertas: readonly Alerta[], dispensas: Dispensas): { visiveis: Alerta[]; dispensados: Alerta[] } {
  const visiveis: Alerta[] = [];
  const dispensados: Alerta[] = [];
  for (const a of alertas) (estaDispensado(a, dispensas) ? dispensados : visiveis).push(a);
  return { visiveis, dispensados };
}

/** Só as dispensas que ainda escondem algum aviso de agora; as outras (resolvidas ou que pioraram) são esquecidas. */
export function podarDispensas(dispensas: Dispensas, alertas: readonly Alerta[]): Dispensas {
  const ativas = new Set(alertas.flatMap(quemEsconde));
  return Object.fromEntries(Object.entries(dispensas).filter(([chave]) => ativas.has(chave)));
}

/**
 * Dispensa os avisos de `ids` na gravidade que eles têm AGORA (a do servidor,
 * nunca uma que venha de fora). Id que não é de nenhum aviso atual é ignorado.
 */
export function dispensar(dispensas: Dispensas, alertas: readonly Alerta[], ids: readonly string[], agora: string): Dispensas {
  const pedidos = new Set(ids);
  const novas = alertas.filter((a) => pedidos.has(a.id)).map((a) => [assinatura(a), agora] as const);
  return { ...podarDispensas(dispensas, alertas), ...Object.fromEntries(novas) };
}
