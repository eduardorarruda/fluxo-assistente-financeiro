import { useSyncExternalStore } from 'react';

/**
 * Preferências de voz desta janela (ditado, modo conversação, leitura das respostas).
 * Ficam no localStorage: o Fluxo é de uma pessoa só, numa máquina só. Sem
 * armazenamento (bloqueado, corrompido), vale o padrão e nada quebra.
 */

export type MotorReconhecimento = 'local' | 'nuvem';
/** Quem lê as respostas: a voz natural (Piper, no servidor do Fluxo) ou a do navegador. */
export type MotorFala = 'piper' | 'navegador';

export interface PreferenciasVoz {
  /** 'local' = no computador, quando o Chrome oferece; 'nuvem' = pelo Google. */
  reconhecimento: MotorReconhecimento;
  /** 'piper' só vale com uma voz natural instalada; sem ela, fala a do navegador. */
  motorFala: MotorFala;
  /** Voz natural escolhida (id do catálogo); null = a padrão do servidor. */
  vozNatural: string | null;
  /** `voiceURI` da voz do navegador escolhida; null = a melhor voz pt-BR que houver. */
  voz: string | null;
  velocidade: number;
  /** Quanto silêncio depois da fala para enviar, no modo conversação. */
  silencioMs: number;
  /** No modo conversação, ler as respostas em voz alta. */
  falarRespostas: boolean;
}

export const LIMITES = {
  velocidade: { min: 0.8, max: 1.5, passo: 0.05 },
  silencioMs: { min: 800, max: 2500, passo: 100 },
} as const;

export const PREFERENCIAS_PADRAO: PreferenciasVoz = {
  reconhecimento: 'local',
  motorFala: 'piper',
  vozNatural: null,
  voz: null,
  velocidade: 1,
  silencioMs: 1200,
  falarRespostas: true,
};

const CHAVE = 'fluxo:voz';

const limitar = (valor: unknown, { min, max }: { min: number; max: number }, padrao: number) =>
  typeof valor === 'number' && Number.isFinite(valor) ? Math.min(max, Math.max(min, valor)) : padrao;

/** Qualquer coisa (JSON velho, editado à mão) → preferências válidas. */
export function normalizarPreferencias(bruto: unknown): PreferenciasVoz {
  const p = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const padrao = PREFERENCIAS_PADRAO;
  return {
    reconhecimento: p.reconhecimento === 'nuvem' ? 'nuvem' : 'local',
    motorFala: p.motorFala === 'navegador' ? 'navegador' : 'piper',
    vozNatural: typeof p.vozNatural === 'string' && /^[a-z0-9-]{1,40}$/.test(p.vozNatural) ? p.vozNatural : null,
    voz: typeof p.voz === 'string' && p.voz ? p.voz : null,
    velocidade: limitar(p.velocidade, LIMITES.velocidade, padrao.velocidade),
    silencioMs: Math.round(limitar(p.silencioMs, LIMITES.silencioMs, padrao.silencioMs)),
    falarRespostas: typeof p.falarRespostas === 'boolean' ? p.falarRespostas : padrao.falarRespostas,
  };
}

export function lerPreferenciasVoz(): PreferenciasVoz {
  try {
    const salvo = localStorage.getItem(CHAVE);
    return normalizarPreferencias(salvo ? JSON.parse(salvo) : null);
  } catch {
    return PREFERENCIAS_PADRAO;
  }
}

let atual: PreferenciasVoz | null = null;
const ouvintes = new Set<() => void>();

const obter = () => (atual ??= lerPreferenciasVoz());

export function mudarPreferenciasVoz(mudanca: Partial<PreferenciasVoz>): PreferenciasVoz {
  atual = normalizarPreferencias({ ...obter(), ...mudanca });
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atual));
  } catch {
    /* sem armazenamento: vale até fechar a janela */
  }
  ouvintes.forEach((o) => o());
  return atual;
}

/** Só para os testes: esquece o que está em memória e relê do armazenamento. */
export function recarregarPreferenciasVoz(): void {
  atual = null;
  ouvintes.forEach((o) => o());
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function usePreferenciasVoz(): [PreferenciasVoz, (m: Partial<PreferenciasVoz>) => void] {
  const prefs = useSyncExternalStore(assinar, obter, obter);
  return [prefs, mudarPreferenciasVoz];
}
