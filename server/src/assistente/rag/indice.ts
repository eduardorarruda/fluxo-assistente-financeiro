import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { load as carregarSqliteVec } from 'sqlite-vec';
import type { Banco } from '../../db/conexao';
import { fundirPorRrf, montarConsultaFts, type OrigemDaBusca } from './consulta';

/**
 * Índice dos trechos do assistente, em cima da tabela `trechos` (o texto),
 * de `trechos_fts` (FTS5, BM25 — criada pela migração 0004) e de
 * `trechos_vec` (sqlite-vec, KNN por cosseno — criada aqui, na subida,
 * porque depende de uma extensão nativa que pode não carregar). As três
 * compartilham o rowid (`trechos.id`).
 *
 * Invariante: `trechos.vetorizado = 1` ⇔ há vetor para o texto atual. Tabela
 * de vetores sem o gatilho de exclusão não é confiável (pode ter ficado com
 * vetor órfão numa subida sem a extensão) e é recriada ao ativar.
 */

export interface ResultadoBusca {
  trechoId: number;
  fonte: 'movimento' | 'anexo';
  refId: string;
  escopo: string;
  texto: string;
  pontuacao: number;
  origem: OrigemDaBusca[];
}

export type CarregadorDeExtensao = (cliente: Database.Database) => void;

export const ESCOPO_MOVIMENTOS = 'movimentos';
export const escopoDaConversa = (conversaId: string) => `conversa:${conversaId}`;

const GATILHO = 'trechos_vec_exclusao';
const LIMITE_MAXIMO = 100;
/** Candidatos de cada busca antes da fusão: mais que o pedido, para o RRF ter o que cruzar. */
const CANDIDATOS_POR_RESULTADO = 4;
const CANDIDATOS_MINIMOS = 20;
const LOTE_DE_IDS = 500;

interface LinhaTrecho {
  id: number;
  fonte: 'movimento' | 'anexo';
  refId: string;
  escopo: string;
  texto: string;
}

const hashDe = (texto: string) => createHash('sha256').update(texto).digest('hex');
const blob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

export class IndiceDeTrechos {
  private readonly logger = new Logger('IndiceDeTrechos');
  private readonly db: Database.Database;
  private extensaoCarregada = false;
  private dimensao: number | null = null;

  constructor(banco: Banco, private readonly carregarExtensao: CarregadorDeExtensao = carregarSqliteVec) {
    this.db = banco.$client;
    this.prepararTabelaExistente();
  }

  get vetoresAtivos(): boolean {
    return this.dimensao !== null;
  }

  /**
   * Carrega o sqlite-vec e cria `trechos_vec` + o gatilho que apaga o vetor
   * junto com o trecho. Idempotente. Dimensão diferente da gravada: recria e
   * marca tudo como não vetorizado. Nunca lança.
   */
  ativarVetores(dimensao: number): { ok: boolean; erro: string | null } {
    if (!Number.isInteger(dimensao) || dimensao < 1 || dimensao > 8192) {
      return { ok: false, erro: `Dimensão de vetor inválida: ${dimensao}.` };
    }
    try {
      this.garantirExtensao();
      const confiavel = this.dimensaoGravada() === dimensao && this.existe('trigger', GATILHO);
      if (!confiavel) this.recriarTabelaDeVetores(dimensao);
      this.dimensao = dimensao;
      return { ok: true, erro: null };
    } catch (e) {
      this.dimensao = null;
      return { ok: false, erro: `Busca por significado indisponível: ${mensagemDe(e)}` };
    }
  }

  /** Apaga todos os vetores e deixa tudo pendente (reindexação completa). */
  reiniciarVetores(): void {
    if (this.dimensao === null) throw new Error('Os vetores não estão ativos.');
    this.recriarTabelaDeVetores(this.dimensao);
  }

  /**
   * Um trecho por movimento, no escopo 'movimentos'. Compara pelo hash do
   * texto: insere os novos, atualiza os que mudaram (o vetor velho sai),
   * remove os que sumiram. Tudo numa transação.
   */
  sincronizarMovimentos(itens: { refId: string; texto: string }[]): { inseridos: number; atualizados: number; removidos: number } {
    const novos = new Map(itens.map((i) => [i.refId, i.texto]));
    const existentes = this.db
      .prepare("select id, ref_id as refId, hash from trechos where fonte = 'movimento'")
      .all() as { id: number; refId: string; hash: string }[];
    const porRef = new Map(existentes.map((e) => [e.refId, e]));
    const contagem = { inseridos: 0, atualizados: 0, removidos: 0 };
    const inserir = this.db.prepare(
      "insert into trechos (fonte, ref_id, escopo, ordem, texto, hash, vetorizado) values ('movimento', ?, ?, 0, ?, ?, 0)",
    );
    const atualizar = this.db.prepare('update trechos set texto = ?, hash = ?, vetorizado = 0 where id = ?');
    const remover = this.db.prepare('delete from trechos where id = ?');
    this.db.transaction(() => {
      for (const [refId, texto] of novos) {
        const hash = hashDe(texto);
        const atual = porRef.get(refId);
        if (!atual) {
          inserir.run(refId, ESCOPO_MOVIMENTOS, texto, hash);
          contagem.inseridos++;
        } else if (atual.hash !== hash) {
          atualizar.run(texto, hash, atual.id);
          this.apagarVetor(atual.id);
          contagem.atualizados++;
        }
      }
      for (const e of existentes) {
        if (novos.has(e.refId)) continue;
        remover.run(e.id);
        contagem.removidos++;
      }
    })();
    return contagem;
  }

  /** Troca todos os trechos de um anexo (escopo `conversa:<conversaId>`). */
  definirTrechosDoAnexo(anexoId: string, conversaId: string, trechos: string[]): void {
    const inserir = this.db.prepare(
      "insert into trechos (fonte, ref_id, escopo, ordem, texto, hash, vetorizado) values ('anexo', ?, ?, ?, ?, ?, 0)",
    );
    this.db.transaction(() => {
      this.db.prepare("delete from trechos where fonte = 'anexo' and ref_id = ?").run(anexoId);
      trechos.forEach((texto, ordem) => inserir.run(anexoId, escopoDaConversa(conversaId), ordem, texto, hashDe(texto)));
    })();
  }

  removerAnexo(anexoId: string): void {
    this.db.prepare("delete from trechos where fonte = 'anexo' and ref_id = ?").run(anexoId);
  }

  removerConversa(conversaId: string): void {
    this.db.prepare('delete from trechos where escopo = ?').run(escopoDaConversa(conversaId));
  }

  /** Trechos ainda sem vetor (só se os vetores estiverem ativos). */
  pendentes(limite: number): { id: number; escopo: string; texto: string }[] {
    if (!this.vetoresAtivos) return [];
    return this.db
      .prepare('select id, escopo, texto from trechos where vetorizado = 0 order by id limit ?')
      .all(limiteValido(limite, Number.MAX_SAFE_INTEGER)) as { id: number; escopo: string; texto: string }[];
  }

  /**
   * Grava os vetores e marca os trechos como vetorizados. Pula (sem erro) o
   * trecho que sumiu, mudou de escopo ou — se `texto` vier — mudou de texto
   * enquanto o vetor era calculado. Devolve quantos gravou.
   */
  gravarVetores(itens: { id: number; escopo: string; vetor: Float32Array; texto?: string }[]): number {
    const dimensao = this.dimensao;
    if (dimensao === null) throw new Error('Os vetores não estão ativos.');
    const errado = itens.find((i) => i.vetor.length !== dimensao);
    if (errado) throw new Error(`Vetor com dimensão ${errado.vetor.length}; o índice usa ${dimensao}.`);
    const ler = this.db.prepare('select escopo, hash from trechos where id = ?');
    const inserir = this.db.prepare('insert into trechos_vec (rowid, escopo, vetor) values (?, ?, ?)');
    const marcar = this.db.prepare('update trechos set vetorizado = 1 where id = ?');
    let gravados = 0;
    this.db.transaction(() => {
      for (const item of itens) {
        const atual = ler.get(item.id) as { escopo: string; hash: string } | undefined;
        if (!atual || atual.escopo !== item.escopo) continue;
        if (item.texto !== undefined && hashDe(item.texto) !== atual.hash) continue;
        this.apagarVetor(item.id);
        inserir.run(BigInt(item.id), item.escopo, blob(item.vetor));
        marcar.run(item.id);
        gravados++;
      }
    })();
    return gravados;
  }

  /**
   * Busca híbrida: BM25 (FTS5) e, se houver vetor da consulta e os vetores
   * estiverem ativos, KNN por cosseno — fundidas por RRF. Só nos escopos dados.
   */
  buscar(consulta: string, vetorConsulta: Float32Array | null, opcoes: { escopos: string[]; limite: number }): ResultadoBusca[] {
    const escopos = [...new Set(opcoes.escopos)];
    const limite = limiteValido(opcoes.limite, LIMITE_MAXIMO);
    if (escopos.length === 0) return [];
    const candidatos = Math.max(limite * CANDIDATOS_POR_RESULTADO, CANDIDATOS_MINIMOS);
    const porPalavra = this.buscarPorPalavra(consulta, escopos, candidatos);
    const porVetor = vetorConsulta ? this.buscarPorVetor(vetorConsulta, escopos, candidatos) : [];
    const fundidos = fundirPorRrf([
      { origem: 'palavra', ids: porPalavra },
      { origem: 'vetor', ids: porVetor },
    ]).slice(0, limite);
    const linhas = this.lerTrechos(fundidos.map((f) => f.id));
    return fundidos.flatMap((f) => {
      const linha = linhas.get(f.id);
      return linha ? [{ trechoId: f.id, fonte: linha.fonte, refId: linha.refId, escopo: linha.escopo, texto: linha.texto, pontuacao: f.pontuacao, origem: f.origem }] : [];
    });
  }

  estatisticas(): { movimentos: number; movimentosVetorizados: number; trechosDeAnexos: number; pendentes: number } {
    const linha = this.db.prepare(`
      select
        coalesce(sum(fonte = 'movimento'), 0) as movimentos,
        coalesce(sum(fonte = 'movimento' and vetorizado = 1), 0) as movimentosVetorizados,
        coalesce(sum(fonte = 'anexo'), 0) as trechosDeAnexos,
        coalesce(sum(vetorizado = 0), 0) as pendentes
      from trechos`).get() as { movimentos: number; movimentosVetorizados: number; trechosDeAnexos: number; pendentes: number };
    return { ...linha, pendentes: this.vetoresAtivos ? linha.pendentes : 0 };
  }

  // ------------------------------------------------------------ privados

  private buscarPorPalavra(consulta: string, escopos: string[], candidatos: number): number[] {
    const match = montarConsultaFts(consulta);
    if (!match) return [];
    const marcas = escopos.map(() => '?').join(', ');
    const linhas = this.db.prepare(`
      select t.id as id
      from trechos_fts join trechos t on t.id = trechos_fts.rowid
      where trechos_fts match ? and t.escopo in (${marcas})
      order by bm25(trechos_fts), t.id
      limit ?`).all(match, ...escopos, candidatos) as { id: number }[];
    return linhas.map((l) => l.id);
  }

  /** Um KNN por escopo (é a chave de partição do vec0), juntados pela distância. */
  private buscarPorVetor(vetor: Float32Array, escopos: string[], candidatos: number): number[] {
    if (this.dimensao === null || vetor.length !== this.dimensao) return [];
    const knn = this.db.prepare(
      'select rowid as id, distance from trechos_vec where vetor match ? and k = ? and escopo = ? order by distance',
    );
    const achados = escopos.flatMap((escopo) => knn.all(blob(vetor), candidatos, escopo) as { id: number; distance: number }[]);
    return achados
      .sort((a, b) => a.distance - b.distance || a.id - b.id)
      .slice(0, candidatos)
      .map((a) => Number(a.id));
  }

  private lerTrechos(ids: number[]): Map<number, LinhaTrecho> {
    const mapa = new Map<number, LinhaTrecho>();
    for (let i = 0; i < ids.length; i += LOTE_DE_IDS) {
      const lote = ids.slice(i, i + LOTE_DE_IDS);
      const linhas = this.db
        .prepare(`select id, fonte, ref_id as refId, escopo, texto from trechos where id in (${lote.map(() => '?').join(', ')})`)
        .all(...lote) as LinhaTrecho[];
      for (const l of linhas) mapa.set(l.id, l);
    }
    return mapa;
  }

  private garantirExtensao(): void {
    if (this.extensaoCarregada) return;
    this.carregarExtensao(this.db);
    this.extensaoCarregada = true;
  }

  /**
   * Banco que já tem `trechos_vec`: o gatilho dela precisa do módulo vec0
   * para apagar trechos. Sem a extensão nesta subida, o gatilho sai (a tabela
   * passa a ser "não confiável" e é recriada quando a extensão voltar).
   */
  private prepararTabelaExistente(): void {
    if (!this.existe('table', 'trechos_vec')) return;
    try {
      this.garantirExtensao();
    } catch (e) {
      this.logger.warn(`sqlite-vec não carregou (${mensagemDe(e)}); os vetores serão refeitos quando voltar.`);
      this.db.exec(`drop trigger if exists ${GATILHO}`);
    }
  }

  private recriarTabelaDeVetores(dimensao: number): void {
    this.db.transaction(() => {
      this.db.exec(`drop trigger if exists ${GATILHO}`);
      this.db.exec('drop table if exists trechos_vec');
      this.db.exec(
        `create virtual table trechos_vec using vec0(escopo text partition key, vetor float[${dimensao}] distance_metric=cosine)`,
      );
      this.db.exec(`create trigger ${GATILHO} after delete on trechos begin delete from trechos_vec where rowid = old.id; end`);
      this.db.exec('update trechos set vetorizado = 0');
    })();
  }

  private apagarVetor(id: number): void {
    if (this.extensaoCarregada && this.existe('table', 'trechos_vec')) {
      this.db.prepare('delete from trechos_vec where rowid = ?').run(BigInt(id));
    }
  }

  private dimensaoGravada(): number | null {
    const linha = this.db.prepare("select sql from sqlite_master where type = 'table' and name = 'trechos_vec'").get() as
      { sql: string } | undefined;
    const dimensao = linha?.sql.match(/float\[(\d+)\]/)?.[1];
    return dimensao ? Number(dimensao) : null;
  }

  private existe(tipo: 'table' | 'trigger', nome: string): boolean {
    return this.db.prepare('select 1 from sqlite_master where type = ? and name = ?').get(tipo, nome) !== undefined;
  }
}

function limiteValido(limite: number, maximo: number): number {
  if (!Number.isFinite(limite)) return 1;
  return Math.min(Math.max(Math.trunc(limite), 1), maximo);
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
