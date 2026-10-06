import { useEffect, useRef, useState } from 'react';

/**
 * Nível do microfone (0–1) para o anel do botão de ditado e para a esfera do modo
 * conversação. Abre um fluxo de áudio próprio (getUserMedia + AnalyserNode): o
 * reconhecimento de fala do Chrome não informa volume. Sem microfone ou sem
 * permissão, o nível fica em zero e a animação usa um respiro sintético.
 */

export interface MedidorDeNivel {
  /** Nível suavizado, 0–1. Barato: pode ser lido a cada quadro. */
  nivel: () => number;
  fechar: () => void;
}

const GANHO = 4.2;
const SUAVIZAR_SUBIDA = 0.45;
const SUAVIZAR_DESCIDA = 0.12;

type JanelaComAudio = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export async function abrirMedidorDeNivel(): Promise<MedidorDeNivel> {
  const fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const Contexto = globalThis.AudioContext ?? (globalThis as JanelaComAudio).webkitAudioContext;
  if (!Contexto) {
    fluxo.getTracks().forEach((t) => t.stop());
    throw new Error('Sem Web Audio');
  }
  const contexto = new Contexto();
  const fonte = contexto.createMediaStreamSource(fluxo);
  const analisador = contexto.createAnalyser();
  analisador.fftSize = 512;
  analisador.smoothingTimeConstant = 0.6;
  fonte.connect(analisador);
  const amostras = new Float32Array(analisador.fftSize);
  let suave = 0;
  let fechado = false;
  return {
    nivel() {
      if (fechado) return 0;
      analisador.getFloatTimeDomainData(amostras);
      let soma = 0;
      for (const v of amostras) soma += v * v;
      const rms = Math.sqrt(soma / amostras.length);
      // Curva perceptual: fala baixa já mexe, grito não estoura.
      const alvo = Math.min(1, Math.sqrt(rms * GANHO));
      suave += (alvo - suave) * (alvo > suave ? SUAVIZAR_SUBIDA : SUAVIZAR_DESCIDA);
      return suave;
    },
    fechar() {
      if (fechado) return;
      fechado = true;
      fonte.disconnect();
      fluxo.getTracks().forEach((t) => t.stop());
      void contexto.close().catch(() => undefined);
    },
  };
}

const ZERO = () => 0;

export type ErroMicrofone = 'permissao' | 'sem-microfone' | 'outro';

export function classificarErroMicrofone(e: unknown): ErroMicrofone {
  const nome = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'permissao';
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError' || nome === 'NotReadableError') return 'sem-microfone';
  return 'outro';
}

/**
 * Enquanto `ativo`, mantém o microfone aberto e devolve uma função que lê o nível.
 * O erro (permissão negada, sem microfone) vem junto para quem quiser explicar.
 */
export interface NivelMicrofone {
  nivel: () => number;
  erro: ErroMicrofone | null;
  /** Já tentou abrir (deu certo ou não): dá para seguir. */
  pronto: boolean;
}

/** `tentativa` muda → tenta abrir de novo (depois de a pessoa liberar a permissão). */
export function useNivelMicrofone(ativo: boolean, tentativa = 0): NivelMicrofone {
  const medidor = useRef<MedidorDeNivel | null>(null);
  const [erro, setErro] = useState<ErroMicrofone | null>(null);
  const [pronto, setPronto] = useState(false);
  const leitor = useRef(() => medidor.current?.nivel() ?? 0);

  useEffect(() => {
    if (!ativo) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPronto(true);
      return;
    }
    let cancelado = false;
    abrirMedidorDeNivel()
      .then((m) => {
        if (cancelado) return m.fechar();
        medidor.current = m;
        setErro(null);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(classificarErroMicrofone(e));
      })
      .finally(() => {
        if (!cancelado) setPronto(true);
      });
    return () => {
      cancelado = true;
      medidor.current?.fechar();
      medidor.current = null;
      setPronto(false);
    };
  }, [ativo, tentativa]);

  return { nivel: ativo ? leitor.current : ZERO, erro, pronto };
}
