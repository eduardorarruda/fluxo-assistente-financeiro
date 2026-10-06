import { Logger } from '@nestjs/common';
import { extrairTexto } from './extrator';
import { fatiar } from './fatiador';
import type { IndiceDeTrechos, ResultadoBusca } from './indice';
import { textoDoMovimento, type MovimentoParaIndice } from './movimento';
import type { ProgressoDownload, VetorizadorPreparavel } from './vetorizador';

export type { MovimentoParaIndice } from './movimento';

/**
 * Orquestra o RAG: mantém os trechos de movimentos e anexos no índice, baixa
 * o modelo quando a pessoa ativa, vetoriza em segundo plano e faz a busca
 * híbrida. A vetorização roda em lotes, cedendo a vez ao event loop entre um
 * e outro (o servidor HTTP continua respondendo), com um trabalhador só.
 */

export interface EstadoRag {
  ativo: boolean;
  preparando: boolean;
  progresso: number | null;
  etapa: string | null;
  erro: string | null;
  modelo: string;
  movimentosIndexados: number;
  movimentosTotal: number;
  trechosDeAnexos: number;
}

export interface AnexoParaIndice {
  id: string;
  conversaId: string;
  tipo: 'pdf' | 'texto';
}

export interface AnexoIndexado {
  situacao: 'pronto' | 'sem_texto';
  texto: string;
  paginas: number | null;
}

const LOTE_PADRAO = 32;
/** Consulta maior que isto não melhora a busca; só gasta o modelo. */
const MAXIMO_DA_CONSULTA = 2_000;
/** Lotes seguidos sem gravar nada: algo está errado, melhor parar do que girar em falso. */
const MAXIMO_SEM_PROGRESSO = 3;
const MEGABYTE = 1024 * 1024;
const NUMERO = new Intl.NumberFormat('pt-BR');

const ceder = () => new Promise<void>((resolve) => setImmediate(resolve));
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Indexador {
  private readonly logger = new Logger('Indexador');
  private readonly tamanhoDoLote: number;
  private ativo = false;
  /** `ativar` ou `reindexar` em andamento. */
  private operacao: Promise<void> | null = null;
  /** O laço de vetorização em andamento (no máximo um). */
  private trabalhador: Promise<void> | null = null;
  /** Chegou trabalho novo: o laço dá mais uma volta antes de parar. */
  private haTrabalhoNovo = false;
  private progresso: number | null = null;
  private etapa: string | null = null;
  private erro: string | null = null;

  constructor(
    private readonly indice: IndiceDeTrechos,
    private readonly vetorizador: VetorizadorPreparavel,
    opcoes: { tamanhoDoLote?: number } = {},
  ) {
    this.tamanhoDoLote = Math.max(1, Math.trunc(opcoes.tamanhoDoLote ?? LOTE_PADRAO));
  }

  static textoDoMovimento(m: MovimentoParaIndice): string {
    return textoDoMovimento(m);
  }

  /** Na subida: se o modelo já está baixado, ativa os vetores e vetoriza os pendentes em segundo plano. */
  iniciar(): void {
    if (this.ativo || !this.vetorizador.baixado()) return;
    if (this.ativarVetores()) void this.agendar();
  }

  estado(): EstadoRag {
    const e = this.indice.estatisticas();
    return {
      ativo: this.ativo,
      preparando: this.operacao !== null || this.trabalhador !== null,
      progresso: this.progresso,
      etapa: this.etapa,
      erro: this.erro,
      modelo: this.vetorizador.modelo,
      movimentosIndexados: e.movimentosVetorizados,
      movimentosTotal: e.movimentos,
      trechosDeAnexos: e.trechosDeAnexos,
    };
  }

  /** Baixa o modelo e vetoriza tudo. Não lança: o erro fica em `estado().erro`. Chamada concorrente não duplica. */
  ativar(): Promise<void> {
    this.operacao ??= this.executar('Não foi possível ativar a busca por significado', () => this.baixarEIndexar());
    return this.operacao;
  }

  /** Recria os vetores de tudo. Sem os vetores ativos, é o mesmo que ativar. */
  reindexar(): Promise<void> {
    if (this.operacao) return this.operacao;
    if (!this.ativo) return this.ativar();
    this.operacao = this.executar('Não foi possível reindexar a busca por significado', async () => {
      this.erro = null;
      await this.esperarTrabalhador();
      this.indice.reiniciarVetores();
      await this.agendar();
    });
    return this.operacao;
  }

  /** Atualiza os trechos dos movimentos e agenda a vetorização dos novos, sem esperar por ela. */
  indexarMovimentos(movimentos: MovimentoParaIndice[]): void {
    const itens = movimentos.map((m) => ({ refId: m.id, texto: textoDoMovimento(m) }));
    this.indice.sincronizarMovimentos(itens);
    void this.agendar();
  }

  /** Extrai, fatia e indexa um anexo. Devolve o texto extraído para quem chamou guardar. */
  async indexarAnexo(anexo: AnexoParaIndice, bytes: Buffer): Promise<AnexoIndexado> {
    const { texto, paginas } = await extrairTexto(bytes, anexo.tipo);
    const trechos = texto.trim() ? fatiar(texto) : [];
    this.indice.definirTrechosDoAnexo(anexo.id, anexo.conversaId, trechos);
    if (trechos.length === 0) return { situacao: 'sem_texto', texto: '', paginas };
    void this.agendar();
    return { situacao: 'pronto', texto, paginas };
  }

  removerAnexo(anexoId: string): void {
    this.indice.removerAnexo(anexoId);
  }

  removerConversa(conversaId: string): void {
    this.indice.removerConversa(conversaId);
  }

  /** Busca híbrida; vetoriza a consulta se os vetores estiverem ativos, senão só palavras. */
  async buscar(consulta: string, opcoes: { escopos: string[]; limite: number }): Promise<ResultadoBusca[]> {
    const limpa = consulta.trim().slice(0, MAXIMO_DA_CONSULTA);
    if (!limpa) return [];
    const vetor = this.ativo ? await this.vetorDaConsulta(limpa) : null;
    return this.indice.buscar(limpa, vetor, opcoes);
  }

  /** Resolve quando não há download nem vetorização em andamento (testes e desligamento). */
  async ocioso(): Promise<void> {
    while (this.operacao || this.trabalhador) {
      await Promise.allSettled([this.operacao, this.trabalhador]);
    }
  }

  // ------------------------------------------------------------ privados

  /** O passo começa no próximo microtask: `operacao` já está atribuída quando ele roda (e `preparando` é verdade). */
  private executar(contexto: string, passo: () => Promise<void>): Promise<void> {
    return Promise.resolve()
      .then(passo)
      .catch((e: unknown) => this.registrarErro(contexto, e))
      .finally(() => {
        this.operacao = null;
        this.etapa = null;
        this.progresso = null;
      });
  }

  private async baixarEIndexar(): Promise<void> {
    this.erro = null;
    this.etapa = 'Preparando o modelo';
    this.progresso = null;
    await this.vetorizador.preparar((p) => this.mostrarDownload(p));
    if (this.ativarVetores()) await this.agendar();
  }

  private ativarVetores(): boolean {
    const r = this.indice.ativarVetores(this.vetorizador.dimensao);
    if (r.ok) {
      this.ativo = true;
      return true;
    }
    this.ativo = false;
    this.erro = r.erro ?? 'Busca por significado indisponível.';
    this.logger.error(this.erro);
    return false;
  }

  /**
   * Um trabalhador só. Quem chama no meio só marca que há trabalho novo; o
   * laço dá mais uma volta. `rodarTrabalhador` sempre cede a vez antes de
   * qualquer coisa, então a atribuição abaixo acontece antes do `finally` dele.
   */
  private agendar(): Promise<void> {
    if (!this.ativo) return Promise.resolve();
    this.haTrabalhoNovo = true;
    this.trabalhador ??= this.rodarTrabalhador();
    return this.trabalhador;
  }

  private async rodarTrabalhador(): Promise<void> {
    try {
      while (this.haTrabalhoNovo) {
        this.haTrabalhoNovo = false;
        if (!(await this.vetorizarPendentes())) break;
      }
    } finally {
      this.trabalhador = null;
    }
  }

  private async esperarTrabalhador(): Promise<void> {
    while (this.trabalhador) await this.trabalhador;
  }

  /** Vetoriza lote a lote até não sobrar pendente. `false` se parou por erro. */
  private async vetorizarPendentes(): Promise<boolean> {
    this.erro = null;
    let feitos = 0;
    let semProgresso = 0;
    try {
      for (;;) {
        await ceder();
        const lote = this.indice.pendentes(this.tamanhoDoLote);
        if (lote.length === 0) return true;
        this.mostrarIndexacao(feitos, feitos + this.indice.estatisticas().pendentes);
        const vetores = await this.vetorizador.vetorizar(lote.map((t) => t.texto), 'documento');
        if (vetores.length !== lote.length) throw new Error(`${vetores.length} vetores para ${lote.length} trechos.`);
        const gravados = this.indice.gravarVetores(lote.map((t, i) => ({ ...t, vetor: vetores[i]! })));
        feitos += gravados;
        semProgresso = gravados === 0 ? semProgresso + 1 : 0;
        if (semProgresso >= MAXIMO_SEM_PROGRESSO) throw new Error('os trechos pendentes não puderam ser gravados.');
      }
    } catch (e) {
      this.registrarErro('Falha ao indexar para a busca por significado', e);
      return false;
    } finally {
      this.etapa = null;
      this.progresso = null;
    }
  }

  private async vetorDaConsulta(consulta: string): Promise<Float32Array | null> {
    try {
      const [vetor] = await this.vetorizador.vetorizar([consulta], 'consulta');
      return vetor ?? null;
    } catch (e) {
      this.logger.warn(`Busca só por palavra: não foi possível vetorizar a consulta (${mensagemDe(e)}).`);
      return null;
    }
  }

  private mostrarDownload(p: ProgressoDownload): void {
    const mb = (bytes: number) => NUMERO.format(Math.round(bytes / MEGABYTE));
    this.progresso = p.total > 0 ? Math.min(p.carregado / p.total, 1) : null;
    this.etapa = p.total > 0
      ? `Baixando o modelo (${mb(p.carregado)} MB de ${mb(p.total)} MB)`
      : `Baixando o modelo (${mb(p.carregado)} MB)`;
  }

  private mostrarIndexacao(feitos: number, total: number): void {
    this.progresso = total > 0 ? feitos / total : null;
    this.etapa = `Indexando (${NUMERO.format(feitos)} de ${NUMERO.format(total)})`;
  }

  private registrarErro(contexto: string, e: unknown): void {
    this.erro = `${contexto}: ${mensagemDe(e)}`;
    this.logger.error(this.erro, e instanceof Error ? e.stack : undefined);
  }
}
