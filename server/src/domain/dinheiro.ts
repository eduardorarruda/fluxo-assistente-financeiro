import type { Centavos } from './types';

/**
 * Converte o número de ponto flutuante do provedor para centavos inteiros.
 * `Math.round` e não `Math.trunc`: 0,1 + 0,2 vira 0,30000000000000004 e
 * 19,99 * 100 vira 1998,9999999999998 — truncar perderia um centavo.
 */
export function paraCentavos(valor: number | null | undefined): Centavos {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return 0;
  return Math.round(valor * 100);
}

export function somar(valores: readonly Centavos[]): Centavos {
  let total = 0;
  for (const v of valores) total += v;
  return total;
}

export function mediana(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? Math.round((ordenados[meio - 1]! + ordenados[meio]!) / 2)
    : ordenados[meio]!;
}

/** Proporção protegida contra divisão por zero. */
export function proporcao(parte: number, todo: number): number {
  return todo === 0 ? 0 : parte / todo;
}
