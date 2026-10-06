import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, type Config } from '../../config';
import { RELOGIO, type Relogio } from '../../relogio';
import { ChavesDeApi } from '../apis/chaves-de-api';
import { ocultarSegredos } from '../apis/erros-api';
import { FABRICA_DE_MODELOS, type FabricaDeModelos } from '../apis/fabrica-de-modelos';
import { cortar } from '../cli/comum';
import { comoEntrarNaConta, type CliResolvido } from '../cli/resolvedor';
import type { EventoAgente, ProvedorIA, ServidorMcp, Uso } from '../cli/tipos';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { Ferramentas } from '../ferramentas/ferramentas';
import type { ContaSalva, EventoExecucao, Mensagem, PassoFerramenta, SituacaoMensagem } from '../tipos-api';
import { executarCli, type FalhaCli, type ResultadoCli } from './executor-cli';
import { INSTRUCOES, montarPrompt } from './prompt';
import { RodadaApi } from './rodada-api';
import {
  COMANDO_PONTE, ConflitoDeExecucao, LimiteDeExecucoes, RESOLVEDOR_CLI, type ComandoPonte, type PedidoResposta, type ResolvedorCli,
} from './tipos-execucao';

export { COMANDO_PONTE, ConflitoDeExecucao, LimiteDeExecucoes, RESOLVEDOR_CLI, type ComandoPonte, type PedidoResposta, type ResolvedorCli } from './tipos-execucao';

type Ouvinte = (seq: number, evento: EventoExecucao) => void;

interface Execucao {
  id: string;
  conversaId: string;
  mensagemId: string;
  contaId: string;
  provedor: ProvedorIA;
  modelo: string | null;
  token: string;
  eventos: { seq: number; evento: EventoExecucao }[];
  ouvintes: Set<Ouvinte>;
  texto: string;
  passos: PassoFerramenta[];
  uso: Partial<Uso>;
  erro: FalhaCli | null;
  avisos: string[];
  controle: AbortController;
  terminada: boolean;
  gravacao: NodeJS.Timeout | null;
  /** A conta resolvida, para explicar falta de login com o comando dela. */
  cli: CliResolvido | null;
}

const TEMPO_MAXIMO_MS = 10 * 60_000;
const TEMPO_TESTE_MS = 2 * 60_000;
const MAXIMO_SIMULTANEAS = 3;
const GRAVAR_A_CADA_MS = 500;
/** Depois do fim, a execução fica um pouco na memória para quem reconectar. */
const GUARDAR_APOS_FIM_MS = 2 * 60_000;
const PREVIA_RESULTADO = 600;
const PREFIXO_FLUXO = 'mcp__fluxo__';
/** Vaga da conversa já tomada por um envio que ainda está gravando a pergunta (e esperando anexos). */
const RESERVADA = 'reservada';

/**
 * As respostas do assistente em andamento. Cada uma roda o CLI (ou chama a
 * API, nas contas por chave — ver `RodadaApi`), grava a mensagem enquanto ela
 * chega (fechar a tela não perde nada) e guarda os eventos numerados para o
 * SSE — quem conecta depois recebe desde o começo.
 */
@Injectable()
export class Execucoes implements OnApplicationShutdown {
  private readonly log = new Logger('Assistente');
  private readonly execucoes = new Map<string, Execucao>();
  private readonly porConversa = new Map<string, string>();
  /**
   * Hash do token da ponte → conversa (null no teste de conexão). Guardar pelo
   * hash faz a busca no Map não dizer nada, pelo tempo, sobre o token em si.
   */
  private readonly tokens = new Map<string, { conversaId: string | null }>();
  /** Contas com um teste de conexão rodando: cliques repetidos não viram chamadas pagas em paralelo. */
  private readonly testando = new Set<string>();
  private readonly api: RodadaApi;

  constructor(
    private readonly repo: RepositorioAssistente,
    private readonly ferramentas: Ferramentas,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(RESOLVEDOR_CLI) private readonly resolver: ResolvedorCli,
    @Inject(COMANDO_PONTE) private readonly ponte: ComandoPonte,
    @Inject(ChavesDeApi) chaves: ChavesDeApi,
    @Inject(FABRICA_DE_MODELOS) fabrica: FabricaDeModelos,
  ) {
    this.api = new RodadaApi(chaves, fabrica, ferramentas);
  }

  // ------------------------------------------------------------------ público

  /** Lança se não dá para começar uma resposta nesta conversa agora (antes de gravar a pergunta). */
  verificarDisponivel(conversaId: string): void {
    if (this.porConversa.has(conversaId)) throw new ConflitoDeExecucao('Esta conversa já está gerando uma resposta.');
    if (this.porConversa.size >= MAXIMO_SIMULTANEAS) {
      throw new LimiteDeExecucoes(`Já há ${MAXIMO_SIMULTANEAS} respostas sendo geradas. Espere uma terminar.`);
    }
  }

  /**
   * Toma a vaga da conversa na hora (sem nenhum await no meio), antes de
   * gravar a pergunta: dois envios ao mesmo tempo (duas abas) não chegam os
   * dois a criar mensagem. Devolve a função que libera a vaga se o envio
   * falhar antes de `iniciar`.
   */
  reservar(conversaId: string): () => void {
    this.verificarDisponivel(conversaId);
    this.porConversa.set(conversaId, RESERVADA);
    return () => {
      if (this.porConversa.get(conversaId) === RESERVADA) this.porConversa.delete(conversaId);
    };
  }

  existe(id: string): boolean {
    return this.execucoes.has(id);
  }

  iniciar(p: PedidoResposta): string {
    if (this.porConversa.get(p.conversaId) !== RESERVADA) this.verificarDisponivel(p.conversaId);
    const ex: Execucao = {
      id: randomUUID(), conversaId: p.conversaId, mensagemId: p.mensagemId, contaId: p.contaId, provedor: p.provedor, modelo: p.modelo,
      token: randomBytes(32).toString('base64url'), eventos: [], ouvintes: new Set(), texto: '', passos: [], uso: {},
      erro: null, avisos: [], controle: new AbortController(), terminada: false, gravacao: null, cli: null,
    };
    this.execucoes.set(ex.id, ex);
    this.porConversa.set(p.conversaId, ex.id);
    this.tokens.set(hashDoToken(ex.token), { conversaId: p.conversaId });
    void this.rodar(ex, p);
    return ex.id;
  }

  /** Recebe os eventos depois de `desde` (0 = todos) e os próximos. null se a execução não existe (mais). */
  assinar(id: string, desde: number, ouvinte: Ouvinte): (() => void) | null {
    const ex = this.execucoes.get(id);
    if (!ex) return null;
    for (const { seq, evento } of ex.eventos) if (seq > desde) ouvinte(seq, evento);
    if (ex.terminada) return () => undefined;
    ex.ouvintes.add(ouvinte);
    return () => ex.ouvintes.delete(ouvinte);
  }

  cancelar(id: string): boolean {
    const ex = this.execucoes.get(id);
    if (!ex || ex.terminada) return false;
    ex.controle.abort();
    return true;
  }

  ativa(conversaId: string): string | null {
    const id = this.porConversa.get(conversaId);
    return id && id !== RESERVADA ? id : null;
  }

  conversaDaExecucao(id: string): string | null {
    return this.execucoes.get(id)?.conversaId ?? null;
  }

  contextoDoToken(token: string | undefined): { conversaId: string | null } | null {
    return token ? (this.tokens.get(hashDoToken(token)) ?? null) : null;
  }

  /** Teste de conexão dos Ajustes: o CLI (ou a API) responde a um "OK"? Não grava nada. */
  async testar(contaId: string): Promise<{ ok: boolean; mensagem: string; duracaoMs: number }> {
    if (this.testando.has(contaId)) throw new ConflitoDeExecucao('Já há um teste desta conta em andamento.');
    this.testando.add(contaId);
    try {
      return await this.testarAgora(contaId);
    } finally {
      this.testando.delete(contaId);
    }
  }

  private async testarAgora(contaId: string): Promise<{ ok: boolean; mensagem: string; duracaoMs: number }> {
    const contaApi = this.contaPorApi(contaId);
    if (contaApi) return this.api.testar(contaApi);
    const inicio = Date.now();
    const cli = await this.resolver(contaId);
    if ('erro' in cli) return { ok: false, mensagem: cli.erro, duracaoMs: Date.now() - inicio };
    const token = randomBytes(32).toString('base64url');
    const pastaExecucao = join(this.config.pastaAssistente, 'execucoes', `teste-${randomUUID()}`);
    this.tokens.set(hashDoToken(token), { conversaId: null });
    let texto = '';
    let erro: FalhaCli | null = null;
    try {
      const r = await executarCli({
        adaptador: cli.adaptador, caminho: cli.caminho, pasta: join(this.config.pastaAssistente, 'teste', cli.conta.provedor), pastaExecucao,
        prompt: 'Responda apenas com a palavra OK.', instrucoes: 'Teste de conexão do Fluxo: responda apenas OK, sem usar ferramentas.',
        modelo: cli.conta.modelo, sessaoId: null, envDaConta: cli.env, imagens: [], mcp: this.servidorMcp(token), tempoMaximoMs: TEMPO_TESTE_MS, sinal: new AbortController().signal,
        aoEvento: (e) => {
          if (e.tipo === 'texto') texto += e.delta;
          if (e.tipo === 'erro') erro ??= e;
        },
      });
      erro ??= r.falha;
    } finally {
      this.tokens.delete(hashDoToken(token));
      rmSync(pastaExecucao, { recursive: true, force: true });
    }
    const duracaoMs = Date.now() - inicio;
    if (erro) return { ok: false, mensagem: explicarLogin(erro, cli)!.mensagem, duracaoMs };
    if (!texto.trim()) return { ok: false, mensagem: `O ${cli.adaptador.nome} não respondeu nada.`, duracaoMs };
    return { ok: true, mensagem: `Funcionando: respondeu “${cortar(texto.trim(), 40)}”.`, duracaoMs };
  }

  onApplicationShutdown(): void {
    for (const ex of this.execucoes.values()) ex.controle.abort();
  }

  // ------------------------------------------------------------------ execução

  private contaPorApi(contaId: string): ContaSalva | null {
    const conta = this.repo.lerConfig().contas.find((c) => c.id === contaId);
    return conta?.tipo === 'api' ? conta : null;
  }

  private async rodar(ex: Execucao, p: PedidoResposta): Promise<void> {
    const contaApi = this.contaPorApi(p.contaId);
    if (contaApi) return this.rodarApi(ex, p, contaApi);
    const pastaExecucao = join(this.config.pastaAssistente, 'execucoes', ex.id);
    let resultado: ResultadoCli | null = null;
    try {
      const cli = await this.resolver(p.contaId);
      if ('erro' in cli) {
        ex.erro = { codigo: 'cli', mensagem: cli.erro };
        return;
      }
      ex.cli = cli;
      const sessaoId = this.repo.sessao(p.conversaId, cli.conta.id);
      resultado = await this.tentar(ex, p, cli, pastaExecucao, sessaoId);
      if (resultado.sessaoPerdida) {
        this.log.warn(`A sessão ${sessaoId} do ${cli.adaptador.nome} não existe mais; recomeçando com o histórico.`);
        this.repo.esquecerSessao(p.conversaId, cli.conta.id);
        resultado = await this.tentar(ex, p, cli, pastaExecucao, null);
      }
    } catch (e) {
      this.log.error(`Execução ${ex.id} falhou: ${(e as Error).stack ?? String(e)}`);
      ex.erro ??= { codigo: 'desconhecido', mensagem: 'Algo deu errado aqui dentro ao rodar o assistente. O detalhe ficou no log do Fluxo.' };
    } finally {
      rmSync(pastaExecucao, { recursive: true, force: true });
      this.finalizar(ex, resultado);
    }
  }

  /** Conta por API: sem token da ponte, sem pasta de execução, sem sessão — as ferramentas rodam aqui mesmo. */
  private async rodarApi(ex: Execucao, p: PedidoResposta, conta: ContaSalva): Promise<void> {
    let resultado: ResultadoCli | null = null;
    try {
      const pronta = this.api.preparar(conta, p.modelo);
      if ('erro' in pronta) {
        ex.erro = pronta.erro;
        return;
      }
      ex.modelo = pronta.idDoModelo;
      resultado = await this.api.responder(pronta, {
        conversaId: p.conversaId, texto: p.texto, hoje: this.relogio.hoje(), anexos: p.anexos, historico: p.historico, voz: p.voz,
        tempoMaximoMs: TEMPO_MAXIMO_MS, sinal: ex.controle.signal, aoEvento: (e) => this.aplicar(ex, e),
      });
    } catch (e) {
      // Só a mensagem: o objeto de erro do AI SDK leva o corpo do pedido (o extrato).
      this.log.error(`Execução ${ex.id} (API) falhou: ${ocultarSegredos((e as Error).message ?? String(e), '')}`);
      ex.erro ??= { codigo: 'desconhecido', mensagem: 'Algo deu errado aqui dentro ao chamar a API. O detalhe ficou no log do Fluxo.' };
    } finally {
      this.finalizar(ex, resultado);
    }
  }

  private tentar(ex: Execucao, p: PedidoResposta, cli: CliResolvido, pastaExecucao: string, sessaoId: string | null) {
    const pasta = join(this.config.pastaAssistente, 'conversas', p.conversaId);
    return executarCli({
      adaptador: cli.adaptador,
      caminho: cli.caminho,
      pasta,
      pastaExecucao,
      prompt: montarPrompt({ texto: p.texto, hoje: this.relogio.hoje(), anexos: p.anexos, historico: sessaoId ? [] : p.historico, voz: p.voz }),
      instrucoes: INSTRUCOES,
      modelo: p.modelo,
      sessaoId,
      imagens: p.anexos.filter((a) => a.tipo === 'imagem' && a.caminho).map((a) => a.caminho!),
      mcp: this.servidorMcp(ex.token),
      tempoMaximoMs: TEMPO_MAXIMO_MS,
      sinal: ex.controle.signal,
      envDaConta: cli.env,
      aoEvento: (e) => this.aplicar(ex, e),
    });
  }

  private servidorMcp(token: string): ServidorMcp {
    return {
      nome: 'fluxo',
      comando: this.ponte.comando,
      args: this.ponte.args,
      env: { FLUXO_PONTE_URL: `http://127.0.0.1:${this.config.porta}/api/assistente/ferramentas` },
      segredo: { variavel: 'FLUXO_PONTE_ACESSO', valor: token },
    };
  }

  private aplicar(ex: Execucao, e: EventoAgente): void {
    if (e.tipo === 'sessao') {
      this.repo.salvarSessao(ex.conversaId, { id: ex.contaId, provedor: ex.provedor }, e.sessaoId);
      if (e.modelo) ex.modelo = e.modelo;
    } else if (e.tipo === 'texto') {
      ex.texto += e.delta;
      this.emitir(ex, { tipo: 'texto', delta: e.delta });
      this.agendarGravacao(ex);
    } else if (e.tipo === 'ferramenta') {
      this.atualizarPasso(ex, e.id, (atual) => ({
        id: e.id, nome: nomeCurto(e.nome), rotulo: this.rotulo(e.nome, e.entrada), entrada: e.entrada,
        situacao: atual?.situacao ?? 'rodando', resultado: atual?.resultado ?? null,
      }));
    } else if (e.tipo === 'ferramenta_fim') {
      this.atualizarPasso(ex, e.id, (atual) => atual && ({ ...atual, situacao: e.ok ? 'ok' : 'erro', resultado: cortar(e.resultado, PREVIA_RESULTADO) }));
    } else if (e.tipo === 'uso') {
      ex.uso = { ...ex.uso, ...Object.fromEntries(Object.entries(e.uso).filter(([, v]) => v !== null && v !== undefined)) };
    } else if (e.tipo === 'erro') {
      ex.erro ??= { codigo: e.codigo, mensagem: e.mensagem };
    } else {
      ex.avisos.push(e.mensagem);
      this.log.warn(`Aviso do assistente: ${e.mensagem}`);
    }
  }

  private rotulo(nome: string, entrada: Record<string, unknown>): string {
    if (nome.startsWith(PREFIXO_FLUXO)) return this.ferramentas.rotulo(nomeCurto(nome), entrada);
    if (/^(Read|read_file|read_many_files)$/.test(nome)) return 'Abriu um anexo';
    return nome;
  }

  private atualizarPasso(ex: Execucao, id: string, novo: (atual: PassoFerramenta | undefined) => PassoFerramenta | undefined): void {
    const atual = ex.passos.find((p) => p.id === id);
    const passo = novo(atual);
    if (!passo) return;
    ex.passos = atual ? ex.passos.map((p) => (p.id === id ? passo : p)) : [...ex.passos, passo];
    this.emitir(ex, { tipo: 'passo', passo });
    this.agendarGravacao(ex);
  }

  private emitir(ex: Execucao, evento: EventoExecucao): void {
    const seq = ex.eventos.length + 1;
    ex.eventos.push({ seq, evento });
    for (const ouvinte of ex.ouvintes) {
      try {
        ouvinte(seq, evento);
      } catch (e) {
        this.log.warn(`Ouvinte de eventos falhou: ${(e as Error).message}`);
      }
    }
  }

  private agendarGravacao(ex: Execucao): void {
    if (ex.gravacao) return;
    ex.gravacao = setTimeout(() => {
      ex.gravacao = null;
      if (!ex.terminada) this.repo.atualizarMensagem(ex.mensagemId, { texto: ex.texto, passos: ex.passos });
    }, GRAVAR_A_CADA_MS);
  }

  private finalizar(ex: Execucao, r: ResultadoCli | null): void {
    if (ex.gravacao) clearTimeout(ex.gravacao);
    const cancelada = r?.fim.motivo === 'cancelado';
    const falha = cancelada ? null : explicarLogin(ex.erro ?? r?.falha ?? null, ex.cli);
    const semResposta = !ex.texto.trim();
    const situacao: SituacaoMensagem = cancelada ? 'cancelada' : falha || semResposta ? 'erro' : 'ok';
    const erro = falha?.mensagem ?? (situacao === 'erro' ? semRespostaMensagem(ex) : null);
    const passos = ex.passos.map((p) => (p.situacao === 'rodando' ? { ...p, situacao: 'erro' as const } : p));
    const uso: Uso = {
      tokensEntrada: ex.uso.tokensEntrada ?? null, tokensSaida: ex.uso.tokensSaida ?? null,
      custoUsd: ex.uso.custoUsd ?? null, duracaoMs: ex.uso.duracaoMs ?? r?.fim.duracaoMs ?? null,
    };
    this.repo.atualizarMensagem(ex.mensagemId, { texto: ex.texto, passos, situacao, erro, uso, modelo: ex.modelo });
    ex.terminada = true;
    this.porConversa.delete(ex.conversaId);
    this.tokens.delete(hashDoToken(ex.token));
    const mensagem: Mensagem = this.repo.mensagem(ex.mensagemId) ?? {
      id: ex.mensagemId, papel: 'assistente', texto: ex.texto, passos, anexos: [], situacao, erro, contaId: ex.contaId, contaNome: null,
      provedor: ex.provedor, modelo: ex.modelo, uso,
      criadaEm: this.relogio.agora().toISOString(),
    };
    this.emitir(ex, { tipo: 'fim', mensagem });
    ex.ouvintes.clear();
    setTimeout(() => this.execucoes.delete(ex.id), GUARDAR_APOS_FIM_MS).unref();
  }
}

/** Falta de login numa conta com pasta própria: o comando certo é o dela, não o `claude`/`gemini` puro. */
function explicarLogin(falha: FalhaCli | null, cli: CliResolvido | null): FalhaCli | null {
  if (!falha || falha.codigo !== 'autenticacao' || !cli?.conta.pastaLogin) return falha;
  const comando = comoEntrarNaConta(cli.adaptador, cli.conta);
  return { codigo: 'autenticacao', mensagem: `A conta “${cli.conta.nome}” não está logada (ou o login expirou). Num terminal, rode: ${comando}` };
}

function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function nomeCurto(nome: string): string {
  return nome.startsWith(PREFIXO_FLUXO) ? nome.slice(PREFIXO_FLUXO.length) : nome;
}

function semRespostaMensagem(ex: Execucao): string {
  const aviso = ex.avisos.at(-1);
  return aviso ? `O assistente terminou sem responder. Último aviso: ${cortar(aviso, 300)}` : 'O assistente terminou sem responder.';
}
