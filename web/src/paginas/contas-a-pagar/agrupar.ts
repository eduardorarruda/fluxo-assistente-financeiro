import type { ContaAPagar, Dia, Mes, Repeticao } from '../../api/tipos';
import { capitalizar, diaEMes, diasAte, emQuantosDias, nomeDoMes } from '../../util/formato';

/** Seções da lista de contas, na ordem em que aparecem. */
export type ChaveSecao = 'atrasadas' | 'semana' | 'mes' | 'proximas' | 'pagas';

export interface Secao {
  chave: ChaveSecao;
  titulo: string;
  icone: string;
  /** Contas da seção; nas "Próximas", agrupadas por mês. */
  grupos: { mes: Mes | null; titulo: string | null; contas: ContaAPagar[] }[];
}

/** Pagas há mais do que isto saem da lista (continuam guardadas). */
export const DIAS_PAGAS_RECENTES = 45;
const DIAS_DA_SEMANA = 6;

const TITULOS: Record<ChaveSecao, [string, string]> = {
  atrasadas: ['Atrasadas', 'alerta'],
  semana: ['Esta semana', 'relogio'],
  mes: ['Este mês', 'calendario'],
  proximas: ['Próximas', 'seta-dir'],
  pagas: ['Pagas recentemente', 'check'],
};

export function secaoDa(c: ContaAPagar, hoje: Dia): ChaveSecao | null {
  if (c.situacao === 'paga') return diasAte(c.pagaEm ?? c.vencimento, hoje) <= DIAS_PAGAS_RECENTES ? 'pagas' : null;
  if (c.situacao === 'atrasada') return 'atrasadas';
  if (diasAte(hoje, c.vencimento) <= DIAS_DA_SEMANA) return 'semana';
  return c.vencimento.slice(0, 7) === hoje.slice(0, 7) ? 'mes' : 'proximas';
}

/** Atrasadas / Esta semana / Este mês / Próximas (por mês) / Pagas recentes. Seções vazias somem. */
export function agruparContas(contas: readonly ContaAPagar[], hoje: Dia): Secao[] {
  const porSecao = new Map<ChaveSecao, ContaAPagar[]>();
  for (const c of contas) {
    const s = secaoDa(c, hoje);
    if (s) porSecao.set(s, [...(porSecao.get(s) ?? []), c]);
  }
  const ordem: ChaveSecao[] = ['atrasadas', 'semana', 'mes', 'proximas', 'pagas'];
  return ordem
    .filter((chave) => porSecao.has(chave))
    .map((chave) => {
      const lista = [...porSecao.get(chave)!].sort((a, b) =>
        chave === 'pagas'
          ? (b.pagaEm ?? '').localeCompare(a.pagaEm ?? '') || b.vencimento.localeCompare(a.vencimento)
          : a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao),
      );
      const [titulo, icone] = TITULOS[chave];
      if (chave !== 'proximas') return { chave, titulo, icone, grupos: [{ mes: null, titulo: null, contas: lista }] };
      const meses = [...new Set(lista.map((c) => c.vencimento.slice(0, 7)))];
      return {
        chave, titulo, icone,
        grupos: meses.map((mes) => ({ mes, titulo: capitalizar(nomeDoMes(mes)), contas: lista.filter((c) => c.vencimento.startsWith(mes)) })),
      };
    });
}

/** "Vence em 3 dias · 10 out", "Venceu há 2 dias · 30 set", "Vence hoje". */
export function quandoVence(c: Pick<ContaAPagar, 'vencimento' | 'situacao'>, hoje: Dia): string {
  const quando = emQuantosDias(hoje, c.vencimento);
  if (c.situacao === 'atrasada') return `Venceu ${quando} · ${diaEMes(c.vencimento)}`;
  if (quando === 'hoje') return 'Vence hoje';
  if (quando === 'amanhã') return `Vence amanhã · ${diaEMes(c.vencimento)}`;
  return `Vence ${quando} · ${diaEMes(c.vencimento)}`;
}

export const NOME_REPETICAO: Record<Repeticao, string> = { nao: 'Não repete', mensal: 'Todo mês', anual: 'Todo ano' };
