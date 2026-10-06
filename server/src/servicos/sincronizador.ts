import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit, Optional } from '@nestjs/common';
import { paraDia, somarDias } from '../domain/datas';
import { NaoEncontrado, Repositorio, type LinhaConexao, type ResultadoSincronizacao } from '../dados/repositorio';
import type { Dia } from '../domain/types';
import { ID_CONEXAO_DEMO, ProvedorDemo } from '../provedores/provedor-demo';
import { ProvedorPluggy } from '../provedores/provedor-pluggy';
import type { ProvedorFinanceiro } from '../provedores/provedor';
import { RELOGIO, type Relogio } from '../relogio';

export const PROVEDOR_PLUGGY = Symbol('PROVEDOR_PLUGGY');

/** Histórico que se pede na primeira vez: o Open Finance entrega até 12 meses. */
const DIAS_PRIMEIRA_VEZ = 400;
/** Nas seguintes, a conta revê 60 dias antes do que já está garantido (pendentes que viram efetivados). */
const DIAS_REVISAO_CONTA = 60;
const INTERVALO_AUTOMATICO_MS = 60 * 60 * 1000;

export class PluggyNaoConfigurada extends Error {
  constructor() {
    super('A Pluggy não está configurada. Coloque PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no arquivo .env e reinicie o Fluxo.');
  }
}

/** Traduz erro de rede/API para uma frase que o usuário entende. */
export function mensagemAmigavel(erro: unknown): string {
  const e = erro as { code?: string; status?: number; message?: string; cause?: { code?: string } };
  const codigo = e?.code ?? e?.cause?.code;
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN' || codigo === 'ECONNREFUSED' || codigo === 'ETIMEDOUT') {
    return 'Sem conexão com a Pluggy. Confira a internet e tente de novo.';
  }
  if (e?.status === 401 || e?.status === 403 || /unauthori[sz]ed|invalid.*(client|credential)/i.test(e?.message ?? '')) {
    return 'A Pluggy recusou as credenciais. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env.';
  }
  if (e?.status === 404) return 'A Pluggy não encontrou esta conexão. Ela pode ter sido removida lá.';
  if (e?.status === 429) return 'A Pluggy pediu para esperar um pouco antes de sincronizar de novo.';
  return e?.message?.slice(0, 300) || 'Falha desconhecida ao sincronizar.';
}

/**
 * De que dia a conta precisa ser pedida de novo. O que já está no banco só
 * está completo até a última vez que o BANCO atualizou (`atualizadaNoBanco`,
 * o lastUpdatedAt da Pluggy): a `ultimaSincronizacao` avança mesmo com o item
 * parado em erro, e partir dela deixaria um buraco que nunca mais seria pedido.
 * Sem nenhuma atualização real registrada, pede o histórico inteiro.
 */
export function inicioDaRevisaoDaConta(
  conexao: Pick<LinhaConexao, 'ultimaSincronizacao' | 'atualizadaNoBanco'>,
  hoje: Dia,
): Dia {
  const limite = somarDias(hoje, -DIAS_PRIMEIRA_VEZ);
  if (!conexao.ultimaSincronizacao || !conexao.atualizadaNoBanco) return limite;
  const sincronizou = paraDia(conexao.ultimaSincronizacao);
  const atualizou = paraDia(conexao.atualizadaNoBanco);
  const inicio = somarDias(atualizou < sincronizou ? atualizou : sincronizou, -DIAS_REVISAO_CONTA);
  return inicio > limite ? inicio : limite;
}

@Injectable()
export class Sincronizador implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(Sincronizador.name);
  private readonly emAndamento = new Map<string, Promise<ResultadoSincronizacao>>();
  private temporizador: NodeJS.Timeout | null = null;
  private readonly aoTerminarOuvintes = new Set<(conexaoId: string) => void>();

  constructor(
    private readonly repositorio: Repositorio,
    private readonly demo: ProvedorDemo,
    @Optional() @Inject(PROVEDOR_PLUGGY) private readonly pluggy: ProvedorPluggy | null,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  get pluggyConfigurada(): boolean {
    return Boolean(this.pluggy);
  }

  async onModuleInit(): Promise<void> {
    if (process.env.FLUXO_SEM_AUTOMACAO === '1') return;
    await this.garantirDemonstracao().catch((e) => this.log.error(`Demonstração: ${mensagemAmigavel(e)}`));
    void this.sincronizarAtrasadas();
    this.temporizador = setInterval(() => void this.sincronizarAtrasadas(), INTERVALO_AUTOMATICO_MS);
    this.temporizador.unref();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /**
   * Na primeira abertura, sem nenhuma conexão, o Fluxo já nasce com a
   * demonstração para a tela não ficar vazia. Removida uma vez, não volta.
   */
  async garantirDemonstracao(): Promise<void> {
    const { conexoes } = this.repositorio.instantaneo();
    if (conexoes.length > 0 || this.repositorio.configuracoes().demoDispensada) return;
    await this.ativarDemonstracao();
  }

  async ativarDemonstracao(): Promise<ResultadoSincronizacao> {
    this.repositorio.salvarConfiguracoes({ demoDispensada: false });
    this.repositorio.criarConexao(ID_CONEXAO_DEMO, 'demo', 'Nubank (demonstração)');
    return this.sincronizar(ID_CONEXAO_DEMO);
  }

  removerDemonstracao(): void {
    this.repositorio.removerConexao(ID_CONEXAO_DEMO);
    this.repositorio.salvarConfiguracoes({ demoDispensada: true });
  }

  async criarTokenDeConexao(itemId?: string): Promise<string> {
    if (!this.pluggy) throw new PluggyNaoConfigurada();
    try {
      return await this.pluggy.criarTokenDeConexao(itemId);
    } catch (e) {
      throw new Error(mensagemAmigavel(e));
    }
  }

  /** Chamado quando o widget da Pluggy termina de conectar um banco. */
  async registrarConexaoPluggy(itemId: string): Promise<ResultadoSincronizacao> {
    if (!this.pluggy) throw new PluggyNaoConfigurada();
    this.repositorio.criarConexao(itemId, 'pluggy', 'Conectando…');
    const resultado = await this.sincronizar(itemId);
    // Dado de mentira somado com o de verdade estragaria todas as contas.
    if (this.repositorio.conexao(ID_CONEXAO_DEMO)) this.removerDemonstracao();
    return resultado;
  }

  /**
   * Remove a conexão daqui. Por padrão NÃO apaga na Pluggy: com o MeuPluggy,
   * reconectar depois do período de teste não é possível — apagar lá seria
   * perder o acesso de vez.
   */
  async removerConexao(id: string, revogarNaPluggy = false): Promise<void> {
    const conexao = this.repositorio.conexao(id);
    if (!conexao) throw new NaoEncontrado('Conexão não encontrada.');
    if (conexao.provedor === 'demo') return this.removerDemonstracao();
    if (revogarNaPluggy && this.pluggy) await this.pluggy.remover(id).catch((e) => { throw new Error(mensagemAmigavel(e)); });
    this.repositorio.removerConexao(id);
  }

  /** Várias chamadas simultâneas para a mesma conexão compartilham a mesma execução. */
  sincronizar(conexaoId: string, pedirAoBanco = false): Promise<ResultadoSincronizacao> {
    const existente = this.emAndamento.get(conexaoId);
    if (existente) return existente;
    const execucao = this.executar(conexaoId, pedirAoBanco).finally(() => this.emAndamento.delete(conexaoId));
    this.emAndamento.set(conexaoId, execucao);
    return execucao;
  }

  sincronizando(conexaoId: string): boolean {
    return this.emAndamento.has(conexaoId);
  }

  /**
   * Avisa quem quiser (a conciliação das contas a pagar) quando uma
   * sincronização grava dados novos. Devolve a função de cancelar.
   */
  aoTerminar(ouvinte: (conexaoId: string) => void): () => void {
    this.aoTerminarOuvintes.add(ouvinte);
    return () => this.aoTerminarOuvintes.delete(ouvinte);
  }

  private avisarTermino(conexaoId: string): void {
    for (const ouvinte of this.aoTerminarOuvintes) {
      try {
        ouvinte(conexaoId);
      } catch (e) {
        this.log.error(`Depois da sincronização: ${(e as Error).message}`);
      }
    }
  }

  private provedorDa(provedor: 'pluggy' | 'demo'): ProvedorFinanceiro {
    if (provedor === 'demo') return this.demo;
    if (!this.pluggy) throw new PluggyNaoConfigurada();
    return this.pluggy;
  }

  private async executar(conexaoId: string, pedirAoBanco: boolean): Promise<ResultadoSincronizacao> {
    const conexao = this.repositorio.conexao(conexaoId);
    if (!conexao) throw new NaoEncontrado('Conexão não encontrada.');
    const provedor = this.provedorDa(conexao.provedor);
    const hoje = this.relogio.hoje();
    const desde = { cartao: somarDias(hoje, -DIAS_PRIMEIRA_VEZ), conta: inicioDaRevisaoDaConta(conexao, hoje) };
    const log = this.repositorio.iniciarLogDeSincronizacao(conexaoId);
    try {
      if (pedirAoBanco && provedor instanceof ProvedorPluggy) {
        await provedor.pedirAtualizacao(conexaoId);
        await provedor.aguardarAtualizacao(conexaoId);
      }
      const recebidos = await provedor.buscar(conexaoId, desde);
      // Segunda trava, além da do provedor: item que não terminou de atualizar
      // pode ter mandado lista incompleta — nada é apagado com base nela.
      const dados = recebidos.conexao.situacao === 'UPDATED' ? recebidos : { ...recebidos, janelas: {} };
      const resultado = this.repositorio.aplicarSincronizacao(dados);
      this.repositorio.encerrarLogDeSincronizacao(log, resultado, null);
      this.log.log(`${conexao.nome}: +${resultado.novas} novas, ${resultado.removidas} removidas`);
      this.avisarTermino(conexaoId);
      return resultado;
    } catch (e) {
      const mensagem = mensagemAmigavel(e);
      this.repositorio.registrarErroDeConexao(conexaoId, mensagem);
      this.repositorio.encerrarLogDeSincronizacao(log, null, mensagem);
      this.log.warn(`${conexao.nome}: ${mensagem}`);
      throw new Error(mensagem);
    }
  }

  /** Sincroniza as conexões reais paradas há mais de 1 hora. Erros ficam registrados, não derrubam nada. */
  async sincronizarAtrasadas(): Promise<void> {
    const limite = this.relogio.agora().getTime() - INTERVALO_AUTOMATICO_MS;
    for (const c of this.repositorio.instantaneo().conexoes) {
      if (c.provedor !== 'pluggy' || !this.pluggy) continue;
      if (c.ultimaSincronizacao && new Date(c.ultimaSincronizacao).getTime() > limite) continue;
      await this.sincronizar(c.id).catch(() => undefined);
    }
  }
}
