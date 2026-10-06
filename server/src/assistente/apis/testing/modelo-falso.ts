import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/**
 * Modelo de mentira para os testes das contas por API: cada chamada ao
 * modelo (um "passo") devolve a próxima lista de pedaços. Nunca chama API
 * de verdade nem usa chave de verdade.
 */

type ResultadoStream = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
export type Pedaco = ResultadoStream['stream'] extends ReadableStream<infer T> ? T : never;

const USO = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

export function fim(motivo: 'stop' | 'tool-calls' = 'stop'): Pedaco {
  return { type: 'finish', finishReason: { unified: motivo, raw: undefined }, usage: USO } as Pedaco;
}

export function texto(...pedacos: string[]): Pedaco[] {
  return [
    { type: 'text-start', id: 't1' },
    ...pedacos.map((delta): Pedaco => ({ type: 'text-delta', id: 't1', delta })),
    { type: 'text-end', id: 't1' },
    fim(),
  ];
}

export function chamada(id: string, ferramenta: string, entrada: Record<string, unknown>): Pedaco[] {
  return [
    { type: 'tool-input-start', id, toolName: ferramenta },
    { type: 'tool-input-end', id },
    { type: 'tool-call', toolCallId: id, toolName: ferramenta, input: JSON.stringify(entrada) },
    fim('tool-calls'),
  ];
}

/** `passos[i]` = o que o modelo devolve na i-ésima chamada. */
export function modeloFalso(passos: Pedaco[][], opcoes: { atrasoMs?: number } = {}): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: passos[Math.min(i++, passos.length - 1)]!, chunkDelayInMs: opcoes.atrasoMs ?? null }),
    }),
  });
}

/** Modelo cuja chamada falha antes de responder (erro HTTP, rede…). */
export function modeloQueFalha(erro: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw erro;
    },
  });
}
