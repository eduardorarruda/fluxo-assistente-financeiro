/** Tipos mínimos dos pacotes sem tipagem própria que a voz natural usa. */

declare module 'unbzip2-stream' {
  import type { Duplex } from 'node:stream';
  export default function unbzip2Stream(): Duplex;
}

declare module 'tar-stream' {
  import type { Readable, Writable } from 'node:stream';
  export interface Cabecalho {
    name: string;
    size?: number;
    type?: 'file' | 'directory' | 'symlink' | 'link' | 'character-device' | 'block-device' | 'fifo' | 'contiguous-file' | string | null;
    linkname?: string | null;
    mode?: number;
  }
  export interface Extracao extends Writable {
    on(evento: 'entry', ouvinte: (cabecalho: Cabecalho, conteudo: Readable, proximo: (erro?: unknown) => void) => void): this;
    on(evento: string, ouvinte: (...args: any[]) => void): this;
  }
  export interface Empacotamento extends Readable {
    entry(cabecalho: Cabecalho, conteudo?: string | Buffer, aoTerminar?: (erro?: unknown) => void): Writable;
    finalize(): void;
  }
  export function extract(): Extracao;
  export function pack(): Empacotamento;
}

declare module 'sherpa-onnx-node' {
  export interface ConfigTts {
    model: { vits: { model: string; tokens: string; dataDir: string; noiseScale?: number; noiseScaleW?: number; lengthScale?: number }; numThreads?: number; provider?: string; debug?: number };
    maxNumSentences?: number;
  }
  export class OfflineTts {
    static createAsync(config: ConfigTts): Promise<OfflineTts>;
    readonly sampleRate: number;
    generateAsync(pedido: { text: string; sid: number; speed: number }): Promise<{ samples: Float32Array; sampleRate: number }>;
  }
}
