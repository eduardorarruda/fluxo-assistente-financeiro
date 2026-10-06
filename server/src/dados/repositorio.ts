import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { BANCO } from '../db/banco.module';
import type { Banco } from '../db/conexao';
import * as s from '../db/schema';
import type { Regra } from '../domain/categorizacao';
import type { Meta } from '../domain/metas';
import type { Ajuste } from '../domain/movimentos';
import { somarDias } from '../domain/datas';
import { chaveDeDescricao } from '../domain/texto';
import type { Caixinha, Conta, Dia, Fatura, Investimento, Transacao } from '../domain/types';
import type { DadosDaConexao } from '../provedores/provedor';
import type { PontoHistorico } from '../provedores/provedor-demo';
import { RELOGIO, type Relogio } from '../relogio';
import {
  impressaoDe, linhaParaAjuste, linhaParaCaixinha, linhaParaConta, linhaParaFatura, linhaParaInvestimento,
  linhaParaRegra, linhaParaTransacao, transacaoParaLinha,
} from './mapeamento';

export type LinhaConexao = typeof s.conexoes.$inferSelect;
export type LinhaContaAPagar = typeof s.contasAPagar.$inferSelect;

export interface Instantaneo {
  conexoes: LinhaConexao[];
  contas: Conta[];
  caixinhas: Caixinha[];
  investimentos: Investimento[];
  transacoes: Transacao[];
  faturas: Fatura[];
  ajustes: Map<string, Ajuste>;
  regras: Regra[];
  orcamentos: Map<string, number>;
  metas: Meta[];
  contasAPagar: LinhaContaAPagar[];
  configuracoes: Configuracoes;
}

export interface Configuracoes {
  /** O banco já soma as caixinhas no saldo da conta (aí elas não somam de novo no patrimônio). */
  caixinhasNoSaldo: boolean;
  /** O usuário removeu a demonstração: ela não volta sozinha. */
  demoDispensada: boolean;
}

const CONFIGURACOES_PADRAO: Configuracoes = { caixinhasNoSaldo: false, demoDispensada: false };

export interface ResultadoSincronizacao {
  novas: number;
  atualizadas: number;
  removidas: number;
  ajustesPreservados: number;
}

/** Colunas que o upsert atualiza: todas menos a chave. */
function excluidas<T extends SQLiteTable>(tabela: T, chaves: readonly string[]) {
  const colunas = (tabela as unknown as Record<string, { name?: string }>);
  const alvo: Record<string, unknown> = {};
  for (const [campo, coluna] of Object.entries(colunas)) {
    if (!coluna || typeof coluna !== 'object' || !('name' in coluna) || chaves.includes(campo)) continue;
    alvo[campo] = sql.raw(`excluded."${coluna.name}"`);
  }
  return alvo;
}

function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Único ponto que fala com o SQLite. Toda escrita incrementa `versao`, que é
 * o que o serviço de cálculo usa para saber quando refazer as contas.
 */
@Injectable()
export class Repositorio {
  private _versao = 0;

  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  get versao(): number {
    return this._versao;
  }

  private mudou(): void {
    this._versao++;
  }

  // ---------------------------------------------------------------- leitura

  instantaneo(): Instantaneo {
    const b = this.banco;
    return {
      conexoes: b.select().from(s.conexoes).all(),
      contas: b.select().from(s.contas).all().map(linhaParaConta),
      caixinhas: b.select().from(s.caixinhas).all().map(linhaParaCaixinha),
      investimentos: b.select().from(s.investimentos).all().map(linhaParaInvestimento),
      transacoes: b.select().from(s.transacoes).orderBy(s.transacoes.data, s.transacoes.id).all().map(linhaParaTransacao),
      faturas: b.select().from(s.faturas).all().map(linhaParaFatura),
      ajustes: new Map(b.select().from(s.ajustes).all().map((l) => [l.transacaoId, linhaParaAjuste(l)])),
      regras: b.select().from(s.regras).all().map(linhaParaRegra),
      orcamentos: new Map(b.select().from(s.orcamentos).all().map((l) => [l.categoriaId, l.limite])),
      metas: b.select().from(s.metas).all().map(({ criadaEm: _c, ...m }) => m),
      contasAPagar: this.contasAPagar(),
      configuracoes: this.configuracoes(),
    };
  }

  conexao(id: string): LinhaConexao | undefined {
    return this.banco.select().from(s.conexoes).where(eq(s.conexoes.id, id)).get();
  }

  historico(tipo: PontoHistorico['tipo'] | 'patrimonio'): { refId: string; dia: Dia; valor: number }[] {
    return this.banco
      .select({ refId: s.historico.refId, dia: s.historico.dia, valor: s.historico.valor })
      .from(s.historico)
      .where(eq(s.historico.tipo, tipo))
      .orderBy(s.historico.dia)
      .all();
  }

  ultimasSincronizacoes(limite = 20) {
    return this.banco.select().from(s.sincronizacoes).orderBy(sql`${s.sincronizacoes.id} desc`).limit(limite).all();
  }

  configuracoes(): Configuracoes {
    const linhas = this.banco.select().from(s.configuracoes).all();
    // Só as chaves do cálculo: a tabela também guarda a configuração do assistente, que não é deste objeto.
    const conhecidas = linhas.filter((l) => l.chave in CONFIGURACOES_PADRAO);
    const salvas = Object.fromEntries(conhecidas.map((l) => [l.chave, JSON.parse(l.valor) as unknown]));
    return { ...CONFIGURACOES_PADRAO, ...salvas } as Configuracoes;
  }

  // ------------------------------------------------------------- conexões

  criarConexao(id: string, provedor: 'pluggy' | 'demo', nome: string): void {
    this.banco
      .insert(s.conexoes)
      .values({ id, provedor, nome, situacao: 'UPDATING', criadaEm: this.relogio.agora().toISOString() })
      .onConflictDoNothing()
      .run();
    this.mudou();
  }

  removerConexao(id: string): void {
    // CASCADE leva contas → transações, caixinhas e faturas; o histórico sai à mão.
    this.banco.transaction((tx) => {
      const contas = tx.select({ id: s.contas.id }).from(s.contas).where(eq(s.contas.conexaoId, id)).all().map((c) => c.id);
      const caixinhas = contas.length
        ? tx.select({ id: s.caixinhas.id }).from(s.caixinhas).where(inArray(s.caixinhas.contaId, contas)).all().map((c) => c.id)
        : [];
      const investimentos = tx.select({ id: s.investimentos.id }).from(s.investimentos).where(eq(s.investimentos.conexaoId, id)).all().map((i) => i.id);
      const refs = [...contas, ...caixinhas, ...investimentos];
      if (refs.length) tx.delete(s.historico).where(inArray(s.historico.refId, refs)).run();
      tx.delete(s.conexoes).where(eq(s.conexoes.id, id)).run();
    });
    this.mudou();
  }

  registrarErroDeConexao(id: string, erro: string, situacao?: string): void {
    this.banco
      .update(s.conexoes)
      .set({ erro, ...(situacao ? { situacao } : {}) })
      .where(eq(s.conexoes.id, id))
      .run();
    this.mudou();
  }

  iniciarLogDeSincronizacao(conexaoId: string): number {
    const [linha] = this.banco
      .insert(s.sincronizacoes)
      .values({ conexaoId, inicio: this.relogio.agora().toISOString(), situacao: 'RODANDO' })
      .returning({ id: s.sincronizacoes.id })
      .all();
    return linha!.id;
  }

  encerrarLogDeSincronizacao(id: number, r: ResultadoSincronizacao | null, erro: string | null): void {
    this.banco
      .update(s.sincronizacoes)
      .set({
        fim: this.relogio.agora().toISOString(),
        situacao: erro ? 'ERRO' : 'OK',
        novas: r?.novas ?? 0,
        atualizadas: r?.atualizadas ?? 0,
        removidas: r?.removidas ?? 0,
        erro,
      })
      .where(eq(s.sincronizacoes.id, id))
      .run();
  }

  /**
   * Aplica o resultado de uma busca no provedor, tudo numa transação só: ou
   * entra inteiro, ou nada muda. O que o usuário criou nunca é tocado; os
   * ajustes de transações que trocaram de id são levados para o id novo.
   */
  aplicarSincronizacao(dados: DadosDaConexao & { historico?: PontoHistorico[] }): ResultadoSincronizacao {
    const agora = this.relogio.agora().toISOString();
    const hoje = this.relogio.hoje();
    const resultado: ResultadoSincronizacao = { novas: 0, atualizadas: 0, removidas: 0, ajustesPreservados: 0 };

    this.banco.transaction((tx) => {
      const c = dados.conexao;
      tx.update(s.conexoes)
        .set({
          nome: c.nome, conectorId: c.conectorId, logoUrl: c.logoUrl, cor: c.cor, situacao: c.situacao, erro: c.erro,
          atualizadaNoBanco: c.atualizadaNoBanco, consentimentoExpira: c.consentimentoExpira, ultimaSincronizacao: agora,
        })
        .where(eq(s.conexoes.id, c.id))
        .run();

      if (dados.contas.length) {
        tx.insert(s.contas)
          .values(dados.contas.map((conta) => ({ ...conta, conexaoId: c.id, atualizadaEm: agora })))
          .onConflictDoUpdate({ target: s.contas.id, set: excluidas(s.contas, ['id']) })
          .run();
      }

      const idsContas = dados.contas.map((conta) => conta.id);
      if (idsContas.length) tx.delete(s.caixinhas).where(inArray(s.caixinhas.contaId, idsContas)).run();
      if (dados.caixinhas.length) {
        tx.insert(s.caixinhas).values(dados.caixinhas.map((cx) => ({ ...cx, atualizadaEm: agora }))).run();
      }

      tx.delete(s.investimentos).where(eq(s.investimentos.conexaoId, c.id)).run();
      if (dados.investimentos.length) {
        tx.insert(s.investimentos).values(dados.investimentos.map((i) => ({ ...i, conexaoId: c.id, atualizadaEm: agora }))).run();
      }

      if (dados.faturas.length) {
        tx.insert(s.faturas)
          .values(dados.faturas)
          .onConflictDoUpdate({ target: s.faturas.id, set: excluidas(s.faturas, ['id']) })
          .run();
      }

      // Transações, conta por conta. Só apaga o que sumiu dentro de uma janela
      // que o provedor garantiu E que ele de fato cobriu: começa no mais tardio
      // entre o pedido e a transação mais antiga que veio. Conta sem janela
      // (banco ainda atualizando) ou que voltou vazia não perde nada.
      const chegaram = new Set(dados.transacoes.map((t) => t.id));
      for (const contaId of idsContas) {
        const daConta = dados.transacoes.filter((t) => t.contaId === contaId);
        const existentes = new Set(
          tx.select({ id: s.transacoes.id }).from(s.transacoes).where(eq(s.transacoes.contaId, contaId)).all().map((e) => e.id),
        );
        const novas = daConta.filter((t) => !existentes.has(t.id)).length;
        resultado.novas += novas;
        resultado.atualizadas += daConta.length - novas;

        const pedida = dados.janelas[contaId];
        if (!pedida || daConta.length === 0) continue;
        const maisAntiga = daConta.reduce((m, t) => (t.data < m ? t.data : m), daConta[0]!.data);
        const desde = pedida > maisAntiga ? pedida : maisAntiga;
        const sumiram = tx
          .select({ id: s.transacoes.id })
          .from(s.transacoes)
          .where(and(eq(s.transacoes.contaId, contaId), gte(s.transacoes.data, desde)))
          .all()
          .map((e) => e.id)
          .filter((id) => !chegaram.has(id));
        for (const lote of emLotes(sumiram, 500)) tx.delete(s.transacoes).where(inArray(s.transacoes.id, lote)).run();
        resultado.removidas += sumiram.length;
      }

      for (const lote of emLotes(dados.transacoes.map(transacaoParaLinha), 200)) {
        tx.insert(s.transacoes)
          .values(lote)
          .onConflictDoUpdate({ target: s.transacoes.id, set: excluidas(s.transacoes, ['id']) })
          .run();
      }

      resultado.ajustesPreservados = reatribuirAjustesOrfaos(tx);

      // Foto de hoje + histórico que o provedor souber reconstruir.
      const pontos: PontoHistorico[] = [
        ...dados.contas.map((conta) => ({ tipo: 'conta' as const, refId: conta.id, dia: hoje, valor: conta.saldo })),
        ...dados.caixinhas.map((cx) => ({ tipo: 'caixinha' as const, refId: cx.id, dia: hoje, valor: cx.valor })),
        ...dados.investimentos.map((i) => ({ tipo: 'investimento' as const, refId: i.id, dia: hoje, valor: i.saldo })),
        ...(dados.historico ?? []),
      ];
      for (const lote of emLotes(pontos, 300)) {
        tx.insert(s.historico)
          .values(lote)
          .onConflictDoUpdate({ target: [s.historico.tipo, s.historico.refId, s.historico.dia], set: { valor: sql`excluded.valor` } })
          .run();
      }
    });

    this.mudou();
    return resultado;
  }

  // ------------------------------------------------- dados do usuário

  salvarAjuste(transacaoId: string, parcial: Partial<Ajuste>): void {
    const t = this.banco.select().from(s.transacoes).where(eq(s.transacoes.id, transacaoId)).get();
    if (!t) throw new NaoEncontrado('Transação não encontrada.');
    const atual = this.banco.select().from(s.ajustes).where(eq(s.ajustes.transacaoId, transacaoId)).get();
    const novo = {
      transacaoId,
      impressao: t.impressao,
      natureza: parcial.natureza !== undefined ? parcial.natureza : (atual?.natureza ?? null),
      categoriaId: parcial.categoriaId !== undefined ? parcial.categoriaId : (atual?.categoriaId ?? null),
      nota: parcial.nota !== undefined ? parcial.nota : (atual?.nota ?? null),
      ignorar: parcial.ignorar ?? atual?.ignorar ?? false,
      atualizadoEm: this.relogio.agora().toISOString(),
    };
    const vazio = !novo.natureza && !novo.categoriaId && !novo.nota && !novo.ignorar;
    if (vazio) this.banco.delete(s.ajustes).where(eq(s.ajustes.transacaoId, transacaoId)).run();
    else this.banco.insert(s.ajustes).values(novo).onConflictDoUpdate({ target: s.ajustes.transacaoId, set: excluidas(s.ajustes, ['transacaoId']) }).run();
    this.mudou();
  }

  criarRegra(regra: Omit<Regra, 'prioridade'>): Regra {
    const maior = this.banco.select({ p: sql<number>`coalesce(max(${s.regras.prioridade}), 0)` }).from(s.regras).get()?.p ?? 0;
    const completa = { ...regra, prioridade: maior + 1 };
    this.banco.insert(s.regras).values({ ...completa, criadaEm: this.relogio.agora().toISOString() }).run();
    this.mudou();
    return completa;
  }

  removerRegra(id: string): void {
    this.banco.delete(s.regras).where(eq(s.regras.id, id)).run();
    this.mudou();
  }

  /** Devolve uma regra removida com o mesmo id e a mesma prioridade (desfazer do assistente). */
  restaurarRegra(regra: Regra): void {
    this.banco.insert(s.regras).values({ ...regra, criadaEm: this.relogio.agora().toISOString() }).onConflictDoNothing().run();
    this.mudou();
  }

  definirOrcamento(categoriaId: string, limite: number): void {
    if (limite <= 0) this.banco.delete(s.orcamentos).where(eq(s.orcamentos.categoriaId, categoriaId)).run();
    else this.banco.insert(s.orcamentos).values({ categoriaId, limite }).onConflictDoUpdate({ target: s.orcamentos.categoriaId, set: { limite } }).run();
    this.mudou();
  }

  salvarMeta(meta: Meta): void {
    this.banco
      .insert(s.metas)
      .values({ ...meta, criadaEm: this.relogio.agora().toISOString() })
      .onConflictDoUpdate({ target: s.metas.id, set: excluidas(s.metas, ['id', 'criadaEm']) })
      .run();
    this.mudou();
  }

  removerMeta(id: string): void {
    this.banco.delete(s.metas).where(eq(s.metas.id, id)).run();
    this.mudou();
  }

  contasAPagar(): LinhaContaAPagar[] {
    return this.banco.select().from(s.contasAPagar).orderBy(s.contasAPagar.vencimento, s.contasAPagar.criadaEm).all();
  }

  contaAPagar(id: string): LinhaContaAPagar | undefined {
    return this.banco.select().from(s.contasAPagar).where(eq(s.contasAPagar.id, id)).get();
  }

  /**
   * Grava (insere ou substitui) e remove contas a pagar de uma vez só: pagar
   * uma conta que repete e criar a ocorrência seguinte não pode ficar pela metade.
   */
  salvarContasAPagar(linhas: readonly LinhaContaAPagar[], remover: readonly string[] = []): void {
    if (linhas.length === 0 && remover.length === 0) return;
    this.banco.transaction((tx) => {
      for (const linha of linhas) {
        tx.insert(s.contasAPagar).values(linha)
          .onConflictDoUpdate({ target: s.contasAPagar.id, set: excluidas(s.contasAPagar, ['id', 'criadaEm']) })
          .run();
      }
      if (remover.length) tx.delete(s.contasAPagar).where(inArray(s.contasAPagar.id, [...remover])).run();
    });
    this.mudou();
  }

  salvarConfiguracoes(parcial: Partial<Configuracoes>): Configuracoes {
    for (const [chave, valor] of Object.entries(parcial)) {
      if (valor === undefined) continue;
      this.banco
        .insert(s.configuracoes)
        .values({ chave, valor: JSON.stringify(valor) })
        .onConflictDoUpdate({ target: s.configuracoes.chave, set: { valor: JSON.stringify(valor) } })
        .run();
    }
    this.mudou();
    return this.configuracoes();
  }
}

export class NaoEncontrado extends Error {}

type Transacao_ = Parameters<Parameters<Banco['transaction']>[0]>[0];

/** "conta|dia|valor|sentido|descrição" → partes (a descrição pode conter "|"). */
function lerImpressao(impressao: string) {
  const p = impressao.split('|');
  return { contaId: p[0] ?? '', data: p[1] ?? '', valor: Number(p[2]), sentido: p[3] ?? '', descricao: p.slice(4).join('|') };
}

function palavras(descricao: string): Set<string> {
  return new Set(chaveDeDescricao(descricao).split(' ').filter(Boolean));
}

function parecidas(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a];
  return [...menor].every((p) => maior.has(p));
}

/**
 * Edições cuja transação não existe mais (o provedor trocou o id) procuram a
 * nova dona: primeiro pela impressão exata; senão, pela transação da mesma
 * conta e sentido, até 5 dias de distância, com o mesmo valor ou a mesma
 * loja. Só muda de dono quando há exatamente um candidato — na dúvida, a
 * edição espera a próxima sincronização em vez de ir parar no lugar errado.
 */
function reatribuirAjustesOrfaos(tx: Transacao_): number {
  const orfaos = tx
    .select()
    .from(s.ajustes)
    .where(sql`not exists (select 1 from ${s.transacoes} where ${s.transacoes.id} = ${s.ajustes.transacaoId})`)
    .all();
  if (orfaos.length === 0) return 0;
  const comDono = new Set(tx.select({ id: s.ajustes.transacaoId }).from(s.ajustes).all().map((a) => a.id));
  let reatribuidos = 0;
  for (const orfao of orfaos) {
    const alvo = lerImpressao(orfao.impressao);
    if (!alvo.data) continue;
    const candidatos = tx
      .select({ id: s.transacoes.id, impressao: s.transacoes.impressao, valor: s.transacoes.valor, descricao: s.transacoes.descricao })
      .from(s.transacoes)
      .where(
        and(
          eq(s.transacoes.contaId, alvo.contaId),
          eq(s.transacoes.sentido, alvo.sentido as 'ENTRADA' | 'SAIDA'),
          gte(s.transacoes.data, somarDias(alvo.data, -5)),
          lte(s.transacoes.data, somarDias(alvo.data, 5)),
        ),
      )
      .all()
      .filter((c) => !comDono.has(c.id));
    const exatos = candidatos.filter((c) => c.impressao === orfao.impressao);
    const chave = palavras(alvo.descricao);
    const proximos = candidatos.filter((c) => c.valor === alvo.valor || parecidas(palavras(c.descricao), chave));
    const escolhido = exatos.length === 1 ? exatos[0] : exatos.length === 0 && proximos.length === 1 ? proximos[0] : undefined;
    if (!escolhido) continue;
    tx.update(s.ajustes)
      .set({ transacaoId: escolhido.id, impressao: escolhido.impressao })
      .where(eq(s.ajustes.transacaoId, orfao.transacaoId))
      .run();
    comDono.add(escolhido.id);
    reatribuidos++;
  }
  return reatribuidos;
}
