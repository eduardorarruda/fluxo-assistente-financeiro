import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Texto → amostras de áudio com uma voz Piper já baixada. Quem roda o modelo
 * é o sherpa-onnx (addon nativo pré-compilado para linux-x64, com o
 * onnxruntime e o espeak-ng embutidos): nada instalado no sistema, nada sai
 * da máquina. O `import()` é dinâmico: o addon só carrega quando alguém fala.
 */

export interface VozCarregada {
  readonly taxa: number;
  /** `velocidade` 1 = natural; 1,25 = 25% mais rápido. */
  gerar(texto: string, velocidade: number): Promise<Float32Array>;
}

export type CarregadorDeVoz = (pasta: string) => Promise<VozCarregada>;

/** Fala ainda mais rápido que isto deixa de ser compreensível (e mais lento, arrastada). */
export const VELOCIDADE = { min: 0.5, max: 2 } as const;
/** Dois threads: a fala sai bem mais rápido que o tempo real sem tomar a máquina toda. */
const THREADS = 2;

/** Os arquivos de uma voz instalada: o modelo, os tokens e a fonética do espeak. */
export function arquivosDaVoz(pasta: string): { modelo: string; tokens: string; dados: string } | null {
  if (!existsSync(pasta)) return null;
  const modelo = readdirSync(pasta).find((f) => f.endsWith('.onnx'));
  const tokens = join(pasta, 'tokens.txt');
  const dados = join(pasta, 'espeak-ng-data');
  if (!modelo || !existsSync(tokens) || !existsSync(join(dados, 'phontab'))) return null;
  return { modelo: join(pasta, modelo), tokens, dados };
}

export const carregarComSherpa: CarregadorDeVoz = async (pasta) => {
  const arquivos = arquivosDaVoz(pasta);
  if (!arquivos) throw new Error('A voz está incompleta no disco. Remova e baixe de novo nos Ajustes.');
  const { OfflineTts } = await import('sherpa-onnx-node');
  const tts = await OfflineTts.createAsync({
    model: {
      vits: { model: arquivos.modelo, tokens: arquivos.tokens, dataDir: arquivos.dados, noiseScale: 0.667, noiseScaleW: 0.8, lengthScale: 1 },
      numThreads: THREADS,
      provider: 'cpu',
      debug: 0,
    },
    maxNumSentences: 1,
  });
  return {
    taxa: tts.sampleRate,
    async gerar(texto, velocidade) {
      const audio = await tts.generateAsync({ text: texto, sid: 0, speed: velocidade });
      return audio.samples;
    },
  };
};
