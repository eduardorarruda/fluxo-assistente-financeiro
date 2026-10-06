import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ServicoDeAcoes } from './acoes/servico-acoes';
import { Anexos } from './anexos/anexos';
import { ServicoDeContas } from './contas';
import { RepositorioAssistente, type ConversaGravada } from './dados/repositorio-assistente';
import { Execucoes } from './execucao/execucoes';
import { Indexador, type EstadoRag } from './rag/indexador';
import type { ContaSalva, Conversa, Mensagem, ResumoConversa } from './tipos-api';

export interface NovaMensagemDaPessoa {
  texto: string;
  anexos: string[];
  contaId?: string;
  modelo?: string | null;
  /** Veio do modo conversação: a resposta vai ser lida em voz alta. */
  voz?: boolean;
}

export interface EscolhaDeConta {
  contaId?: string;
  /** null = o modelo padrão da conta. */
  modelo?: string | null;
}

const TITULO_PADRAO = 'Nova conversa';
const TAMANHO_TITULO = 60;

/**
 * Os casos de uso do assistente: conversas e o envio de mensagens (que vira
 * uma execução). A configuração das contas fica em `ServicoDeContas`.
 */
@Injectable()
export class ServicoAssistente {
  constructor(
    private readonly repo: RepositorioAssistente,
    private readonly execucoes: Execucoes,
    private readonly anexos: Anexos,
    private readonly indexador: Indexador,
    private readonly contas: ServicoDeContas,
    @Optional() private readonly acoes?: ServicoDeAcoes,
  ) {}

  ativarRag(): EstadoRag {
    void this.indexador.ativar();
    return this.indexador.estado();
  }

  reindexarRag(): EstadoRag {
    void this.indexador.reindexar();
    return this.indexador.estado();
  }

  // -------------------------------------------------------------- conversas

  listar(busca?: string): ResumoConversa[] {
    const contas = this.repo.lerConfig().contas;
    return this.repo.listarConversas(busca).map((c) => this.resumo(c, contas));
  }

  async criar(p: EscolhaDeConta): Promise<ResumoConversa> {
    const conta = p.contaId ? this.contas.existe(p.contaId) : ((await this.contas.padrao()) ?? this.repo.lerConfig().contas[0]!);
    return this.resumo(this.repo.criarConversa({ id: randomUUID(), titulo: TITULO_PADRAO, provedor: conta.provedor, contaId: conta.id, modelo: p.modelo ?? null }));
  }

  obter(id: string): Conversa {
    const c = this.conversaOu404(id);
    return { ...this.resumo(c), mensagens: this.repo.mensagens(id), execucaoAtiva: this.execucoes.ativa(id) };
  }

  atualizar(id: string, parcial: { titulo?: string; fixada?: boolean } & EscolhaDeConta): ResumoConversa {
    this.conversaOu404(id);
    const { contaId, ...resto } = parcial;
    const conta = contaId ? this.contas.existe(contaId) : null;
    return this.resumo(this.repo.atualizarConversa(id, { ...resto, ...(conta ? { contaId: conta.id, provedor: conta.provedor } : {}) })!);
  }

  remover(id: string): void {
    this.conversaOu404(id);
    const ativa = this.execucoes.ativa(id);
    if (ativa) this.execucoes.cancelar(ativa);
    this.anexos.removerDaConversa(id);
    // O histórico de ações (propostas e "desfazer") é da conversa; o que foi feito continua feito.
    this.acoes?.esquecerConversa(id);
    this.repo.removerConversa(id);
  }

  receberAnexo(conversaId: string, nome: string, bytes: Buffer) {
    this.conversaOu404(conversaId);
    return this.anexos.receber(conversaId, nome, bytes);
  }

  // -------------------------------------------------------------- mensagens

  async enviar(conversaId: string, m: NovaMensagemDaPessoa): Promise<{ execucaoId: string; usuario: Mensagem; assistente: Mensagem }> {
    const conversa = this.conversaOu404(conversaId);
    if (!m.texto.trim() && !m.anexos.length) throw new BadRequestException('Escreva uma mensagem ou anexe um arquivo.');
    const conta = m.contaId ? this.contas.existe(m.contaId) : this.repo.conta(conversa.contaId, conversa.provedor);
    const liberar = this.execucoes.reservar(conversaId);
    try {
      return await this.gravarEResponder(conversaId, conversa, conta, m);
    } catch (e) {
      liberar();
      throw e;
    }
  }

  private async gravarEResponder(conversaId: string, conversa: ConversaGravada, conta: ContaSalva, m: NovaMensagemDaPessoa) {
    const modelo = m.modelo !== undefined ? m.modelo : conversa.modelo;
    const historico = this.historico(conversaId);
    this.repo.atualizarConversa(conversaId, {
      contaId: conta.id, provedor: conta.provedor, modelo,
      ...(conversa.titulo === TITULO_PADRAO && !historico.length ? { titulo: tituloDe(m.texto, m.anexos, this.repo, conversaId) } : {}),
    });
    const usuario = this.repo.adicionarMensagem({ id: randomUUID(), conversaId, papel: 'usuario', texto: m.texto.trim(), situacao: 'ok', provedor: null, modelo: null });
    const vinculados = this.repo.vincularAnexos(conversaId, m.anexos, usuario.id);
    await this.anexos.aguardarIndexacao(vinculados);
    const { execucaoId, assistente } = this.responder(conversaId, conta, modelo, usuario.id, historico, m.voz ?? false);
    return { execucaoId, usuario: this.repo.mensagem(usuario.id)!, assistente };
  }

  /** Refaz a última resposta: apaga a antiga e pergunta de novo. */
  repetir(mensagemId: string): { execucaoId: string; assistente: Mensagem } {
    const conversaId = this.repo.conversaDaMensagem(mensagemId);
    if (!conversaId) throw new NotFoundException('Mensagem não encontrada.');
    const mensagens = this.repo.mensagens(conversaId);
    const indice = mensagens.findIndex((x) => x.id === mensagemId);
    const alvo = mensagens[indice];
    const pergunta = mensagens.slice(0, indice).reverse().find((x) => x.papel === 'usuario');
    if (alvo?.papel !== 'assistente' || indice !== mensagens.length - 1 || !pergunta) {
      throw new BadRequestException('Só dá para refazer a última resposta.');
    }
    const conversa = this.conversaOu404(conversaId);
    const liberar = this.execucoes.reservar(conversaId);
    try {
      this.repo.removerMensagem(mensagemId);
      const historico = paraHistorico(mensagens.slice(0, mensagens.indexOf(pergunta)));
      return this.responder(conversaId, this.repo.conta(conversa.contaId, conversa.provedor), conversa.modelo, pergunta.id, historico);
    } catch (e) {
      liberar();
      throw e;
    }
  }

  cancelar(execucaoId: string): void {
    if (!this.execucoes.cancelar(execucaoId)) throw new NotFoundException('Essa resposta já terminou.');
  }

  /** `modelo` é a escolha da conversa; sem ela, vale o modelo padrão da conta. */
  private responder(conversaId: string, conta: ContaSalva, modeloDaConversa: string | null, perguntaId: string, historico: { papel: 'usuario' | 'assistente'; texto: string }[], voz = false) {
    const pergunta = this.repo.mensagem(perguntaId)!;
    const provedor = conta.provedor;
    const modelo = modeloDaConversa ?? conta.modelo;
    const assistente = this.repo.adicionarMensagem({
      id: randomUUID(), conversaId, papel: 'assistente', texto: '', situacao: 'gerando', contaId: conta.id, provedor, modelo,
    });
    const anexos = pergunta.anexos.map((a) => {
      const gravado = this.repo.anexo(a.id)!;
      return { id: a.id, nome: a.nome, tipo: a.tipo, situacao: gravado.situacao, caminho: this.anexos.caminho(conversaId, gravado.arquivo) };
    });
    try {
      const execucaoId = this.execucoes.iniciar({ conversaId, mensagemId: assistente.id, contaId: conta.id, provedor, modelo, texto: pergunta.texto, anexos, historico, voz });
      return { execucaoId, assistente };
    } catch (e) {
      // Não deixa a resposta "gerando" para sempre.
      this.repo.atualizarMensagem(assistente.id, { situacao: 'erro', erro: (e as Error).message });
      throw e;
    }
  }

  private historico(conversaId: string) {
    return paraHistorico(this.repo.mensagens(conversaId));
  }

  private conversaOu404(id: string): ConversaGravada {
    const c = this.repo.conversa(id);
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    return c;
  }

  private resumo(c: ConversaGravada, contas: readonly ContaSalva[] = this.repo.lerConfig().contas): ResumoConversa {
    const conta = contas.find((x) => x.id === c.contaId) ?? contas.find((x) => x.provedor === c.provedor) ?? null;
    return {
      id: c.id, titulo: c.titulo, contaId: conta?.id ?? c.contaId ?? c.provedor, contaNome: conta?.nome ?? null, provedor: conta?.provedor ?? c.provedor,
      modelo: c.modelo, fixada: c.fixada, gerando: Boolean(this.execucoes.ativa(c.id)),
      previa: c.previa, criadaEm: c.criadaEm, atualizadaEm: c.atualizadaEm,
    };
  }
}

function paraHistorico(mensagens: readonly Mensagem[]) {
  return mensagens.filter((x) => x.texto.trim() && x.situacao !== 'gerando').map((x) => ({ papel: x.papel, texto: x.texto }));
}

/** Título da conversa: a primeira linha da primeira mensagem, cortada numa palavra. */
function tituloDe(texto: string, anexos: readonly string[], repo: RepositorioAssistente, conversaId: string): string {
  const linha = texto.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? '';
  if (!linha) {
    const nome = anexos.length ? repo.anexosDaConversa(conversaId).find((a) => a.id === anexos[0])?.nome : undefined;
    return nome ? `Anexo: ${nome}`.slice(0, TAMANHO_TITULO) : TITULO_PADRAO;
  }
  if (linha.length <= TAMANHO_TITULO) return linha;
  const corte = linha.slice(0, TAMANHO_TITULO);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > TAMANHO_TITULO / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}
