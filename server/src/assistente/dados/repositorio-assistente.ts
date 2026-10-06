import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BANCO } from '../../db/banco.module';
import type { Banco } from '../../db/conexao';
import * as s from '../../db/schema';
import { RELOGIO, type Relogio } from '../../relogio';
import { PROVEDORES, type ProvedorIA, type Uso } from '../cli/tipos';
import {
  TIPOS_CONTA, type Anexo, type ConfigAssistenteSalva, type ContaSalva, type Mensagem, type OrigemAnexo, type PassoFerramenta, type SituacaoAnexo,
  type SituacaoMensagem, type TipoAnexo,
} from '../tipos-api';

type LinhaConversa = typeof s.conversas.$inferSelect;
type LinhaMensagem = typeof s.mensagens.$inferSelect;
type LinhaAnexo = typeof s.anexos.$inferSelect;

export interface ConversaGravada extends LinhaConversa {
  previa: string;
}

export interface NovaMensagem {
  id: string;
  conversaId: string;
  papel: 'usuario' | 'assistente';
  texto: string;
  situacao: SituacaoMensagem;
  contaId?: string | null;
  provedor: ProvedorIA | null;
  modelo: string | null;
}

export interface NovoAnexo {
  id: string;
  conversaId: string;
  nome: string;
  mime: string;
  tipo: TipoAnexo;
  tamanho: number;
  arquivo: string;
  sha256: string;
  origem?: OrigemAnexo;
  /** Só a imagem gerada nasce presa à resposta que a criou; o que a pessoa anexa nasce solto. */
  mensagemId?: string | null;
}

const CHAVE_CONFIG = 'assistente';
const TAMANHO_PREVIA = 140;

const NOMES_PADRAO: Record<ProvedorIA, string> = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex CLI' };

/** Conta gravada antes das contas por API não tem `tipo`: é de CLI. */
const esquemaConta = z.object({
  id: z.string().min(1).max(100),
  provedor: z.enum(PROVEDORES),
  nome: z.string().min(1).max(60),
  ativo: z.boolean().catch(true),
  tipo: z.enum(TIPOS_CONTA).catch('cli'),
  caminho: z.string().nullable().catch(null),
  modelo: z.string().nullable().catch(null),
  pastaLogin: z.string().nullable().catch(null),
}).transform((c): ContaSalva => (c.tipo === 'api' ? { ...c, caminho: null, pastaLogin: null } : c));

const esquemaConfig = z.object({
  contaPadrao: z.string().nullable().catch(null),
  contas: z.array(esquemaConta.nullable().catch(null)).transform((l) => l.filter((c): c is ContaSalva => c !== null)),
});

/** O formato antigo (um CLI de cada): vira uma conta padrão por CLI, com o mesmo id. */
const esquemaConfigV1 = z.object({
  provedorPadrao: z.enum(PROVEDORES).nullable().catch(null),
  clis: z.record(z.string(), z.object({ ativo: z.boolean().catch(true), caminho: z.string().nullable().catch(null), modelo: z.string().nullable().catch(null) }).partial()),
});

export function contaPadraoDe(provedor: ProvedorIA): ContaSalva {
  return { id: provedor, provedor, nome: NOMES_PADRAO[provedor], ativo: true, tipo: 'cli', caminho: null, modelo: null, pastaLogin: null };
}

function configPadrao(): ConfigAssistenteSalva {
  return { contaPadrao: null, contas: PROVEDORES.map(contaPadraoDe) };
}

function lerConfigBruta(bruto: unknown): ConfigAssistenteSalva {
  const v2 = esquemaConfig.safeParse(bruto);
  if (v2.success && v2.data.contas.length) return v2.data;
  const v1 = esquemaConfigV1.safeParse(bruto);
  if (!v1.success) return configPadrao();
  return {
    contaPadrao: v1.data.provedorPadrao,
    contas: PROVEDORES.map((p) => ({ ...contaPadraoDe(p), ...v1.data.clis[p] })),
  };
}

/** Escapa % e _ para o LIKE (com ESCAPE '\'). */
function padraoLike(busca: string): string {
  return `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function lerJson<T>(valor: string | null, padrao: T): T {
  if (!valor) return padrao;
  try {
    return JSON.parse(valor) as T;
  } catch {
    return padrao;
  }
}

/**
 * Persistência do assistente: conversas, mensagens, anexos, as sessões dos
 * CLIs e a configuração. Nada aqui é tocado pela sincronização com o banco.
 */
@Injectable()
export class RepositorioAssistente {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  private agora(): string {
    return this.relogio.agora().toISOString();
  }

  // ------------------------------------------------------------- conversas

  listarConversas(busca?: string): ConversaGravada[] {
    // Coluna qualificada à mão: dentro da subconsulta o drizzle escreveria só "id", que o SQLite
    // resolveria como mensagens.id.
    const idConversa = sql.raw('"conversas"."id"');
    const previa = sql<string | null>`(select substr(m.texto, 1, ${TAMANHO_PREVIA}) from mensagens m
      where m.conversa_id = ${idConversa} order by m.ordem desc limit 1)`;
    const termo = busca?.trim();
    const filtro = termo
      ? sql`(${s.conversas.titulo} like ${padraoLike(termo)} escape '\\' or exists (select 1 from mensagens m
          where m.conversa_id = ${idConversa} and m.texto like ${padraoLike(termo)} escape '\\'))`
      : undefined;
    return this.banco
      .select({ conversa: s.conversas, previa })
      .from(s.conversas)
      .where(filtro)
      .orderBy(desc(s.conversas.fixada), desc(s.conversas.atualizadaEm), desc(s.conversas.criadaEm))
      .all()
      .map(({ conversa, previa: p }) => ({ ...conversa, previa: p ?? '' }));
  }

  conversa(id: string): ConversaGravada | undefined {
    const linha = this.banco.select().from(s.conversas).where(eq(s.conversas.id, id)).get();
    if (!linha) return undefined;
    const ultima = this.banco.select({ texto: s.mensagens.texto }).from(s.mensagens)
      .where(eq(s.mensagens.conversaId, id)).orderBy(desc(s.mensagens.ordem)).limit(1).get();
    return { ...linha, previa: ultima?.texto.slice(0, TAMANHO_PREVIA) ?? '' };
  }

  criarConversa(c: { id: string; titulo: string; provedor: ProvedorIA; contaId?: string | null; modelo: string | null }): ConversaGravada {
    const agora = this.agora();
    this.banco.insert(s.conversas).values({ ...c, fixada: false, criadaEm: agora, atualizadaEm: agora }).run();
    return this.conversa(c.id)!;
  }

  atualizarConversa(
    id: string,
    parcial: Partial<{ titulo: string; fixada: boolean; provedor: ProvedorIA; contaId: string | null; modelo: string | null }>,
  ): ConversaGravada | undefined {
    if (Object.keys(parcial).length) this.banco.update(s.conversas).set(parcial).where(eq(s.conversas.id, id)).run();
    return this.conversa(id);
  }

  /** Mensagens, anexos e sessões vão junto (ON DELETE CASCADE). */
  removerConversa(id: string): void {
    this.banco.delete(s.conversas).where(eq(s.conversas.id, id)).run();
  }

  private tocar(conversaId: string): void {
    this.banco.update(s.conversas).set({ atualizadaEm: this.agora() }).where(eq(s.conversas.id, conversaId)).run();
  }

  // ------------------------------------------------------------- mensagens

  mensagens(conversaId: string): Mensagem[] {
    const linhas = this.banco.select().from(s.mensagens).where(eq(s.mensagens.conversaId, conversaId)).orderBy(asc(s.mensagens.ordem)).all();
    const anexos = this.banco.select().from(s.anexos).where(eq(s.anexos.conversaId, conversaId)).orderBy(asc(s.anexos.criadoEm)).all();
    const nomes = this.nomesDasContas();
    return linhas.map((l) => paraMensagem(l, anexos.filter((a) => a.mensagemId === l.id), nomes));
  }

  mensagem(id: string): Mensagem | undefined {
    const linha = this.banco.select().from(s.mensagens).where(eq(s.mensagens.id, id)).get();
    if (!linha) return undefined;
    const anexos = this.banco.select().from(s.anexos).where(eq(s.anexos.mensagemId, id)).orderBy(asc(s.anexos.criadoEm)).all();
    return paraMensagem(linha, anexos, this.nomesDasContas());
  }

  /** A resposta do assistente sendo gerada agora nesta conversa (onde a imagem gerada fica presa). */
  respostaGerando(conversaId: string): string | null {
    return this.banco.select({ id: s.mensagens.id }).from(s.mensagens)
      .where(and(eq(s.mensagens.conversaId, conversaId), eq(s.mensagens.papel, 'assistente'), eq(s.mensagens.situacao, 'gerando')))
      .orderBy(desc(s.mensagens.ordem)).limit(1).get()?.id ?? null;
  }

  /** Conversa da mensagem — para validar que uma ação veio da conversa certa. */
  conversaDaMensagem(id: string): string | undefined {
    return this.banco.select({ c: s.mensagens.conversaId }).from(s.mensagens).where(eq(s.mensagens.id, id)).get()?.c;
  }

  adicionarMensagem(m: NovaMensagem): Mensagem {
    this.banco.transaction((tx) => {
      const { ultima } = tx.select({ ultima: sql<number>`coalesce(max(${s.mensagens.ordem}), 0)` })
        .from(s.mensagens).where(eq(s.mensagens.conversaId, m.conversaId)).get()!;
      tx.insert(s.mensagens).values({ ...m, ordem: ultima + 1, passos: '[]', criadaEm: this.agora() }).run();
    });
    this.tocar(m.conversaId);
    return this.mensagem(m.id)!;
  }

  atualizarMensagem(
    id: string,
    parcial: Partial<{ texto: string; passos: PassoFerramenta[]; situacao: SituacaoMensagem; erro: string | null; uso: Uso | null; modelo: string | null }>,
  ): void {
    const { passos, uso, ...resto } = parcial;
    const valores = {
      ...resto,
      ...(passos !== undefined ? { passos: JSON.stringify(passos) } : {}),
      ...(uso !== undefined ? { uso: uso ? JSON.stringify(uso) : null } : {}),
    };
    if (Object.keys(valores).length) this.banco.update(s.mensagens).set(valores).where(eq(s.mensagens.id, id)).run();
  }

  removerMensagem(id: string): void {
    this.banco.delete(s.mensagens).where(eq(s.mensagens.id, id)).run();
  }

  /** Na subida: resposta que estava sendo gerada quando o Fluxo fechou não vai terminar mais. */
  interromperPendentes(): number {
    return this.banco.update(s.mensagens)
      .set({ situacao: 'interrompida', erro: 'O Fluxo foi fechado enquanto a resposta era gerada.' })
      .where(eq(s.mensagens.situacao, 'gerando')).run().changes;
  }

  // ---------------------------------------------------------------- anexos

  criarAnexo(a: NovoAnexo): Anexo {
    this.banco.insert(s.anexos)
      .values({ ...a, mensagemId: a.mensagemId ?? null, origem: a.origem ?? 'pessoa', situacao: 'pendente', erro: null, criadoEm: this.agora() }).run();
    return this.anexo(a.id)!;
  }

  anexo(id: string): (Anexo & { conversaId: string; mensagemId: string | null; arquivo: string }) | undefined {
    const linha = this.banco.select().from(s.anexos).where(eq(s.anexos.id, id)).get();
    return linha ? { ...paraAnexo(linha), conversaId: linha.conversaId, mensagemId: linha.mensagemId, arquivo: linha.arquivo } : undefined;
  }

  anexosDaConversa(conversaId: string): (Anexo & { arquivo: string; mensagemId: string | null })[] {
    return this.banco.select().from(s.anexos).where(eq(s.anexos.conversaId, conversaId)).orderBy(asc(s.anexos.criadoEm)).all()
      .map((l) => ({ ...paraAnexo(l), arquivo: l.arquivo, mensagemId: l.mensagemId }));
  }

  /** Anexos que estão na caixa de texto, ainda não enviados. */
  anexosSoltos(conversaId: string): Anexo[] {
    return this.banco.select().from(s.anexos)
      .where(and(eq(s.anexos.conversaId, conversaId), isNull(s.anexos.mensagemId)))
      .orderBy(asc(s.anexos.criadoEm)).all().map(paraAnexo);
  }

  /** Prende os anexos à mensagem enviada. Só os soltos da própria conversa; devolve os que foram presos. */
  vincularAnexos(conversaId: string, ids: readonly string[], mensagemId: string): string[] {
    if (!ids.length) return [];
    const validos = this.banco.select({ id: s.anexos.id }).from(s.anexos)
      .where(and(eq(s.anexos.conversaId, conversaId), isNull(s.anexos.mensagemId), inArray(s.anexos.id, [...ids]))).all()
      .map((l) => l.id);
    if (validos.length) this.banco.update(s.anexos).set({ mensagemId }).where(inArray(s.anexos.id, validos)).run();
    return validos;
  }

  atualizarAnexo(id: string, parcial: { situacao: SituacaoAnexo; erro?: string | null }): void {
    this.banco.update(s.anexos).set({ situacao: parcial.situacao, erro: parcial.erro ?? null }).where(eq(s.anexos.id, id)).run();
  }

  removerAnexo(id: string): void {
    this.banco.delete(s.anexos).where(eq(s.anexos.id, id)).run();
  }

  // ---------------------------------------------------------------- sessões

  sessao(conversaId: string, contaId: string): string | null {
    return this.banco.select({ id: s.sessoesCli.sessaoId }).from(s.sessoesCli)
      .where(and(eq(s.sessoesCli.conversaId, conversaId), eq(s.sessoesCli.contaId, contaId))).get()?.id ?? null;
  }

  salvarSessao(conversaId: string, conta: { id: string; provedor: ProvedorIA }, sessaoId: string): void {
    const atualizadaEm = this.agora();
    this.banco.insert(s.sessoesCli).values({ conversaId, contaId: conta.id, provedor: conta.provedor, sessaoId, atualizadaEm })
      .onConflictDoUpdate({ target: [s.sessoesCli.conversaId, s.sessoesCli.contaId], set: { sessaoId, atualizadaEm } }).run();
  }

  esquecerSessao(conversaId: string, contaId: string): void {
    this.banco.delete(s.sessoesCli).where(and(eq(s.sessoesCli.conversaId, conversaId), eq(s.sessoesCli.contaId, contaId))).run();
  }

  // ----------------------------------------------------------- configuração

  lerConfig(): ConfigAssistenteSalva {
    const linha = this.banco.select().from(s.configuracoes).where(eq(s.configuracoes.chave, CHAVE_CONFIG)).get();
    return lerConfigBruta(lerJson<unknown>(linha?.valor ?? null, null));
  }

  /** A conta gravada, ou a padrão do provedor se ela não existe mais (conversa antiga, conta removida). */
  conta(id: string | null, provedor: ProvedorIA): ContaSalva {
    const contas = this.lerConfig().contas;
    return contas.find((c) => c.id === id) ?? contas.find((c) => c.provedor === provedor) ?? contas[0] ?? contaPadraoDe(provedor);
  }

  /** Conversas de uma conta removida passam para outra. */
  reatribuirConversas(deContaId: string, para: ContaSalva): void {
    this.banco.update(s.conversas).set({ contaId: para.id, provedor: para.provedor }).where(eq(s.conversas.contaId, deContaId)).run();
  }

  private nomesDasContas(): Map<string, string> {
    return new Map(this.lerConfig().contas.map((c) => [c.id, c.nome]));
  }

  salvarConfig(config: ConfigAssistenteSalva): void {
    const valor = JSON.stringify(config);
    this.banco.insert(s.configuracoes).values({ chave: CHAVE_CONFIG, valor })
      .onConflictDoUpdate({ target: s.configuracoes.chave, set: { valor } }).run();
  }
}

function paraAnexo(l: LinhaAnexo): Anexo {
  return {
    id: l.id, nome: l.nome, mime: l.mime, tamanho: l.tamanho, tipo: l.tipo, situacao: l.situacao, erro: l.erro, origem: l.origem, criadoEm: l.criadoEm,
  };
}

function paraMensagem(l: LinhaMensagem, anexos: LinhaAnexo[], nomes: ReadonlyMap<string, string>): Mensagem {
  return {
    id: l.id,
    papel: l.papel,
    texto: l.texto,
    passos: lerJson<PassoFerramenta[]>(l.passos, []),
    anexos: anexos.map(paraAnexo),
    situacao: l.situacao,
    erro: l.erro,
    contaId: l.contaId,
    contaNome: l.contaId ? (nomes.get(l.contaId) ?? null) : null,
    provedor: l.provedor,
    modelo: l.modelo,
    uso: lerJson<Uso | null>(l.uso, null),
    criadaEm: l.criadaEm,
  };
}
