import { useEstado } from '../api/consultas';
import { usePreferencias } from './preferencias';

/** Mês que as telas mostram: o escolhido no seletor, ou o mês corrente. */
export function useMes(): { mes: string; mesAtual: string; meses: string[]; definirMes: (m: string) => void } {
  const { mes, definirMes } = usePreferencias();
  const { data } = useEstado();
  const mesAtual = data?.mesAtual ?? new Date().toISOString().slice(0, 7);
  return { mes: mes ?? mesAtual, mesAtual, meses: data?.mesesDisponiveis ?? [mesAtual], definirMes };
}

/** Categorias por id, para as telas acharem nome/cor/ícone. */
export { useCategoriaPorId } from './categorias';
