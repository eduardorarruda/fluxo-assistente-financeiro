import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, Optional,
} from '@nestjs/common';
import { Repositorio } from '../dados/repositorio';
import type { Alerta } from '../domain/alertas';
import { RELOGIO, type Relogio } from '../relogio';
import { ContasAPagar } from '../servicos/contas-a-pagar';
import { Financas } from '../servicos/financas';
import { Sincronizador } from '../servicos/sincronizador';
import { ApiAgenda, ErroAgenda } from './agenda-api';
import { CofreGoogle, type ClienteOAuth, type EstadoGoogle, type PreferenciasGoogle } from './cofre-google';
import { eventosDesejados, itensDasContas, itensDosCartoes, janelaDe, type CartaoDaAgenda, type ItemDaAgenda } from './eventos';
import { ClienteOAuthGoogle, ErroOAuth, ESCOPO_AGENDA, PedidosDeConexao, urlDeAutorizacao, type Buscar } from './oauth';
import { aplicarNaAgenda, reconciliar } from './sincronia';

export const PASTA_GOOGLE = Symbol('PASTA_GOOGLE');
export const FETCH_GOOGLE = Symbol('FETCH_GOOGLE');
export const PORTA_GOOGLE = Symbol('PORTA_GOOGLE');
/** Espera do servidor (os testes trocam por uma que não espera). */
export const ESPERA_GOOGLE = Symbol('ESPERA_GOOGLE');

/** Mudança em rajada (várias contas, sincronização do banco) vira uma sincronização só. */
const ESPERA_AGRUPAR_MS = 5000;
const INTERVALO_MS = 60 * 60 * 1000;
/** Depois de falha passageira (rede, limite), tenta de novo sozinho. */
const NOVA_TENTATIVA_MS = 15 * 60 * 1000;
/** Na subida, espera o resto do Fluxo (e a primeira conciliação de contas) se acomodar. */
const ESPERA_NA_SUBIDA_MS = 15_000;
/** Uma vez por dia o mapa local é conferido com o Google (evento apagado à mão volta). */
const RECONCILIAR_A_CADA_MS = 24 * 60 * 60 * 1000;

export interface EstadoPublicoGoogle {
  /** Client ID e secret colados em Ajustes. */
  configurado: boolean;
  /** Só o começo e o fim do client ID (que não é segredo, mas não precisa aparecer inteiro). */
  clienteId: string | null;
  conectado: boolean;
  email: string | null;
  agendaId: string | null;
  ultimaSincronizacao: string | null;
  sincronizando: boolean;
  erro: string | null;
  precisaReconectar: boolean;
  eventos: number;
  /** O endereço de retorno que o Google vai chamar (para o guia). */
  enderecoDeRetorno: string;
  preferencias: PreferenciasGoogle;
  /** O serviço de contas a pagar está no ar (senão a opção fica desligada na tela). */
  contasDisponiveis: boolean;
}

export type ResultadoDaConexao = { ok: true; email: string | null } | { ok: false; motivo: string };

function resumirClienteId(id: string): string {
  const [numero = ''] = id.split('-');
  return `${numero.slice(0, 6)}…apps.googleusercontent.com`;
}

/**
 * O Google Agenda do Fluxo: conexão OAuth, a agenda "Fluxo" e a
 * sincronização dos vencimentos. Nunca derruba o servidor: toda falha vira
 * `erro` no estado (e uma nova tentativa, se for passageira).
 */
@Injectable()
export class ServicoGoogle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('GoogleAgenda');
  private readonly cofre: CofreGoogle;
  private readonly oauth: ClienteOAuthGoogle;
  private readonly api: ApiAgenda;
  readonly pedidos = new PedidosDeConexao();
  private acesso: { token: string; expiraEm: number } | null = null;
  private emAndamento: Promise<void> | null = null;
  private outraDepois = false;
  private reconciliarNaProxima = false;
  private temporizadores: { agrupar?: NodeJS.Timeout; hora?: NodeJS.Timeout; tentar?: NodeJS.Timeout; subida?: NodeJS.Timeout } = {};
  private desligar: (() => void)[] = [];

  constructor(
    @Inject(PASTA_GOOGLE) pasta: string,
    @Inject(FETCH_GOOGLE) buscar: Buscar,
    @Inject(PORTA_GOOGLE) private readonly porta: number,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    private readonly financas: Financas,
    private readonly repositorio: Repositorio,
    private readonly sincronizador: Sincronizador,
    @Optional() @Inject(ContasAPagar) private readonly contas: ContasAPagar | null,
    @Optional() @Inject(ESPERA_GOOGLE) esperar?: (ms: number) => Promise<void>,
  ) {
    this.cofre = new CofreGoogle(pasta);
    this.oauth = new ClienteOAuthGoogle(buscar);
    this.api = new ApiAgenda(buscar, {
      tokenDeAcesso: () => this.tokenDeAcesso(),
      descartarToken: () => {
        this.acesso = null;
      },
      esperar,
      intervaloMs: esperar ? 0 : undefined,
    });
  }

  get enderecoDeRetorno(): string {
    return `http://127.0.0.1:${this.porta}/api/google/retorno`;
  }

  // ------------------------------------------------------------ ciclo de vida

  onApplicationBootstrap(): void {
    this.desligar.push(this.sincronizador.aoTerminar(() => this.agendar()));
    this.desligar.push(this.financas.registrarAlertas(() => this.alertas()));
    if (this.contas) this.desligar.push(this.contas.aoMudar(() => this.agendar()));
    if (process.env.FLUXO_SEM_AUTOMACAO === '1') return;
    this.temporizadores.subida = setTimeout(() => void this.sincronizarSeConectado(), ESPERA_NA_SUBIDA_MS);
    this.temporizadores.hora = setInterval(() => void this.sincronizarSeConectado(), INTERVALO_MS);
    for (const t of Object.values(this.temporizadores)) t?.unref();
  }

  onApplicationShutdown(): void {
    for (const parar of this.desligar) parar();
    this.desligar = [];
    clearTimeout(this.temporizadores.agrupar);
    clearTimeout(this.temporizadores.tentar);
    clearTimeout(this.temporizadores.subida);
    clearInterval(this.temporizadores.hora);
    this.temporizadores = {};
  }

  // ------------------------------------------------------------------ estado

  estado(): EstadoPublicoGoogle {
    const cliente = this.cofre.cliente();
    const token = this.cofre.token();
    const e = this.cofre.estado();
    return {
      configurado: cliente !== null,
      clienteId: cliente ? resumirClienteId(cliente.clientId) : null,
      conectado: cliente !== null && token !== null,
      email: token?.email ?? null,
      agendaId: token ? e.agendaId : null,
      ultimaSincronizacao: token ? e.ultimaSincronizacao : null,
      sincronizando: this.emAndamento !== null,
      erro: e.erro,
      precisaReconectar: e.precisaReconectar,
      eventos: token ? Object.keys(this.cofre.eventos()).length : 0,
      enderecoDeRetorno: this.enderecoDeRetorno,
      preferencias: e.preferencias,
      contasDisponiveis: this.contas !== null,
    };
  }

  salvarCliente(cliente: ClienteOAuth): EstadoPublicoGoogle {
    if (this.cofre.token()) throw new ConflictException('Desconecte o Google antes de trocar as credenciais.');
    this.cofre.salvarCliente(cliente);
    this.cofre.mudarEstado({ erro: null, precisaReconectar: false });
    this.pedidos.limpar();
    return this.estado();
  }

  removerCliente(): EstadoPublicoGoogle {
    if (this.cofre.token()) throw new ConflictException('Desconecte o Google antes de remover as credenciais.');
    this.cofre.removerCliente();
    this.pedidos.limpar();
    return this.estado();
  }

  mudarPreferencias(p: Partial<PreferenciasGoogle>): EstadoPublicoGoogle {
    const { preferencias } = this.cofre.estado();
    this.cofre.mudarEstado({ preferencias: { ...preferencias, ...p } });
    this.agendar();
    return this.estado();
  }

  // ---------------------------------------------------------------- conexão

  iniciarConexao(): { url: string } {
    const cliente = this.cofre.cliente();
    if (!cliente) throw new BadRequestException('Cole o client ID e o client secret antes de conectar.');
    const { estado, desafio } = this.pedidos.criar(cliente.clientId);
    return { url: urlDeAutorizacao({ clientId: cliente.clientId, redirectUri: this.enderecoDeRetorno, estado, desafio }) };
  }

  /** O que a Seguranca pergunta: este `state` é de um pedido em aberto? */
  retornoValido(estado: unknown): boolean {
    return this.pedidos.valido(estado);
  }

  /** Volta do Google: troca o código pelo token, guarda e já manda sincronizar. */
  async concluirConexao(p: { codigo?: unknown; estado?: unknown; erro?: unknown }): Promise<ResultadoDaConexao> {
    const pedido = this.pedidos.consumir(p.estado);
    if (!pedido) return { ok: false, motivo: 'Este link de retorno já foi usado ou expirou. Volte ao Fluxo e clique em “Conectar” de novo.' };
    if (typeof p.erro === 'string') {
      return { ok: false, motivo: p.erro === 'access_denied' ? 'Você não autorizou o acesso. Nada foi conectado.' : `O Google recusou a conexão (${p.erro.slice(0, 60)}).` };
    }
    const cliente = this.cofre.cliente();
    if (!cliente || cliente.clientId !== pedido.clientId) return { ok: false, motivo: 'As credenciais mudaram durante a conexão. Clique em “Conectar” de novo.' };
    if (typeof p.codigo !== 'string' || p.codigo.length < 10 || p.codigo.length > 2048) return { ok: false, motivo: 'O Google voltou sem o código de autorização.' };
    try {
      const r = await this.oauth.trocarCodigo(cliente, { codigo: p.codigo, verificador: pedido.verificador, redirectUri: this.enderecoDeRetorno });
      if (!r.escopos.includes(ESCOPO_AGENDA)) {
        // Consentimento granular: dá para desmarcar a agenda e autorizar só o e-mail.
        await this.oauth.revogar(r.refreshToken ?? r.acesso).catch(() => undefined);
        return { ok: false, motivo: 'A permissão do Google Agenda ficou desmarcada. Conecte de novo e deixe a opção da agenda marcada.' };
      }
      if (!r.refreshToken) return { ok: false, motivo: 'O Google não entregou o token de longa duração. Remova o acesso do Fluxo em myaccount.google.com/permissions e conecte de novo.' };
      this.cofre.salvarToken({ refreshToken: r.refreshToken, email: r.email, escopos: r.escopos, conectadoEm: this.relogio.agora().toISOString() });
      this.acesso = { token: r.acesso, expiraEm: r.expiraEmMs };
      this.cofre.mudarEstado({ erro: null, precisaReconectar: false });
      this.reconciliarNaProxima = true;
      this.log.log('Conectado ao Google Agenda.');
      void this.sincronizarSemFalhar();
      return { ok: true, email: r.email };
    } catch (e) {
      return { ok: false, motivo: e instanceof ErroOAuth ? e.message : 'Não deu para concluir a conexão com o Google.' };
    }
  }

  /**
   * Revoga no Google e apaga os arquivos daqui. Com `apagarAgenda`, apaga
   * antes a agenda "Fluxo" inteira (e os eventos com ela). Falha do Google
   * não impede de desconectar: o que é local some de qualquer jeito.
   */
  async desconectar(apagarAgenda: boolean): Promise<EstadoPublicoGoogle & { aviso: string | null }> {
    const token = this.cofre.token();
    if (!token) return { ...this.estado(), aviso: null };
    await this.emAndamento?.catch(() => undefined);
    const avisos: string[] = [];
    const { agendaId } = this.cofre.estado();
    if (apagarAgenda && agendaId) {
      await this.api.apagarAgenda(agendaId).catch(() => avisos.push('Não deu para apagar a agenda "Fluxo"; apague-a no Google Agenda se quiser.'));
    }
    await this.oauth.revogar(token.refreshToken).catch(() => avisos.push('Não deu para avisar o Google; remova o acesso em myaccount.google.com/permissions.'));
    this.acesso = null;
    this.cofre.esquecerConta();
    this.log.log('Desconectado do Google Agenda.');
    return { ...this.estado(), aviso: avisos.join(' ') || null };
  }

  // ------------------------------------------------------------ sincronização

  /** Marca uma sincronização para daqui a pouco, juntando as que chegarem no meio. */
  agendar(): void {
    if (!this.cofre.token()) return;
    clearTimeout(this.temporizadores.agrupar);
    this.temporizadores.agrupar = setTimeout(() => void this.sincronizarSemFalhar(), ESPERA_AGRUPAR_MS);
    this.temporizadores.agrupar.unref();
  }

  private async sincronizarSeConectado(): Promise<void> {
    if (this.cofre.token()) await this.sincronizarSemFalhar();
  }

  private async sincronizarSemFalhar(): Promise<void> {
    await this.sincronizar().catch(() => undefined);
  }

  /** "Sincronizar agora": também confere com o que está no Google. Chamadas no meio de outra viram uma só, logo depois. */
  async sincronizarAgora(): Promise<EstadoPublicoGoogle> {
    if (!this.cofre.token()) throw new BadRequestException('Conecte o Google Agenda primeiro.');
    this.reconciliarNaProxima = true;
    await this.sincronizar().catch(() => undefined);
    return this.estado();
  }

  sincronizar(): Promise<void> {
    if (this.emAndamento) {
      this.outraDepois = true;
      return this.emAndamento;
    }
    this.emAndamento = this.executar().finally(() => {
      this.emAndamento = null;
      if (this.outraDepois) {
        this.outraDepois = false;
        void this.sincronizarSemFalhar();
      }
    });
    return this.emAndamento;
  }

  private async executar(): Promise<void> {
    if (!this.cofre.token()) return;
    clearTimeout(this.temporizadores.tentar);
    try {
      const agendaId = await this.garantirAgenda();
      const estado = this.cofre.estado();
      const desejados = eventosDesejados(this.itens(estado.preferencias), estado.preferencias, janelaDe(this.relogio.hoje()), this.relogio.agora());
      let mapa = this.cofre.eventos();
      const agora = this.relogio.agora();
      const venceu = !estado.ultimaReconciliacao || agora.getTime() - new Date(estado.ultimaReconciliacao).getTime() > RECONCILIAR_A_CADA_MS;
      if (this.reconciliarNaProxima || venceu || Object.keys(mapa).length === 0) {
        mapa = (await reconciliar(this.api, agendaId)).mapa;
        this.cofre.salvarEventos(mapa);
        this.cofre.mudarEstado({ ultimaReconciliacao: agora.toISOString() });
        this.reconciliarNaProxima = false;
      }
      const r = await aplicarNaAgenda(this.api, agendaId, desejados, mapa, (m) => this.cofre.salvarEventos(m));
      this.cofre.mudarEstado({ ultimaSincronizacao: this.relogio.agora().toISOString(), erro: null, precisaReconectar: false });
      if (r.criados || r.atualizados || r.apagados) this.log.log(`Agenda: +${r.criados} criados, ${r.atualizados} atualizados, ${r.apagados} apagados`);
    } catch (e) {
      this.registrarFalha(e);
      throw e;
    }
  }

  private registrarFalha(e: unknown): void {
    if (e instanceof ErroOAuth && e.motivo === 'concessao-invalida') {
      // Refresh token morto (revogado, ou os 7 dias do app em "Teste"): só reconectando.
      this.cofre.removerToken();
      this.acesso = null;
      this.cofre.mudarEstado({ erro: e.message, precisaReconectar: true });
      this.log.warn('O Google não aceitou mais a autorização; é preciso conectar de novo.');
      return;
    }
    const reconectar = (e instanceof ErroAgenda && (e.motivo === 'autorizacao' || e.motivo === 'escopo')) || (e instanceof ErroOAuth && e.motivo === 'cliente-invalido');
    const mensagem = e instanceof ErroAgenda || e instanceof ErroOAuth ? e.message : 'Falha inesperada ao sincronizar com o Google Agenda.';
    this.cofre.mudarEstado({ erro: mensagem, precisaReconectar: reconectar });
    // Só a mensagem (nunca o objeto: poderia carregar cabeçalhos).
    this.log.warn(`Sincronização com o Google Agenda: ${mensagem}`);
    const passageiro = (e instanceof ErroAgenda && e.passageiro) || (e instanceof ErroOAuth && e.motivo === 'rede') || !(e instanceof ErroAgenda || e instanceof ErroOAuth);
    if (passageiro && process.env.FLUXO_SEM_AUTOMACAO !== '1') {
      this.temporizadores.tentar = setTimeout(() => void this.sincronizarSeConectado(), NOVA_TENTATIVA_MS);
      this.temporizadores.tentar.unref();
    }
  }

  private async tokenDeAcesso(): Promise<string> {
    if (this.acesso && this.acesso.expiraEm - 60_000 > Date.now()) return this.acesso.token;
    const cliente = this.cofre.cliente();
    const token = this.cofre.token();
    if (!cliente || !token) throw new ErroAgenda('autorizacao', 'O Google Agenda não está conectado.');
    const r = await this.oauth.renovar(cliente, token.refreshToken);
    this.acesso = { token: r.acesso, expiraEm: r.expiraEmMs };
    // O Google às vezes gira o refresh token: guarda o novo.
    if (r.refreshToken && r.refreshToken !== token.refreshToken) this.cofre.salvarToken({ ...token, refreshToken: r.refreshToken });
    return r.acesso;
  }

  /** A agenda "Fluxo": cria na primeira vez e de novo se a pessoa a apagou (o mapa velho perde o sentido). */
  private async garantirAgenda(): Promise<string> {
    const { agendaId } = this.cofre.estado();
    if (agendaId && (await this.api.existeAgenda(agendaId))) return agendaId;
    const nova = await this.api.criarAgenda();
    this.cofre.salvarEventos({});
    this.cofre.mudarEstado({ agendaId: nova, ultimaReconciliacao: null });
    this.reconciliarNaProxima = false;
    this.log.log(agendaId ? 'A agenda "Fluxo" tinha sido apagada no Google; criei outra.' : 'Criei a agenda "Fluxo" no Google.');
    return nova;
  }

  /** Os itens de agora: cartões (do Financas e das faturas do banco) e contas a pagar. */
  private itens(p: PreferenciasGoogle): ItemDaAgenda[] {
    const hoje = this.relogio.hoje();
    const janela = janelaDe(hoje);
    const itens: ItemDaAgenda[] = [];
    if (p.cartao) {
      const inst = this.repositorio.instantaneo();
      const cartoes: CartaoDaAgenda[] = this.financas.cartoes().flatMap((v) => {
        const conta = inst.contas.find((c) => c.id === v.contaId);
        return conta ? [{ conta, faturas: v.faturas, faturasDoBanco: inst.faturas.filter((f) => f.contaId === v.contaId) }] : [];
      });
      itens.push(...itensDosCartoes(cartoes, hoje, janela));
    }
    if (p.contas && this.contas) {
      const naJanela = this.contas.listar({ de: janela.de, ate: janela.ate });
      const atrasadas = this.contas.listar({ situacao: 'atrasada' });
      itens.push(...itensDasContas([...naJanela, ...atrasadas]));
    }
    return itens;
  }

  /** O sino do Fluxo: conexão perdida (crítico) ou sincronização falhando há mais de um dia. */
  alertas(): Alerta[] {
    const e = this.cofre.estado();
    if (e.precisaReconectar && this.cofre.cliente()) {
      return [{
        id: 'google:reconectar', gravidade: 'CRITICO', titulo: 'Google Agenda desconectado',
        detalhe: 'O Google parou de aceitar a autorização do Fluxo. Conecte de novo para voltar a receber os avisos de vencimento.',
        destino: '/ajustes#google',
      }];
    }
    if (!e.erro || !this.cofre.token()) return [];
    const ultima = e.ultimaSincronizacao ? new Date(e.ultimaSincronizacao).getTime() : 0;
    if (this.relogio.agora().getTime() - ultima < RECONCILIAR_A_CADA_MS) return [];
    return [{ id: 'google:erro', gravidade: 'ATENCAO', titulo: 'Google Agenda sem atualizar', detalhe: e.erro, destino: '/ajustes#google' }];
  }

  /** Só para os testes. */
  estadoInterno(): EstadoGoogle {
    return this.cofre.estado();
  }
}
