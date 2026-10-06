import { Inject, Injectable } from '@nestjs/common';
import { and, eq, like, sql } from 'drizzle-orm';
import { BANCO } from '../../db/banco.module';
import type { Banco } from '../../db/conexao';
import * as s from '../../db/schema';
import { linhaParaAjuste, linhaParaRegra } from '../../dados/mapeamento';
import type { Regra } from '../../domain/categorizacao';
import type { Meta } from '../../domain/metas';
import type { Ajuste } from '../../domain/movimentos';
import type { AcaoGravada } from './tipos-acoes';

/**
 * Onde as ações (propostas e o histórico para desfazer) ficam: na tabela
 * chave-valor `configuracoes`, uma linha por ação (`assistente:acao:<id>`, o
 * JSON da `AcaoGravada`). Sem tabela nova de propósito: é pouca coisa (uma
 * pessoa, algumas ações por conversa), mora no MESMO banco dos dados — então a
 * ação e o registro dela entram na mesma transação —, e `Repositorio.configuracoes()`
 * só lê as chaves que conhece, então estas linhas não atrapalham nada.
 *
 * Aqui também ficam as leituras pontuais do estado da pessoa (um ajuste, uma
 * regra, um limite, uma meta) que a ação precisa para guardar o "antes" e
 * conferir o "depois" — sem montar o instantâneo inteiro do banco.
 */

const PREFIXO = 'assistente:acao:';

@Injectable()
export class RepositorioDeAcoes {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  /** Roda tudo numa transação do SQLite (as escritas do `Repositorio` usam a mesma conexão). */
  transacao<T>(f: () => T): T {
    return this.banco.transaction(() => f());
  }

  obter(id: string): AcaoGravada | undefined {
    const linha = this.banco.select().from(s.configuracoes).where(eq(s.configuracoes.chave, PREFIXO + id)).get();
    return linha ? ler(linha.valor) : undefined;
  }

  /** Na ordem em que foram criadas (o rowid da linha: atualizar não muda). */
  daConversa(conversaId: string): AcaoGravada[] {
    return this.banco.select().from(s.configuracoes)
      .where(and(like(s.configuracoes.chave, `${PREFIXO}%`), sql`json_extract(${s.configuracoes.valor}, '$.conversaId') = ${conversaId}`))
      .orderBy(sql`rowid`)
      .all()
      .map((l) => ler(l.valor))
      .filter((a): a is AcaoGravada => a !== undefined);
  }

  criar(a: AcaoGravada): void {
    this.banco.insert(s.configuracoes).values({ chave: PREFIXO + a.id, valor: JSON.stringify(a) }).run();
  }

  /**
   * Troca a ação só se ela ainda está como `esperada` (o mesmo JSON): dois
   * cliques, duas abas ou o "sim" junto com o botão não fazem a ação duas vezes.
   */
  trocar(esperada: AcaoGravada, nova: AcaoGravada): boolean {
    return this.banco.update(s.configuracoes).set({ valor: JSON.stringify(nova) })
      .where(and(eq(s.configuracoes.chave, PREFIXO + esperada.id), eq(s.configuracoes.valor, JSON.stringify(esperada))))
      .run().changes === 1;
  }

  removerDaConversa(conversaId: string): void {
    this.banco.delete(s.configuracoes)
      .where(and(like(s.configuracoes.chave, `${PREFIXO}%`), sql`json_extract(${s.configuracoes.valor}, '$.conversaId') = ${conversaId}`))
      .run();
  }

  // ------------------------------------------------- estado atual da pessoa

  ajuste(transacaoId: string): Ajuste | null {
    const l = this.banco.select().from(s.ajustes).where(eq(s.ajustes.transacaoId, transacaoId)).get();
    return l ? linhaParaAjuste(l) : null;
  }

  regra(id: string): Regra | undefined {
    const l = this.banco.select().from(s.regras).where(eq(s.regras.id, id)).get();
    return l ? linhaParaRegra(l) : undefined;
  }

  regras(): Regra[] {
    return this.banco.select().from(s.regras).all().map(linhaParaRegra).sort((a, b) => a.prioridade - b.prioridade);
  }

  limite(categoriaId: string): number | null {
    return this.banco.select({ limite: s.orcamentos.limite }).from(s.orcamentos).where(eq(s.orcamentos.categoriaId, categoriaId)).get()?.limite ?? null;
  }

  meta(id: string): Meta | undefined {
    const l = this.banco.select().from(s.metas).where(eq(s.metas.id, id)).get();
    if (!l) return undefined;
    const { criadaEm: _c, ...meta } = l;
    return meta;
  }

  metas(): Meta[] {
    return this.banco.select().from(s.metas).all().map(({ criadaEm: _c, ...m }) => m);
  }
}

function ler(valor: string): AcaoGravada | undefined {
  try {
    const a = JSON.parse(valor) as AcaoGravada;
    return a && typeof a.id === 'string' && typeof a.conversaId === 'string' ? a : undefined;
  } catch {
    return undefined;
  }
}
