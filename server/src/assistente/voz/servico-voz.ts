import { ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { baixarVoz, type ExtratorDeVoz, FalhaNoDownload, type FetchDeVoz, limparTemporarios, type ProgressoDeVoz } from './baixador';
import { CATALOGO_DE_VOZES, type GeneroVoz, type QualidadeVoz, VOZ_PADRAO, type VozDoCatalogo } from './catalogo';
import { extrairEmSegundoPlano } from './extracao';
import { arquivosDaVoz, type CarregadorDeVoz, carregarComSherpa, VELOCIDADE, type VozCarregada } from './sintetizador';
import { paraWav } from './wav';

/**
 * A voz natural do assistente (Piper), inteira nesta máquina: baixa uma voz do
 * catálogo quando a pessoa pede, carrega o modelo na primeira fala (e o mantém
 * na memória) e transforma frase em WAV. As falas passam por uma fila: uma
 * síntese por vez (o processador não se divide entre várias), com limite de
 * espera e de tamanho. O texto falado é dado financeiro: nunca vai para o log.
 */

export interface VozDisponivel {
  id: string;
  nome: string;
  genero: GeneroVoz;
  qualidade: QualidadeVoz;
  descricao: string;
  tamanhoMb: number;
  licenca: string;
  credito: string;
  naoComercial: boolean;
  instalada: boolean;
}

export interface EstadoVoz {
  /** Alguma voz pronta para falar. */
  instalada: boolean;
  baixando: boolean;
  /** Qual voz está sendo baixada. */
  vozBaixando: string | null;
  etapa: ProgressoDeVoz['etapa'] | null;
  /** 0–1 enquanto baixa; null fora disso (ou na etapa sem medida). */
  progresso: number | null;
  vozes: VozDisponivel[];
  vozPadrao: string;
  erro: string | null;
}

export interface PedidoDeFala {
  texto: string;
  voz?: string;
  velocidade?: number;
}

export interface OpcoesServicoVoz {
  carregador?: CarregadorDeVoz;
  fetch?: FetchDeVoz;
  extrair?: ExtratorDeVoz;
  /** Espera máxima de uma fala (inclui carregar o modelo na primeira vez). */
  tempoLimiteMs?: number;
  /** Falas esperando a vez; acima disso, 503. */
  maximoNaFila?: number;
  /** Só para os testes (pacotes de mentira com o SHA-256 deles). No app, sempre o catálogo fixo. */
  catalogo?: readonly VozDoCatalogo[];
}

export const MAXIMO_CARACTERES = 600;
const TEMPO_LIMITE_MS = 30_000;
const MAXIMO_NA_FILA = 6;
const MEGABYTE = 1024 * 1024;

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ServicoDeVoz {
  private readonly logger = new Logger('Voz');
  private readonly pasta: string;
  private readonly carregador: CarregadorDeVoz;
  private readonly fetch: FetchDeVoz;
  private readonly extrair: ExtratorDeVoz;
  private readonly tempoLimiteMs: number;
  private readonly maximoNaFila: number;
  private readonly catalogo: readonly VozDoCatalogo[];

  private download: { voz: string; progresso: ProgressoDeVoz | null; promessa: Promise<void> } | null = null;
  private erro: string | null = null;
  /** O modelo carregado (um só: trocar de voz descarta o anterior). */
  private carregada: { voz: string; promessa: Promise<VozCarregada> } | null = null;
  /** A cauda da fila de sínteses. */
  private fila: Promise<unknown> = Promise.resolve();
  private naFila = 0;

  constructor(pastaModelos: string, opcoes: OpcoesServicoVoz = {}) {
    this.pasta = join(pastaModelos, 'piper');
    this.carregador = opcoes.carregador ?? carregarComSherpa;
    this.fetch = opcoes.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.extrair = opcoes.extrair ?? extrairEmSegundoPlano;
    this.tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS;
    this.maximoNaFila = opcoes.maximoNaFila ?? MAXIMO_NA_FILA;
    this.catalogo = opcoes.catalogo ?? CATALOGO_DE_VOZES;
  }

  private daLista(id: string): VozDoCatalogo | undefined {
    return this.catalogo.find((v) => v.id === id);
  }

  private instalada(id: string): boolean {
    return arquivosDaVoz(join(this.pasta, id)) !== null;
  }

  estado(): EstadoVoz {
    const vozes = this.catalogo.map((v) => ({
      id: v.id,
      nome: v.nome,
      genero: v.genero,
      qualidade: v.qualidade,
      descricao: v.descricao,
      tamanhoMb: Math.round(v.bytes / MEGABYTE),
      licenca: v.licenca,
      credito: v.credito,
      naoComercial: v.naoComercial,
      instalada: this.instalada(v.id),
    }));
    const p = this.download?.progresso ?? null;
    return {
      instalada: vozes.some((v) => v.instalada),
      baixando: this.download !== null,
      vozBaixando: this.download?.voz ?? null,
      etapa: p?.etapa ?? null,
      progresso: p && p.etapa === 'baixando' && p.total > 0 ? Math.min(1, p.carregado / p.total) : null,
      vozes,
      vozPadrao: VOZ_PADRAO,
      erro: this.erro,
    };
  }

  /** Começa a baixar (em segundo plano) e devolve o estado. Uma voz por vez. */
  baixar(id: string): EstadoVoz {
    const voz = this.daLista(id);
    if (!voz) throw new NotFoundException('Voz desconhecida.');
    if (this.download) {
      if (this.download.voz === id) return this.estado();
      throw new ConflictException('Já há uma voz sendo baixada. Espere terminar.');
    }
    if (this.instalada(id)) return this.estado();
    this.erro = null;
    const atual: { voz: string; progresso: ProgressoDeVoz | null; promessa: Promise<void> } = { voz: id, progresso: null, promessa: Promise.resolve() };
    atual.promessa = baixarVoz(voz, this.pasta, {
      fetch: this.fetch,
      extrair: this.extrair,
      aoProgredir: (p) => {
        atual.progresso = p;
      },
    })
      .then(() => this.logger.log(`Voz ${id} instalada.`))
      .catch((e: unknown) => {
        this.erro = e instanceof FalhaNoDownload ? e.message : `Não foi possível instalar a voz: ${mensagemDe(e)}`;
        this.logger.warn(`Falha ao instalar a voz ${id}: ${mensagemDe(e)}`);
      })
      .finally(() => {
        if (this.download === atual) this.download = null;
      });
    this.download = atual;
    return this.estado();
  }

  /** Só para os testes (e para quem precisa esperar): o download em andamento. */
  esperarDownload(): Promise<void> {
    return this.download?.promessa ?? Promise.resolve();
  }

  remover(id: string): EstadoVoz {
    if (!this.daLista(id)) throw new NotFoundException('Voz desconhecida.');
    if (this.download?.voz === id) throw new ConflictException('Esta voz ainda está sendo baixada.');
    if (this.carregada?.voz === id) this.carregada = null;
    rmSync(join(this.pasta, id), { recursive: true, force: true });
    limparTemporarios(this.pasta, id);
    return this.estado();
  }

  /** A voz pedida, se instalada; senão a padrão; senão a primeira instalada. */
  private escolher(pedida?: string): string {
    if (pedida) {
      if (!this.daLista(pedida)) throw new NotFoundException('Voz desconhecida.');
      if (this.instalada(pedida)) return pedida;
    }
    if (this.daLista(VOZ_PADRAO) && this.instalada(VOZ_PADRAO)) return VOZ_PADRAO;
    const qualquer = this.catalogo.find((v) => this.instalada(v.id));
    if (!qualquer) throw new ConflictException('Nenhuma voz natural instalada. Baixe uma em Ajustes → Assistente de IA → Voz.');
    return qualquer.id;
  }

  private carregar(voz: string): Promise<VozCarregada> {
    if (this.carregada?.voz === voz) return this.carregada.promessa;
    const promessa = this.carregador(join(this.pasta, voz));
    const atual = { voz, promessa };
    this.carregada = atual;
    // Carga que falhou não fica no cache: a próxima fala tenta de novo.
    promessa.catch(() => {
      if (this.carregada === atual) this.carregada = null;
    });
    return promessa;
  }

  /** Carrega o modelo antes da primeira fala (abrir o modo conversação). Não lança. */
  async preparar(pedida?: string): Promise<void> {
    try {
      await this.carregar(this.escolher(pedida));
    } catch (e) {
      this.logger.warn(`Não foi possível preparar a voz: ${mensagemDe(e)}`);
    }
  }

  /**
   * Uma frase → WAV. Espera a vez na fila; `cancelado()` verdadeiro na hora de
   * começar (a tela parou de falar) pula a síntese.
   */
  async falar(pedido: PedidoDeFala, cancelado: () => boolean = () => false): Promise<Buffer> {
    const texto = pedido.texto.trim();
    if (!texto) throw new ConflictException('Nada para falar.');
    if (texto.length > MAXIMO_CARACTERES) throw new ConflictException(`Texto longo demais para uma fala (máximo ${MAXIMO_CARACTERES} caracteres).`);
    const voz = this.escolher(pedido.voz);
    const velocidade = Math.min(VELOCIDADE.max, Math.max(VELOCIDADE.min, pedido.velocidade ?? 1));
    if (this.naFila >= this.maximoNaFila) throw new ServiceUnavailableException('A voz está ocupada. Tente de novo em instantes.');

    this.naFila += 1;
    const vez = this.fila.then(async () => {
      if (cancelado()) return null;
      const modelo = await this.carregar(voz);
      const inicio = performance.now();
      const amostras = await modelo.gerar(texto, velocidade);
      const ms = Math.round(performance.now() - inicio);
      this.logger.debug(`Fala de ${texto.length} caracteres em ${ms} ms (${voz}).`);
      return paraWav(amostras, modelo.taxa);
    });
    // A fila anda quando a síntese acaba de verdade (mesmo depois do tempo limite de quem pediu).
    this.fila = vez.catch(() => undefined).finally(() => {
      this.naFila -= 1;
    });

    let relogio: NodeJS.Timeout | undefined;
    const limite = new Promise<never>((_, reject) => {
      relogio = setTimeout(() => reject(new ServiceUnavailableException('A voz demorou demais para responder.')), this.tempoLimiteMs);
    });
    try {
      const wav = await Promise.race([vez, limite]);
      if (!wav) throw new ConflictException('Fala cancelada.');
      return wav;
    } catch (e) {
      if (e instanceof ConflictException || e instanceof ServiceUnavailableException) throw e;
      this.logger.error(`Falha na síntese de voz (${voz}): ${mensagemDe(e)}`);
      throw new ServiceUnavailableException('A voz natural falhou nesta frase.');
    } finally {
      clearTimeout(relogio);
    }
  }
}
