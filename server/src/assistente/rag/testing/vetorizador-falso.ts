import { createHash } from 'node:crypto';
import type { ProgressoDownload, TipoDeTexto, VetorizadorPreparavel } from '../vetorizador';

export const DIMENSAO_FALSA = 8;

/**
 * Vetor determinístico de um texto: cada palavra (sem acento, minúscula) cai
 * num balde pelo hash; o resultado é normalizado. Textos com palavras em comum
 * ficam próximos — o bastante para testar a busca por vetor sem modelo.
 */
export function vetorDeTexto(texto: string, dimensao = DIMENSAO_FALSA): Float32Array {
  const vetor = new Float32Array(dimensao);
  const palavras = texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const p of palavras) vetor[createHash('sha256').update(p).digest()[0]! % dimensao]! += 1;
  return normalizado(vetor);
}

export function normalizado(valores: ArrayLike<number>): Float32Array {
  const vetor = Float32Array.from(valores);
  const norma = Math.hypot(...vetor);
  if (norma === 0) {
    vetor[0] = 1;
    return vetor;
  }
  return vetor.map((v) => v / norma);
}

/** Vetorizador de mentira: conta as chamadas e deixa o teste controlar download, falha e ritmo. */
export class VetorizadorFalso implements VetorizadorPreparavel {
  readonly modelo = 'teste/falso';
  readonly dimensao = DIMENSAO_FALSA;
  estaBaixado = false;
  chamadasPreparar = 0;
  readonly chamadasVetorizar: { textos: string[]; tipo: TipoDeTexto }[] = [];
  emParalelo = 0;
  maximoEmParalelo = 0;
  falharPreparar: Error | null = null;
  falharVetorizar: Error | null = null;
  /** Roda dentro de `preparar`, antes de terminar (para emitir progresso ou segurar a promessa). */
  durantePreparar: ((aoProgredir?: (p: ProgressoDownload) => void) => Promise<void>) | null = null;
  /** Roda dentro de `vetorizar`, antes de devolver. */
  duranteVetorizar: (() => void) | null = null;

  baixado(): boolean {
    return this.estaBaixado;
  }

  async preparar(aoProgredir?: (p: ProgressoDownload) => void): Promise<void> {
    this.chamadasPreparar++;
    await this.durantePreparar?.(aoProgredir);
    if (this.falharPreparar) throw this.falharPreparar;
    this.estaBaixado = true;
  }

  async vetorizar(textos: string[], tipo: TipoDeTexto): Promise<Float32Array[]> {
    this.chamadasVetorizar.push({ textos, tipo });
    this.emParalelo++;
    this.maximoEmParalelo = Math.max(this.maximoEmParalelo, this.emParalelo);
    try {
      await new Promise((r) => setImmediate(r));
      this.duranteVetorizar?.();
      if (this.falharVetorizar) throw this.falharVetorizar;
      return textos.map((t) => vetorDeTexto(t));
    } finally {
      this.emParalelo--;
    }
  }
}
