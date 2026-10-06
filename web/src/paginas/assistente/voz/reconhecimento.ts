import { useSyncExternalStore } from 'react';
import type { PreferenciasVoz } from './preferencias-voz';

/**
 * Reconhecimento de fala do navegador (Web Speech API), para o ditado e o modo
 * conversação. O lib.dom do TypeScript traz os eventos, mas não a classe nem a
 * parte nova de reconhecimento no computador (Chrome 139+): as declarações
 * mínimas ficam aqui, conferidas com o rascunho do W3C
 * (https://webaudio.github.io/web-speech-api/): `processLocally`,
 * `SpeechRecognition.available({ langs, processLocally })` →
 * 'available' | 'downloadable' | 'downloading' | 'unavailable' e
 * `SpeechRecognition.install({ langs, processLocally })` → boolean.
 */

export const IDIOMA = 'pt-BR';

export type Disponibilidade = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface OpcoesReconhecimento {
  langs: string[];
  processLocally?: boolean;
}

export interface InstanciaReconhecimento {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: ((e: Event) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((e: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface ConstrutorReconhecimento {
  new (): InstanciaReconhecimento;
  available?: (opcoes: OpcoesReconhecimento) => Promise<Disponibilidade>;
  install?: (opcoes: OpcoesReconhecimento) => Promise<boolean>;
}

type JanelaComFala = typeof globalThis & {
  SpeechRecognition?: ConstrutorReconhecimento;
  webkitSpeechRecognition?: ConstrutorReconhecimento;
};

export function obterReconhecimento(): ConstrutorReconhecimento | null {
  const janela = globalThis as JanelaComFala;
  return janela.SpeechRecognition ?? janela.webkitSpeechRecognition ?? null;
}

export const suportaReconhecimento = () => obterReconhecimento() !== null;

// ---------- mensagens de erro

export interface ErroEscuta {
  codigo: string;
  mensagem: string;
}

export const COMO_PERMITIR_MICROFONE =
  'Para liberar: no menu ⋮ da janela do Fluxo, abra “Informações do app” (ou clique no ícone de microfone riscado no alto da janela), permita o microfone e tente de novo.';

export function mensagemDeErro(codigo: string, local = false): string {
  switch (codigo) {
    case 'not-allowed':
      return `O microfone está bloqueado para o Fluxo. ${COMO_PERMITIR_MICROFONE}`;
    case 'service-not-allowed':
      return local
        ? 'O reconhecimento no computador não está disponível para português agora. Baixe o pacote em Ajustes → Assistente de IA → Voz, ou escolha o do Google.'
        : `O navegador não liberou o reconhecimento de fala. ${COMO_PERMITIR_MICROFONE}`;
    case 'no-speech':
      return 'Não ouvi nada. Fale mais perto do microfone.';
    case 'audio-capture':
      return 'Nenhum microfone encontrado. Conecte um e confira se ele está escolhido nas configurações de som do sistema.';
    case 'network':
      return 'Sem conexão com o reconhecimento do Google. Confira a internet — ou use o reconhecimento no computador (Ajustes → Assistente de IA → Voz).';
    case 'language-not-supported':
      return 'Este navegador não reconhece fala em português (Brasil).';
    case 'aborted':
      return 'O reconhecimento de fala foi interrompido.';
    case 'sem-suporte':
      return 'Este navegador não reconhece fala. Use o Google Chrome (é o que abre o Fluxo pelo atalho).';
    case 'nao-comeca':
      return 'O reconhecimento de fala não conseguiu começar. Tente de novo em instantes.';
    default:
      return `O reconhecimento de fala parou (${codigo}).`;
  }
}

/** Erros que tentar de novo sozinho não resolve. "no-speech" e "aborted" só reiniciam a escuta. */
const DEFINITIVOS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'phrases-not-supported']);

// ---------- uma escuta contínua, que se religa sozinha

export interface OpcoesEscuta {
  local: boolean;
  aoParcial: (texto: string) => void;
  aoFinal: (texto: string) => void;
  aoErro: (erro: ErroEscuta) => void;
  /** Para testes; no app, o do navegador. */
  construtor?: ConstrutorReconhecimento | null;
}

export interface Escuta {
  iniciar: () => void;
  /** Para e confirma o que estava sendo dito. */
  parar: () => void;
  /** Para e descarta o que ainda não estava confirmado. */
  abortar: () => void;
  readonly ativa: boolean;
}

const ESPERA_RELIGAR_MS = 150;
const JANELA_DE_RELIGADAS_MS = 6000;
const MAX_RELIGADAS_SEM_RESULTADO = 5;

/**
 * O Chrome encerra a escuta contínua depois de um silêncio (ou de uns minutos):
 * enquanto a pessoa não mandou parar, ela é religada. Se religar não adianta
 * (encerra logo de novo, várias vezes, sem ouvir nada), desiste com um aviso.
 */
export function criarEscuta(op: OpcoesEscuta): Escuta | null {
  const Construtor = op.construtor === undefined ? obterReconhecimento() : op.construtor;
  if (!Construtor) return null;
  let rec: InstanciaReconhecimento | null = null;
  let desejada = false;
  let descartar = false;
  let pendente = '';
  let religar: ReturnType<typeof setTimeout> | null = null;
  let religadas: number[] = [];

  const confirmarPendente = () => {
    const texto = pendente.trim();
    pendente = '';
    // Primeiro confirma, depois limpa o provisório: a caixa não "pisca" sem o trecho.
    if (texto && !descartar) op.aoFinal(texto);
    op.aoParcial('');
  };

  const falhar = (codigo: string) => {
    desejada = false;
    pendente = '';
    op.aoParcial('');
    op.aoErro({ codigo, mensagem: mensagemDeErro(codigo, op.local) });
  };

  const ligar = () => {
    religar = null;
    if (!desejada) return;
    const r = new Construtor();
    r.lang = IDIOMA;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    if (op.local) r.processLocally = true;
    const finalizados = new Set<number>();
    r.onresult = (e) => {
      if (rec !== r) return;
      religadas = [];
      let parcial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const resultado = e.results[i];
        const texto = resultado?.[0]?.transcript ?? '';
        if (!resultado?.isFinal) parcial += texto;
        else if (!finalizados.has(i)) {
          finalizados.add(i);
          if (texto.trim()) op.aoFinal(texto.trim());
        }
      }
      pendente = parcial;
      op.aoParcial(parcial.trim());
    };
    r.onerror = (e) => {
      if (rec !== r) return;
      if (DEFINITIVOS.has(e.error)) falhar(e.error);
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      confirmarPendente();
      if (!desejada) return;
      const agora = Date.now();
      religadas = [...religadas.filter((t) => agora - t < JANELA_DE_RELIGADAS_MS), agora];
      if (religadas.length > MAX_RELIGADAS_SEM_RESULTADO) return falhar('nao-comeca');
      religar = setTimeout(ligar, ESPERA_RELIGAR_MS);
    };
    rec = r;
    try {
      r.start();
    } catch {
      rec = null;
      falhar('nao-comeca');
    }
  };

  const desligar = (modo: 'stop' | 'abort') => {
    desejada = false;
    descartar = modo === 'abort';
    if (religar) clearTimeout(religar);
    religar = null;
    religadas = [];
    const r = rec;
    if (!r) return confirmarPendente();
    try {
      if (modo === 'stop') r.stop();
      else r.abort();
    } catch {
      rec = null;
      confirmarPendente();
    }
  };

  return {
    iniciar() {
      if (desejada) return;
      desejada = true;
      descartar = false;
      religadas = [];
      if (!rec) ligar();
    },
    parar: () => desligar('stop'),
    abortar: () => desligar('abort'),
    get ativa() {
      return desejada;
    },
  };
}

// ---------- reconhecimento no computador (disponibilidade e pacote de idioma)

export type EstadoLocal = Disponibilidade | 'sem-suporte' | 'verificando';

export interface SituacaoLocal {
  estado: EstadoLocal;
  instalando: boolean;
  erro: string | null;
}

const POLL_BAIXANDO_MS = 2500;
const opcoesLocais = (): OpcoesReconhecimento => ({ langs: [IDIOMA], processLocally: true });

let situacao: SituacaoLocal = { estado: 'verificando', instalando: false, erro: null };
let verificado = false;
let poll: ReturnType<typeof setTimeout> | null = null;
const ouvintes = new Set<() => void>();

function mudar(m: Partial<SituacaoLocal>) {
  situacao = { ...situacao, ...m };
  ouvintes.forEach((o) => o());
}

export async function verificarLocal(): Promise<EstadoLocal> {
  verificado = true;
  if (poll) clearTimeout(poll);
  poll = null;
  const C = obterReconhecimento();
  if (!C || typeof C.available !== 'function') {
    mudar({ estado: 'sem-suporte' });
    return 'sem-suporte';
  }
  let estado: EstadoLocal;
  try {
    estado = await C.available(opcoesLocais());
  } catch {
    estado = 'unavailable';
  }
  mudar({ estado });
  if (estado === 'downloading') poll = setTimeout(() => void verificarLocal(), POLL_BAIXANDO_MS);
  return estado;
}

/** Baixa o pacote pt-BR do reconhecimento no computador (o Chrome pode pedir confirmação). */
export async function instalarLocal(): Promise<boolean> {
  const C = obterReconhecimento();
  if (!C || typeof C.install !== 'function') return false;
  mudar({ instalando: true, erro: null, estado: 'downloading' });
  try {
    const ok = await C.install(opcoesLocais());
    if (!ok) mudar({ erro: 'O Chrome não conseguiu baixar o pacote de português. Tente de novo mais tarde.' });
    return ok;
  } catch (e) {
    mudar({ erro: e instanceof Error && e.message ? `Não deu para baixar o pacote: ${e.message}` : 'Não deu para baixar o pacote de português.' });
    return false;
  } finally {
    mudar({ instalando: false });
    await verificarLocal();
  }
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  if (!verificado) void verificarLocal();
  return () => ouvintes.delete(ouvinte);
}

const obter = () => situacao;

export const useReconhecimentoLocal = (): SituacaoLocal => useSyncExternalStore(assinar, obter, obter);

/** Só para os testes. */
export function reiniciarSituacaoLocal(): void {
  if (poll) clearTimeout(poll);
  poll = null;
  verificado = false;
  situacao = { estado: 'verificando', instalando: false, erro: null };
}

/** Qual motor usar agora: no computador só se a pessoa preferir e o pacote estiver pronto. */
export function usarLocal(prefs: PreferenciasVoz, estado: EstadoLocal): boolean {
  return prefs.reconhecimento === 'local' && estado === 'available';
}

export const rotuloDoMotor = (local: boolean) => (local ? 'Reconhecimento no computador' : 'Reconhecimento pelo Google (online)');
