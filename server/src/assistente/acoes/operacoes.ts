import type { z } from 'zod';
import type { Repositorio } from '../../dados/repositorio';
import { CATEGORIA_POR_ID, type GrupoCategoria } from '../../domain/categorias';
import type { Natureza } from '../../domain/types';
import type { ContasAPagar } from '../../servicos/contas-a-pagar';
import type { Financas } from '../../servicos/financas';
import type { RepositorioDeAcoes } from './repositorio-acoes';
import { ErroDeAcao, type ExemploAcao, type Inverso, type ModoAcao, type TipoAcao } from './tipos-acoes';

/** O que cada operação precisa para olhar e mudar os dados. */
export interface ContextoOperacoes {
  repositorio: Repositorio;
  financas: Financas;
  leitura: RepositorioDeAcoes;
  /** Sem ele (testes, Fluxo sem contas a pagar), as ações de contas respondem que não estão disponíveis. */
  contas?: ContasAPagar;
  hoje(): string;
}

/** O que a pessoa vê antes (proposta) ou depois (ação direta). */
export interface Previa {
  titulo: string;
  descricao: string;
  efeito: string | null;
  exemplos: ExemploAcao[];
}

/**
 * Uma operação que o assistente pode fazer. `prever` valida e descreve (sem
 * mudar nada); `executar` faz de verdade e devolve como desfazer. `executar`
 * é síncrono de propósito: entre conferir e gravar não há `await`, então nada
 * intercala (dois cliques, duas abas) — e valida tudo de novo, porque entre a
 * proposta e a aprovação os dados podem ter mudado.
 */
export interface Operacao<P extends Record<string, unknown> = Record<string, unknown>> {
  tipo: TipoAcao;
  modo: ModoAcao;
  payload: z.ZodType<P>;
  prever(p: P): Previa;
  executar(p: P): { inverso: Inverso; aviso?: string | null };
  /** Na proposta: troca o pedido pelo que de fato vai mudar (aprovar faz exatamente o que o cartão mostrou). */
  refinar?(p: P): P;
}

export function operacao<P extends Record<string, unknown>>(o: Operacao<P>): Operacao {
  return o as unknown as Operacao;
}

// ------------------------------------------------------------ formatação

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 123456 → "R$ 1.234,56" (com espaço comum, não o não-quebrável do Intl). */
export function brl(centavos: number): string {
  return REAIS.format(centavos / 100).replace(/\s/g, ' ');
}

/** "2026-09-12" → "12/09/2026". */
export function dataBr(dia: string): string {
  return dia.split('-').reverse().join('/');
}

/** "2026-12" → "dez/2026". */
export function mesBr(mes: string): string {
  const [ano, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

export function nomeDaCategoria(id: string | null | undefined): string {
  return id ? (CATEGORIA_POR_ID.get(id)?.nome ?? id) : 'sem categoria';
}

export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
}

/** Corta no limite com reticências (descrições de loja podem ser longas). */
export function curto(texto: string, limite = 48): string {
  const t = texto.trim();
  return t.length > limite ? `${t.slice(0, limite - 1)}…` : t;
}

// ------------------------------------------------------------ validação

export function grupoDaNatureza(natureza: Natureza): GrupoCategoria | null {
  if (natureza === 'DESPESA' || natureza === 'ESTORNO') return 'DESPESA';
  if (natureza === 'RECEITA') return 'RECEITA';
  return null;
}

export function exigirCategoria(id: string): GrupoCategoria {
  const c = CATEGORIA_POR_ID.get(id);
  if (!c) throw new ErroDeAcao(`A categoria “${id}” não existe mais no Fluxo.`);
  return c.grupo;
}
