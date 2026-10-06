import { type EstadoVozNatural, prepararVozNatural, type Sintetizar, sintetizarNoServidor } from '../../../api/voz-natural';
import { criarMotorNavegador, type MotorDeFala, type OpcoesFala } from './fala';
import { normalizarParaFala } from './fala-numeros';
import type { PreferenciasVoz } from './preferencias-voz';

/**
 * A voz natural (Piper). Cada frase vira um WAV no servidor do Fluxo (nesta
 * máquina) e toca pela Web Audio. Para a fala sair contínua, as próximas
 * frases já são pedidas enquanto a atual toca (até `ANTECIPAR` adiante). O
 * `AnalyserNode` dá a amplitude de verdade para a esfera.
 *
 * Se a voz natural falhar numa frase (servidor fora, voz removida), aquela
 * frase é lida pela voz do navegador e a pessoa vê um aviso uma vez. Com
 * `motor: 'navegador'` nas opções, tudo vai direto para a reserva.
 */

/** Frases pedidas adiante da que está tocando. */
export const ANTECIPAR = 2;
/** O servidor aceita até 600; a frase por extenso pode passar disso e é partida aqui. */
const MAXIMO_POR_PEDIDO = 500;
/** Folga para o fim de um áudio que nunca avisa que acabou (contexto suspenso). */
const FOLGA_FIM_MS = 2500;

export const AVISO_RESERVA = 'A voz natural não respondeu; esta parte foi lida pela voz do navegador.';

/** O pedaço da Web Audio que o motor usa (os testes trocam por um falso). */
export type ContextoDeAudio = Pick<AudioContext, 'createBufferSource' | 'createAnalyser' | 'decodeAudioData' | 'destination' | 'resume' | 'state'>;

export interface DependenciasMotorPiper {
  reserva?: MotorDeFala;
  sintetizar?: Sintetizar;
  criarContexto?: () => ContextoDeAudio | null;
  preparar?: (voz: string | null) => void;
}

interface Item {
  /** O que a legenda mostra (só na primeira parte de uma frase partida). */
  legenda: string | null;
  /** O que vai para a síntese (já por extenso). */
  texto: string;
  opcoes: OpcoesFala;
  audio: Promise<AudioBuffer> | null;
  controle: AbortController | null;
}

const contextoDoNavegador = (): ContextoDeAudio | null => {
  const Construtor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    return Construtor ? new Construtor() : null;
  } catch {
    return null;
  }
};

/** Texto longo demais para um pedido → partes, cortando na pontuação ou no espaço. */
export function partirParaSintese(texto: string, maximo = MAXIMO_POR_PEDIDO): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > maximo) {
    const janela = resto.slice(0, maximo);
    const pausa = Math.max(janela.lastIndexOf(', '), janela.lastIndexOf('; '), janela.lastIndexOf('. '));
    const corte = pausa > maximo / 2 ? pausa + 1 : janela.lastIndexOf(' ') > 0 ? janela.lastIndexOf(' ') : maximo;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

const abortado = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function criarMotorPiper(dependencias: DependenciasMotorPiper = {}): MotorDeFala {
  const reserva = dependencias.reserva ?? criarMotorNavegador();
  const sintetizar = dependencias.sintetizar ?? sintetizarNoServidor;
  const criarContexto = dependencias.criarContexto ?? contextoDoNavegador;
  const pedirPreparo = dependencias.preparar ?? prepararVozNatural;

  const comecar = new Set<(trecho: string) => void>();
  const esvaziar = new Set<() => void>();
  const avisos = new Set<(aviso: string) => void>();

  let fila: Item[] = [];
  let ocupado = false;
  /** A frase atual está com a voz do navegador. */
  let delegando = false;
  let atual: { fonte: AudioBufferSourceNode } | null = null;
  let vigia: ReturnType<typeof setTimeout> | null = null;
  /** Muda a cada `parar`: promessas de antes não tocam mais nada. */
  let geracao = 0;
  let avisou = false;
  let suave = 0;

  let contexto: ContextoDeAudio | null = null;
  let analisador: AnalyserNode | null = null;
  let amostras: Float32Array<ArrayBuffer> | null = null;

  const obterContexto = (): ContextoDeAudio | null => {
    if (contexto) return contexto;
    contexto = criarContexto();
    if (!contexto) return null;
    analisador = contexto.createAnalyser();
    analisador.fftSize = 1024;
    analisador.connect(contexto.destination);
    amostras = new Float32Array(analisador.fftSize);
    return contexto;
  };

  const limparVigia = () => {
    if (vigia) clearTimeout(vigia);
    vigia = null;
  };

  const buscar = (item: Item) => {
    if (item.audio || item.opcoes.motor !== 'piper') return;
    const ctx = obterContexto();
    if (!ctx) return;
    item.controle = new AbortController();
    const pedido = { texto: item.texto, voz: item.opcoes.vozNatural ?? null, velocidade: item.opcoes.velocidade };
    item.audio = sintetizar(pedido, item.controle.signal).then((bytes) => ctx.decodeAudioData(bytes));
    // Quem espera é `tocar`; aqui só evita "rejeição não tratada" de quem foi descartado.
    item.audio.catch(() => undefined);
  };

  /** Pede adiantado as próximas frases da fila. */
  const antecipar = () => fila.slice(0, ANTECIPAR).forEach(buscar);

  const terminou = () => {
    limparVigia();
    atual = null;
    proxima();
  };

  /** Esta parte vai pela voz do navegador (por escolha ou porque a natural falhou). */
  const delegar = (item: Item, porFalha: boolean) => {
    if (porFalha && !avisou) {
      avisou = true;
      avisos.forEach((o) => o(AVISO_RESERVA));
    }
    delegando = true;
    if (item.legenda) comecar.forEach((o) => o(item.legenda as string));
    reserva.falar(item.texto, item.opcoes);
  };

  const tocar = async (item: Item) => {
    const vez = geracao;
    let buffer: AudioBuffer;
    try {
      if (!item.audio) throw new Error('sem Web Audio');
      buffer = await item.audio;
    } catch (e) {
      if (vez !== geracao || abortado(e)) return;
      return delegar(item, true);
    }
    const ctx = obterContexto();
    if (vez !== geracao || !ctx || !analisador) return;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    if (vez !== geracao) return;
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(analisador);
    fonte.onended = () => {
      if (atual?.fonte === fonte) terminou();
    };
    atual = { fonte };
    if (item.legenda) comecar.forEach((o) => o(item.legenda as string));
    fonte.start();
    vigia = setTimeout(() => {
      if (atual?.fonte === fonte) terminou();
    }, buffer.duration * 1000 + FOLGA_FIM_MS);
  };

  function proxima(): void {
    limparVigia();
    const item = fila.shift();
    if (!item) {
      if (ocupado) {
        ocupado = false;
        esvaziar.forEach((o) => o());
      }
      return;
    }
    ocupado = true;
    if (item.opcoes.motor !== 'piper') {
      antecipar();
      return delegar(item, false);
    }
    buscar(item);
    antecipar();
    void tocar(item);
  }

  reserva.aoEsvaziar(() => {
    if (!delegando) return;
    delegando = false;
    proxima();
  });

  return {
    falar(trecho, opcoes) {
      if (!trecho.trim()) return;
      const partes = opcoes.motor === 'piper' ? partirParaSintese(normalizarParaFala(trecho)) : [trecho];
      const novos = partes.map((texto, i): Item => ({ legenda: i === 0 ? trecho : null, texto, opcoes, audio: null, controle: null }));
      fila = [...fila, ...novos];
      if (!ocupado) proxima();
      else antecipar();
    },
    parar() {
      geracao += 1;
      for (const item of fila) item.controle?.abort();
      fila = [];
      limparVigia();
      const fonte = atual?.fonte;
      atual = null;
      try {
        fonte?.stop();
      } catch {
        /* já tinha parado */
      }
      if (delegando) {
        delegando = false;
        reserva.parar();
      }
      ocupado = false;
    },
    ocupado: () => ocupado,
    nivel() {
      if (delegando) return reserva.nivel();
      let alvo = 0;
      if (atual && analisador && amostras) {
        analisador.getFloatTimeDomainData(amostras);
        let soma = 0;
        for (const a of amostras) soma += a * a;
        // RMS da fala fica em ~0,05–0,3: escala para 0–1 com um pouco de compressão.
        alvo = Math.min(1, Math.sqrt(Math.sqrt(soma / amostras.length)) * 1.6);
      }
      // Sobe rápido, desce devagar: a esfera respira com as sílabas.
      suave += (alvo - suave) * (alvo > suave ? 0.5 : 0.18);
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
    preparar(opcoes) {
      if (opcoes.motor !== 'piper') return;
      // Criar o contexto aqui (logo depois do clique que abriu a conversa) evita o bloqueio de autoplay.
      obterContexto();
      pedirPreparo(opcoes.vozNatural ?? null);
    },
    aoAvisar(o) {
      avisos.add(o);
      return () => avisos.delete(o);
    },
  };
}

// ---------- qual voz usar

/** A voz natural que vai falar: a escolhida, se instalada; senão a padrão; senão a primeira instalada. */
export function vozNaturalEfetiva(prefs: Pick<PreferenciasVoz, 'vozNatural'>, estado: EstadoVozNatural | null): string | null {
  const instaladas = estado?.vozes.filter((v) => v.instalada) ?? [];
  if (!estado || instaladas.length === 0) return null;
  return (instaladas.find((v) => v.id === prefs.vozNatural) ?? instaladas.find((v) => v.id === estado.vozPadrao) ?? instaladas[0])?.id ?? null;
}

/** As opções de cada fala a partir das preferências e do que está instalado. */
export function opcoesDaFala(prefs: PreferenciasVoz, estado: EstadoVozNatural | null): OpcoesFala {
  const natural = prefs.motorFala === 'piper' ? vozNaturalEfetiva(prefs, estado) : null;
  return { voz: prefs.voz, velocidade: prefs.velocidade, motor: natural ? 'piper' : 'navegador', vozNatural: natural };
}
