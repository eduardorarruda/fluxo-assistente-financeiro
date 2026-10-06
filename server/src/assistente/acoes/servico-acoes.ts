import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Repositorio } from '../../dados/repositorio';
import type { Regra } from '../../domain/categorizacao';
import { RELOGIO, type Relogio } from '../../relogio';
import { ContasAPagar } from '../../servicos/contas-a-pagar';
import { Financas } from '../../servicos/financas';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { desfazer } from './desfazer';
import { pareceConfirmacao, pareceDesfazer } from './guardas';
import type { ContextoOperacoes, Operacao } from './operacoes';
import { criarContaAPagar, editarContaAPagar, marcarContaPaga, removerContaAPagar } from './operacoes-contas';
import { ajustarMovimento, recategorizarMovimentos } from './operacoes-movimentos';
import { criarMeta, definirOrcamento, editarMeta, removerMeta } from './operacoes-planejamento';
import { criarRegra, removerRegra } from './operacoes-regras';
import { RepositorioDeAcoes } from './repositorio-acoes';
import {
  AcaoJaDecidida, AcaoNaoEncontrada, ErroDeAcao, paraTela, type AcaoAssistente, type AcaoGravada, type ModoAcao, type SituacaoAcao, type TipoAcao,
} from './tipos-acoes';

/** Proposta que ninguém decidiu em um dia expira: o "sim" de amanhã não deve aprovar a conversa de ontem. */
export const VALIDADE_PROPOSTA_MS = 24 * 60 * 60_000;
/** Muitas mudanças diretas numa resposta é sinal de que devia ser uma proposta (ou de texto de terceiro mandando). */
export const MAXIMO_DIRETAS_POR_RESPOSTA = 10;
export const MAXIMO_PROPOSTAS_POR_RESPOSTA = 5;

const SITUACAO_LEGIVEL: Record<SituacaoAcao, string> = {
  pendente: 'esperando a pessoa', aprovada: 'aprovada', recusada: 'recusada', expirada: 'expirada', falhou: 'falhou',
};

/** A outra aba (ou o "sim" junto com o botão) decidiu primeiro: vale o que ela fez. */
class Corrida extends Error {}

/**
 * As ações do assistente: fazer (direta), propor, aprovar, recusar e desfazer.
 * Tudo síncrono do começo ao fim de cada decisão (SQLite síncrono, sem `await`
 * no meio): conferir a situação e gravar a nova acontecem sem nada intercalar,
 * e a mudança nos dados e o registro dela entram na mesma transação.
 */
@Injectable()
export class ServicoDeAcoes {
  private readonly log = new Logger('Acoes');
  private readonly ctx: ContextoOperacoes;
  private readonly operacoes: ReadonlyMap<TipoAcao, Operacao>;

  constructor(
    private readonly repo: RepositorioDeAcoes,
    private readonly assistente: RepositorioAssistente,
    repositorio: Repositorio,
    financas: Financas,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Optional() contas?: ContasAPagar,
  ) {
    this.ctx = { repositorio, financas, leitura: repo, contas, hoje: () => relogio.hoje() };
    const lista = [
      ajustarMovimento, recategorizarMovimentos, criarRegra, removerRegra, definirOrcamento, criarMeta, editarMeta, removerMeta,
      criarContaAPagar, editarContaAPagar, marcarContaPaga, removerContaAPagar,
    ].map((f) => f(this.ctx));
    this.operacoes = new Map(lista.map((o) => [o.tipo, o]));
  }

  /** As regras de categoria, na ordem em que são testadas. */
  regras(): Regra[] {
    return this.repo.regras();
  }

  /** As contas a pagar (para a ferramenta de leitura); null quando o serviço não existe neste Fluxo. */
  contas(): ContasAPagar | null {
    return this.ctx.contas ?? null;
  }

  // ------------------------------------------------------- pelo assistente

  /** Ação simples: faz agora, grava como desfazer e devolve o registro. */
  agir(conversaId: string, tipo: TipoAcao, entrada: Record<string, unknown>): AcaoGravada {
    const op = this.operacao(tipo, 'direta');
    const payload = validar(op, entrada);
    const mensagemId = this.assistente.respostaGerando(conversaId);
    this.limitar(conversaId, mensagemId, 'direta');
    const previa = op.prever(payload);
    return this.repo.transacao(() => {
      const r = op.executar(payload);
      const acao: AcaoGravada = {
        ...this.base(conversaId, mensagemId, tipo, 'direta', payload), ...previa,
        situacao: 'aprovada', decididaEm: this.agora(), inverso: r.inverso, aviso: r.aviso ?? null,
      };
      this.repo.criar(acao);
      return acao;
    });
  }

  /**
   * Mudança grande: só descreve. Nada muda até a pessoa aprovar. A mesma proposta
   * repetida devolve a que já existe — e passa a morar na resposta atual (foi
   * mostrada de novo: é a ela que o próximo "sim" responde).
   */
  propor(conversaId: string, tipo: TipoAcao, entrada: Record<string, unknown>): { acao: AcaoGravada; repetida: boolean } {
    const op = this.operacao(tipo, 'proposta');
    const pedido = validar(op, entrada);
    const previa = op.prever(pedido);
    const payload = op.refinar ? op.refinar(pedido) : pedido;
    const mensagemId = this.assistente.respostaGerando(conversaId);
    const igual = this.listarGravadas(conversaId).find((a) =>
      a.situacao === 'pendente' && a.tipo === tipo && JSON.stringify(a.payload) === JSON.stringify(payload));
    if (igual) {
      if (!mensagemId || igual.mensagemId === mensagemId) return { acao: igual, repetida: true };
      const mostradaDeNovo: AcaoGravada = { ...igual, ...previa, mensagemId };
      return { acao: this.repo.trocar(igual, mostradaDeNovo) ? mostradaDeNovo : (this.repo.obter(igual.id) ?? igual), repetida: true };
    }
    this.limitar(conversaId, mensagemId, 'proposta');
    const acao: AcaoGravada = { ...this.base(conversaId, mensagemId, tipo, 'proposta', payload), ...previa, situacao: 'pendente', decididaEm: null, inverso: null };
    this.repo.criar(acao);
    return { acao, repetida: false };
  }

  /**
   * "Sim" dito na conversa. Só vale se: a proposta é desta conversa, está
   * pendente e foi mostrada na resposta a que a pessoa está respondendo (a
   * última resposta ANTES da mensagem dela — nunca uma antiga, nem a que está
   * sendo gerada agora), e essa mensagem (escrita por ela, nunca texto de
   * terceiros) é uma confirmação sem negação. Sem `id`: a única pendente dessa resposta.
   */
  confirmarPelaConversa(conversaId: string, id: string | undefined): AcaoGravada {
    const { pessoa, respostaAnterior } = this.ultimaDaPessoa(conversaId);
    if (id) {
      const ja = this.daConversa(conversaId, id);
      if (ja.situacao === 'aprovada') return ja;
      this.exigirPendente(ja);
    }
    const daResposta = this.listarGravadas(conversaId).filter((a) => a.situacao === 'pendente' && respostaAnterior && a.mensagemId === respostaAnterior);
    const acao = this.escolher(daResposta, id, 'proposta');
    if (!pareceConfirmacao(pessoa.texto)) {
      throw new ErroDeAcao('A última mensagem da pessoa não é uma confirmação clara. Pergunte de novo — ou ela pode tocar em Aprovar no cartão.');
    }
    return this.executar(acao);
  }

  recusarPelaConversa(conversaId: string, id: string | undefined): AcaoGravada {
    const { respostaAnterior } = this.ultimaDaPessoa(conversaId);
    const pendentes = this.listarGravadas(conversaId).filter((a) => a.situacao === 'pendente');
    // Recusar não muda dado nenhum: vale para qualquer pendente desta conversa (com id) ou a da resposta anterior.
    const acao = id ? this.daConversa(conversaId, id) : this.escolher(pendentes.filter((a) => a.mensagemId === respostaAnterior), undefined, 'proposta');
    return this.decidirRecusa(acao);
  }

  /**
   * "Desfaz" dito na conversa: só quando a última mensagem da pessoa pede isso, e
   * só o que foi feito na resposta a que ela está respondendo (ou, se ali não
   * houve nada, a última coisa feita na conversa). Ação mais antiga: pelo botão.
   */
  desfazerPelaConversa(conversaId: string, id: string | undefined): AcaoGravada {
    const { pessoa, respostaAnterior } = this.ultimaDaPessoa(conversaId);
    if (!pareceDesfazer(pessoa.texto)) {
      throw new ErroDeAcao('Só desfaço quando a pessoa pede na mensagem dela ("desfaz", "volta como estava"). Ela também pode tocar em Desfazer no cartão.');
    }
    if (id) {
      const ja = this.daConversa(conversaId, id);
      if (ja.desfeitaEm) return ja;
    }
    const feitas = this.listarGravadas(conversaId).filter((a) => a.situacao === 'aprovada' && !a.desfeitaEm && a.inverso);
    const daResposta = feitas.filter((a) => respostaAnterior && a.mensagemId === respostaAnterior);
    const candidatas = daResposta.length ? daResposta : feitas.slice(-1);
    const acao = id ? this.escolher(candidatas, id, 'acao') : candidatas.at(-1);
    if (!acao) throw new ErroDeAcao('Não há nada feito nesta conversa para desfazer.');
    return this.reverter(acao);
  }

  // --------------------------------------------------------- pela tela

  listar(conversaId: string): AcaoAssistente[] {
    return this.listarGravadas(conversaId).map(paraTela);
  }

  aprovar(id: string): AcaoAssistente {
    const acao = this.obter(id);
    if (acao.situacao === 'aprovada') return paraTela(acao);
    this.exigirPendente(acao);
    return paraTela(this.executar(acao));
  }

  recusar(id: string): AcaoAssistente {
    return paraTela(this.decidirRecusa(this.obter(id)));
  }

  desfazer(id: string): AcaoAssistente {
    return paraTela(this.reverter(this.obter(id)));
  }

  /** A conversa foi apagada: o histórico de ações dela vai junto (o que foi feito continua feito). */
  esquecerConversa(conversaId: string): void {
    this.repo.removerDaConversa(conversaId);
  }

  // ---------------------------------------------------------- internos

  private operacao(tipo: TipoAcao, modo: ModoAcao): Operacao {
    const op = this.operacoes.get(tipo);
    if (!op || op.modo !== modo) throw new ErroDeAcao(`Ação desconhecida: ${tipo}.`);
    return op;
  }

  private base(conversaId: string, mensagemId: string | null, tipo: TipoAcao, modo: ModoAcao, payload: Record<string, unknown>) {
    return {
      id: randomUUID(), conversaId, mensagemId, tipo, modo, payload, erro: null, aviso: null, criadaEm: this.agora(), desfeitaEm: null,
    };
  }

  private agora(): string {
    return this.relogio.agora().toISOString();
  }

  private limitar(conversaId: string, mensagemId: string | null, modo: ModoAcao): void {
    if (!mensagemId) return;
    const feitas = this.repo.daConversa(conversaId).filter((a) => a.mensagemId === mensagemId && a.modo === modo).length;
    if (modo === 'direta' && feitas >= MAXIMO_DIRETAS_POR_RESPOSTA) {
      throw new ErroDeAcao(`Já fiz ${MAXIMO_DIRETAS_POR_RESPOSTA} mudanças diretas nesta resposta. Para mudar muitos movimentos, use recategorizar_movimentos ou criar_regra_de_categoria (viram uma proposta para a pessoa aprovar).`);
    }
    if (modo === 'proposta' && feitas >= MAXIMO_PROPOSTAS_POR_RESPOSTA) {
      throw new ErroDeAcao(`Já há ${MAXIMO_PROPOSTAS_POR_RESPOSTA} propostas nesta resposta: espere a pessoa decidir antes de propor mais.`);
    }
  }

  private obter(id: string): AcaoGravada {
    const acao = this.repo.obter(id);
    if (!acao) throw new AcaoNaoEncontrada('Ação não encontrada.');
    return this.expirarSePreciso(acao);
  }

  private daConversa(conversaId: string, id: string): AcaoGravada {
    const acao = this.repo.obter(id);
    if (!acao || acao.conversaId !== conversaId) throw new ErroDeAcao('Não achei essa proposta/ação nesta conversa. Veja a ferramenta acoes_da_conversa.');
    return this.expirarSePreciso(acao);
  }

  private listarGravadas(conversaId: string): AcaoGravada[] {
    return this.repo.daConversa(conversaId).map((a) => this.expirarSePreciso(a));
  }

  /** Pendente velha demais, ou cuja resposta foi apagada (refeita), não vale mais. */
  private expirarSePreciso(acao: AcaoGravada): AcaoGravada {
    if (acao.situacao !== 'pendente') return acao;
    const velha = this.relogio.agora().getTime() - Date.parse(acao.criadaEm) > VALIDADE_PROPOSTA_MS;
    const semResposta = acao.mensagemId !== null && !this.assistente.conversaDaMensagem(acao.mensagemId);
    if (!velha && !semResposta) return acao;
    const expirada: AcaoGravada = { ...acao, situacao: 'expirada', decididaEm: this.agora() };
    return this.repo.trocar(acao, expirada) ? expirada : (this.repo.obter(acao.id) ?? expirada);
  }

  private exigirPendente(acao: AcaoGravada): void {
    if (acao.situacao === 'pendente') return;
    const extra = acao.situacao === 'expirada' ? ' Peça para o assistente propor de novo.' : '';
    throw new AcaoJaDecidida(`Essa proposta está ${SITUACAO_LEGIVEL[acao.situacao]}.${extra}`);
  }

  /** A última mensagem da pessoa e a resposta do assistente logo antes dela (a que ela viu e está respondendo). */
  private ultimaDaPessoa(conversaId: string) {
    const mensagens = this.assistente.mensagens(conversaId);
    const indice = mensagens.findLastIndex((m) => m.papel === 'usuario');
    if (indice === -1) throw new ErroDeAcao('A pessoa ainda não disse nada nesta conversa.');
    const respostaAnterior = mensagens.slice(0, indice).findLast((m) => m.papel === 'assistente')?.id ?? null;
    return { pessoa: mensagens[indice]!, respostaAnterior };
  }

  /** Entre as candidatas (as da resposta que a pessoa viu): a do `id`, ou a única. */
  private escolher(candidatas: readonly AcaoGravada[], id: string | undefined, oQue: 'proposta' | 'acao'): AcaoGravada {
    if (id) {
      const achada = candidatas.find((a) => a.id === id);
      if (achada) return achada;
      throw new ErroDeAcao(oQue === 'proposta'
        ? 'Essa proposta não está na resposta que a pessoa acabou de ver. Proponha de novo (a mesma proposta volta para esta resposta) e espere ela confirmar — ou ela toca em Aprovar no cartão.'
        : 'Só desfaço pela conversa o que foi feito na última resposta. Para algo mais antigo, a pessoa toca em Desfazer no cartão.');
    }
    if (candidatas.length === 1) return candidatas[0]!;
    if (!candidatas.length) {
      throw new ErroDeAcao('Não há proposta esperando aprovação na resposta que a pessoa viu. Proponha e espere a resposta dela (ou ela toca em Aprovar no cartão).');
    }
    throw new ErroDeAcao(`Há ${candidatas.length} propostas esperando: diga qual (propostaId). ${candidatas.map((a) => `${a.id}: ${a.descricao}`).join(' | ')}`);
  }

  private executar(acao: AcaoGravada): AcaoGravada {
    const op = this.operacoes.get(acao.tipo);
    try {
      if (!op) throw new ErroDeAcao(`Ação desconhecida: ${acao.tipo}.`);
      return this.repo.transacao(() => {
        const r = op.executar(validar(op, acao.payload));
        const feita: AcaoGravada = { ...acao, situacao: 'aprovada', decididaEm: this.agora(), inverso: r.inverso, aviso: r.aviso ?? null, erro: null };
        if (!this.repo.trocar(acao, feita)) throw new Corrida();
        return feita;
      });
    } catch (e) {
      if (e instanceof Corrida) return this.repo.obter(acao.id) ?? acao;
      const mensagem = e instanceof ErroDeAcao ? e.message : 'Algo deu errado aqui dentro ao fazer a mudança. O detalhe ficou no log do Fluxo.';
      if (!(e instanceof ErroDeAcao)) this.log.error(`Ação ${acao.tipo} ${acao.id} falhou: ${(e as Error).stack ?? String(e)}`);
      const falhou: AcaoGravada = { ...acao, situacao: 'falhou', decididaEm: this.agora(), erro: mensagem };
      return this.repo.trocar(acao, falhou) ? falhou : (this.repo.obter(acao.id) ?? falhou);
    }
  }

  private decidirRecusa(acao: AcaoGravada): AcaoGravada {
    if (acao.situacao === 'recusada') return acao;
    if (acao.situacao === 'aprovada') throw new AcaoJaDecidida('Essa proposta já foi aprovada. Para voltar atrás, use Desfazer.');
    this.exigirPendente(acao);
    const recusada: AcaoGravada = { ...acao, situacao: 'recusada', decididaEm: this.agora() };
    return this.repo.trocar(acao, recusada) ? recusada : (this.repo.obter(acao.id) ?? recusada);
  }

  private reverter(acao: AcaoGravada): AcaoGravada {
    if (acao.desfeitaEm) return acao;
    if (acao.situacao !== 'aprovada' || !acao.inverso) throw new AcaoJaDecidida('Só dá para desfazer o que já foi feito.');
    const inverso = acao.inverso;
    try {
      return this.repo.transacao(() => {
        const aviso = desfazer(this.ctx, inverso);
        const desfeita: AcaoGravada = { ...acao, desfeitaEm: this.agora(), aviso };
        if (!this.repo.trocar(acao, desfeita)) throw new Corrida();
        return desfeita;
      });
    } catch (e) {
      if (e instanceof Corrida) return this.repo.obter(acao.id) ?? acao;
      throw e;
    }
  }
}

/** O payload gravado (ou vindo do modelo) passa pelo esquema da operação; erro vira mensagem legível. */
function validar(op: Operacao, entrada: unknown): Record<string, unknown> {
  try {
    return op.payload.parse(entrada);
  } catch (e) {
    if (e instanceof ZodError) {
      throw new ErroDeAcao(`Dados inválidos — ${e.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
    }
    throw e;
  }
}
