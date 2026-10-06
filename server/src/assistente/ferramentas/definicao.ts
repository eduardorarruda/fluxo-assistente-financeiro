import type { z } from 'zod';

/** O que toda ferramenta do agente recebe além da entrada: de qual conversa veio a chamada. */
export interface ContextoFerramenta {
  conversaId: string;
}

/**
 * O que a ferramenta faz com os dados (vira as anotações MCP `readOnlyHint` /
 * `destructiveHint` na ponte). 'leitura' = só lê; 'escrita' = cria algo novo
 * (uma proposta, uma conta, uma imagem); 'destrutiva' = muda ou apaga o que existe.
 */
export type EfeitoFerramenta = 'leitura' | 'escrita' | 'destrutiva';

export interface Definicao {
  nome: string;
  descricao: string;
  /** Padrão: 'leitura'. */
  efeito?: EfeitoFerramenta;
  entrada: z.ZodType<Record<string, unknown>>;
  rotulo(entrada: Record<string, unknown>): string;
  executar(entrada: Record<string, unknown>, ctx: ContextoFerramenta): unknown;
}

/** Erro que vai para o modelo como resposta da ferramenta (ele pode corrigir e tentar de novo). */
export class ErroDeFerramenta extends Error {}

export function definir<E extends z.ZodObject>(d: {
  nome: string;
  descricao: string;
  efeito?: EfeitoFerramenta;
  entrada: E;
  rotulo: (e: z.output<E>) => string;
  executar: (e: z.output<E>, ctx: ContextoFerramenta) => unknown;
}): Definicao {
  return d as unknown as Definicao;
}
