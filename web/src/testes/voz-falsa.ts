import type { MotorDeFala, OpcoesFala } from '../paginas/assistente/voz/fala';
import type { Disponibilidade } from '../paginas/assistente/voz/reconhecimento';

/**
 * Reconhecimento de fala de mentira (o jsdom não tem Web Speech API). Os testes
 * "falam" entregando resultados como o Chrome entrega: a lista cresce e
 * `resultIndex` aponta o primeiro que mudou.
 */
export class ReconhecimentoFalso {
  static instancias: ReconhecimentoFalso[] = [];
  static disponibilidade: Disponibilidade = 'unavailable';
  static available = vi.fn(async () => ReconhecimentoFalso.disponibilidade);
  static install = vi.fn(async () => true);

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  processLocally = false;
  onstart: ((e: Event) => void) | null = null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: ((e: Event) => void) | null = null;
  ligado = false;

  constructor() {
    ReconhecimentoFalso.instancias.push(this);
  }

  static get ultima(): ReconhecimentoFalso {
    const r = ReconhecimentoFalso.instancias.at(-1);
    if (!r) throw new Error('Nenhum reconhecimento foi criado');
    return r;
  }

  start() {
    if (this.ligado) throw new DOMException('já começou', 'InvalidStateError');
    this.ligado = true;
    this.onstart?.(new Event('start'));
  }

  stop() {
    this.encerrar();
  }

  abort() {
    this.encerrar();
  }

  /** O Chrome encerrou (silêncio, fim de sessão, ou depois de stop/abort). */
  encerrar() {
    if (!this.ligado) return;
    this.ligado = false;
    this.onend?.(new Event('end'));
  }

  /** `resultados`: [texto, final?] desde o começo desta sessão. */
  ouvir(resultados: [string, boolean][], resultIndex = 0) {
    const lista = resultados.map(([transcript, isFinal]) => Object.assign([{ transcript, confidence: 0.9 }], { isFinal }));
    this.onresult?.({ resultIndex, results: lista } as unknown as SpeechRecognitionEvent);
  }

  errar(codigo: string) {
    this.onerror?.({ error: codigo, message: '' } as unknown as SpeechRecognitionErrorEvent);
  }
}

type Janela = typeof globalThis & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

export function instalarReconhecimentoFalso(): void {
  ReconhecimentoFalso.instancias = [];
  ReconhecimentoFalso.disponibilidade = 'unavailable';
  (globalThis as Janela).SpeechRecognition = ReconhecimentoFalso;
}

export function removerReconhecimentoFalso(): void {
  delete (globalThis as Janela).SpeechRecognition;
  delete (globalThis as Janela).webkitSpeechRecognition;
}

/** Voz de mentira: guarda o que foi pedido e deixa o teste dizer quando começou e terminou. */
export function criarMotorFalso() {
  const comecar = new Set<(t: string) => void>();
  const esvaziar = new Set<() => void>();
  let fila: string[] = [];
  let falando: string | null = null;
  const faladas: { trecho: string; opcoes: OpcoesFala }[] = [];
  const motor: MotorDeFala = {
    falar(trecho, opcoes) {
      faladas.push({ trecho, opcoes });
      fila = [...fila, trecho];
    },
    parar() {
      fila = [];
      falando = null;
    },
    ocupado: () => falando !== null || fila.length > 0,
    nivel: () => (falando ? 0.5 : 0),
    aoComecar(o) {
      comecar.add(o);
      return () => comecar.delete(o);
    },
    aoEsvaziar(o) {
      esvaziar.add(o);
      return () => esvaziar.delete(o);
    },
  };
  return {
    motor,
    faladas,
    /** A próxima frase da fila começa a ser lida. */
    comecarProxima() {
      const [proxima, ...resto] = fila;
      if (proxima === undefined) return;
      fila = resto;
      falando = proxima;
      comecar.forEach((o) => o(proxima));
    },
    /** A frase atual terminou; se a fila acabou, avisa. */
    terminarAtual() {
      falando = null;
      if (fila.length === 0) esvaziar.forEach((o) => o());
    },
  };
}
