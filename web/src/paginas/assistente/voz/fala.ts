import { useSyncExternalStore } from 'react';
import { normalizarParaFala } from './fala-numeros';

/**
 * A voz do assistente. `MotorDeFala` é a interface que o modo conversação usa.
 * Duas implementações: a do navegador (speechSynthesis, aqui) e a voz natural
 * (Piper, no servidor do Fluxo — `fala-piper.ts`), que usa esta como reserva.
 */

export interface OpcoesFala {
  /** `voiceURI` da voz do navegador; null = a melhor voz pt-BR disponível. */
  voz: string | null;
  velocidade: number;
  /** Quem lê. Sem isto, a voz do navegador. */
  motor?: 'piper' | 'navegador';
  /** Voz natural (id do catálogo); null = a padrão do servidor. */
  vozNatural?: string | null;
}

export interface MotorDeFala {
  /** Põe um trecho na fila (lido depois dos anteriores). */
  falar: (trecho: string, opcoes: OpcoesFala) => void;
  /** Cala e esvazia a fila. */
  parar: () => void;
  /** Falando ou com trechos na fila. */
  ocupado: () => boolean;
  /** Envelope da voz, 0–1, para animar (a síntese não informa amplitude). */
  nivel: () => number;
  /** Um trecho começou a ser lido (para a legenda). Devolve como cancelar a assinatura. */
  aoComecar: (ouvinte: (trecho: string) => void) => () => void;
  /** A fila acabou. */
  aoEsvaziar: (ouvinte: () => void) => () => void;
  /** Adianta o que der antes da primeira frase (carregar o modelo da voz natural). */
  preparar?: (opcoes: OpcoesFala) => void;
  /** Um aviso curto para a pessoa (a voz natural falhou e a do navegador assumiu). */
  aoAvisar?: (ouvinte: (aviso: string) => void) => () => void;
}

export const IDIOMA_VOZ = 'pt-BR';

const sintese = (): SpeechSynthesis | null => (typeof globalThis.speechSynthesis === 'object' ? globalThis.speechSynthesis : null);

export const suportaFala = () => sintese() !== null;

// ---------- escolher a voz

const normalizarIdioma = (lang: string) => lang.replace('_', '-').toLowerCase();

/** Quanto maior, melhor para ler em português do Brasil. */
export function pontuarVoz(v: Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>): number {
  const lang = normalizarIdioma(v.lang);
  const nome = v.name.toLowerCase();
  let pontos = lang === 'pt-br' ? 100 : lang.startsWith('pt') ? 50 : 0;
  if (nome.includes('google')) pontos += 20;
  if (/natural|neural|online|premium|enhanced/.test(nome)) pontos += 15;
  if (/espeak|mbrola/.test(nome)) pontos -= 15;
  return pontos;
}

export function melhorVoz<V extends Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>>(vozes: readonly V[]): V | null {
  let melhor: V | null = null;
  for (const v of vozes) if (!melhor || pontuarVoz(v) > pontuarVoz(melhor)) melhor = v;
  // Sem nenhuma voz em português, quem escolhe é o navegador (pelo idioma da fala).
  return melhor && pontuarVoz(melhor) >= 35 ? melhor : null;
}

export type GrupoVoz = 'Português (Brasil)' | 'Português' | 'Outros idiomas';

export function grupoDaVoz(v: Pick<SpeechSynthesisVoice, 'lang'>): GrupoVoz {
  const lang = normalizarIdioma(v.lang);
  if (lang === 'pt-br') return 'Português (Brasil)';
  return lang.startsWith('pt') ? 'Português' : 'Outros idiomas';
}

/** As vozes do sistema: pt-BR primeiro (as melhores no topo), depois o resto por nome. */
export function ordenarVozes<V extends Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>>(vozes: readonly V[]): V[] {
  const ordem: Record<GrupoVoz, number> = { 'Português (Brasil)': 0, Português: 1, 'Outros idiomas': 2 };
  return [...vozes].sort(
    (a, b) => ordem[grupoDaVoz(a)] - ordem[grupoDaVoz(b)] || pontuarVoz(b) - pontuarVoz(a) || a.name.localeCompare(b.name, 'pt-BR'),
  );
}

// ---------- lista de vozes (chega depois: evento voiceschanged)

let vozesEmCache: SpeechSynthesisVoice[] = [];
let lidas = false;
let esperouVozes = false;
const ouvintesVozes = new Set<() => void>();
const ESPERA_VOZES_MS = 1500;

function relerVozes() {
  vozesEmCache = sintese()?.getVoices() ?? [];
  ouvintesVozes.forEach((o) => o());
}

function assinarVozes(ouvinte: () => void) {
  ouvintesVozes.add(ouvinte);
  const s = sintese();
  if (!lidas && s) {
    lidas = true;
    vozesEmCache = s.getVoices();
    s.addEventListener?.('voiceschanged', relerVozes);
    // No Linux a lista pode nunca chegar (sem speech-dispatcher): depois de um tempo, "não há vozes".
    setTimeout(() => {
      esperouVozes = true;
      relerVozes();
    }, ESPERA_VOZES_MS);
  }
  return () => ouvintesVozes.delete(ouvinte);
}

let instantaneo = { vozes: vozesEmCache, carregando: true };
function obterVozes() {
  const carregando = vozesEmCache.length === 0 && !esperouVozes && suportaFala();
  if (instantaneo.vozes !== vozesEmCache || instantaneo.carregando !== carregando) instantaneo = { vozes: vozesEmCache, carregando };
  return instantaneo;
}

export const useVozes = (): { vozes: SpeechSynthesisVoice[]; carregando: boolean } => useSyncExternalStore(assinarVozes, obterVozes, obterVozes);

/** Só para os testes. */
export function reiniciarVozes(): void {
  sintese()?.removeEventListener?.('voiceschanged', relerVozes);
  vozesEmCache = [];
  lidas = false;
  esperouVozes = false;
}

function acharVoz(uri: string | null): SpeechSynthesisVoice | null {
  const vozes = sintese()?.getVoices() ?? [];
  return (uri ? vozes.find((v) => v.voiceURI === uri) : undefined) ?? melhorVoz(vozes);
}

// ---------- motor do navegador

/** Uma voz que não começa em tanto tempo está quebrada (speech-dispatcher ausente, por exemplo). */
const ESPERA_INICIO_MS = 2500;
const MS_POR_CARACTERE = 62;

/** Tempo aproximado de leitura: serve de vigia (fim que nunca chega) e de legenda sem som. */
export const duracaoEstimada = (trecho: string, velocidade: number) => (trecho.length * MS_POR_CARACTERE) / Math.max(0.5, velocidade);

/** Envelope sintético: sílabas (~5 por segundo) moduladas por frase, mais um pulso a cada palavra. */
export function envelopeDeFala(t: number, pulso: number): number {
  const silabas = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 4.7) * Math.sin(t * 2 * Math.PI * 1.3 + 0.6);
  const frase = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 0.37);
  return Math.min(1, Math.max(0, 0.22 + 0.5 * silabas * frase + 0.35 * pulso));
}

interface Item {
  trecho: string;
  opcoes: OpcoesFala;
}

export function criarMotorNavegador(): MotorDeFala {
  const comecar = new Set<(trecho: string) => void>();
  const esvaziar = new Set<() => void>();
  let fila: Item[] = [];
  let atual: SpeechSynthesisUtterance | null = null;
  let ocupado = false;
  let semSom = false;
  let vigia: ReturnType<typeof setTimeout> | null = null;
  let ultimoPulso = 0;
  let suave = 0;

  const limparVigia = () => {
    if (vigia) clearTimeout(vigia);
    vigia = null;
  };

  const proxima = () => {
    limparVigia();
    const item = fila.shift();
    if (!item) {
      atual = null;
      if (ocupado) {
        ocupado = false;
        esvaziar.forEach((o) => o());
      }
      return;
    }
    ocupado = true;
    const s = sintese();
    if (!s || semSom) return lerSemSom(item);
    // Números por extenso: "R$ 1.234,56" sai como reais e centavos também nas vozes do sistema.
    const u = new SpeechSynthesisUtterance(normalizarParaFala(item.trecho));
    u.lang = IDIOMA_VOZ;
    u.rate = item.opcoes.velocidade;
    try {
      const voz = acharVoz(item.opcoes.voz);
      if (voz) u.voice = voz;
    } catch {
      /* voz que sumiu da lista (ou não é uma SpeechSynthesisVoice de verdade): fica a do idioma */
    }
    let comecou = false;
    const terminar = () => {
      if (atual !== u) return;
      atual = null;
      proxima();
    };
    u.onstart = () => {
      if (atual !== u) return;
      comecou = true;
      ultimoPulso = performance.now();
      comecar.forEach((o) => o(item.trecho));
      limparVigia();
      vigia = setTimeout(() => (s.cancel(), terminar()), duracaoEstimada(item.trecho, item.opcoes.velocidade) * 2 + 4000);
    };
    u.onboundary = () => {
      ultimoPulso = performance.now();
    };
    u.onend = terminar;
    u.onerror = terminar;
    // Guarda a referência: o Chrome perde o onend de falas coletadas pelo GC.
    atual = u;
    vigia = setTimeout(() => {
      if (comecou || atual !== u) return;
      // Nunca começou: segue só com a legenda, sem tentar a voz de novo nesta sessão.
      semSom = true;
      s.cancel();
      atual = null;
      lerSemSom(item);
    }, ESPERA_INICIO_MS);
    try {
      s.speak(u);
    } catch {
      semSom = true;
      atual = null;
      lerSemSom(item);
    }
  };

  /** Sem voz utilizável: a legenda aparece pelo tempo que levaria para ler. */
  const lerSemSom = (item: Item) => {
    comecar.forEach((o) => o(item.trecho));
    ultimoPulso = performance.now();
    vigia = setTimeout(proxima, Math.min(8000, duracaoEstimada(item.trecho, item.opcoes.velocidade)));
  };

  return {
    falar(trecho, opcoes) {
      if (!trecho.trim()) return;
      fila = [...fila, { trecho, opcoes }];
      if (!ocupado) proxima();
    },
    parar() {
      fila = [];
      limparVigia();
      const estava = atual;
      atual = null;
      ocupado = false;
      if (estava) sintese()?.cancel();
    },
    ocupado: () => ocupado,
    nivel() {
      const agora = performance.now();
      const pulso = Math.exp(-(agora - ultimoPulso) / 160);
      const alvo = ocupado ? envelopeDeFala(agora / 1000, pulso) : 0;
      suave += (alvo - suave) * 0.25;
      return suave;
    },
    aoComecar(o) {
      comecar.add(o);
      return () => comecar.delete(o);
    },
    aoEsvaziar(o) {
      esvaziar.add(o);
      return () => esvaziar.delete(o);
    },
  };
}

export const FRASE_DE_EXEMPLO = 'Oi! Em setembro você gastou R$ 1.234,56 no cartão, uns 8% a menos que em agosto.';
