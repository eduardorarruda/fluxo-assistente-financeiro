import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ClienteOAuth } from './cofre-google';

/**
 * OAuth 2.0 para apps instalados (RFC 8252): redirecionamento para o próprio
 * Fluxo em 127.0.0.1 (loopback), PKCE S256 e `state` de uso único.
 * Endereços fixos do Google — nada aqui monta URL a partir de entrada externa.
 */

export const URL_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
export const URL_TOKEN = 'https://oauth2.googleapis.com/token';
export const URL_REVOGAR = 'https://oauth2.googleapis.com/revoke';

/**
 * Cria agendas secundárias e mexe SÓ nelas e nos eventos delas — o Fluxo não
 * enxerga nem altera a agenda principal nem outras agendas da pessoa.
 */
export const ESCOPO_AGENDA = 'https://www.googleapis.com/auth/calendar.app.created';
/** `openid email`: só para mostrar em Ajustes com qual conta o Fluxo está conectado. */
export const ESCOPOS = ['openid', 'email', ESCOPO_AGENDA] as const;

/** Tempo para a pessoa terminar o consentimento no Google. */
export const VALIDADE_DO_PEDIDO_MS = 10 * 60 * 1000;
/** Pedidos de conexão abertos ao mesmo tempo (cliques repetidos em "Conectar"). */
const MAXIMO_DE_PEDIDOS = 5;

export type Buscar = typeof fetch;

export function gerarPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(48).toString('base64url'); // 64 caracteres, dentro de 43…128
  return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') };
}

interface Pedido {
  estado: string;
  verificador: string;
  clientId: string;
  criadoEm: number;
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Os pedidos de conexão em aberto. O `state` volta do Google na URL de
 * retorno e é o que autentica essa chamada (o cookie da sessão não vem, ver
 * docs/GOOGLE-AGENDA.md): aleatório (256 bits), preso ao verificador PKCE e
 * ao client ID daquele momento, vale 10 minutos e serve uma vez só.
 */
export class PedidosDeConexao {
  private pedidos: Pedido[] = [];

  constructor(private readonly agora: () => number = Date.now) {}

  criar(clientId: string): { estado: string; desafio: string } {
    const { verificador, desafio } = gerarPkce();
    const estado = randomBytes(32).toString('base64url');
    this.pedidos = [...this.vigentes(), { estado, verificador, clientId, criadoEm: this.agora() }].slice(-MAXIMO_DE_PEDIDOS);
    return { estado, desafio };
  }

  private vigentes(): Pedido[] {
    const limite = this.agora() - VALIDADE_DO_PEDIDO_MS;
    return this.pedidos.filter((p) => p.criadoEm > limite);
  }

  private achar(estado: unknown): Pedido | undefined {
    if (typeof estado !== 'string' || estado.length < 20 || estado.length > 100) return undefined;
    return this.vigentes().find((p) => iguais(p.estado, estado));
  }

  /** Só confere (a Seguranca deixa passar); quem consome é o retorno. */
  valido(estado: unknown): boolean {
    return this.achar(estado) !== undefined;
  }

  /** Tira o pedido da lista: a mesma URL de retorno não serve duas vezes. */
  consumir(estado: unknown): { verificador: string; clientId: string } | null {
    const pedido = this.achar(estado);
    if (!pedido) return null;
    this.pedidos = this.pedidos.filter((p) => p !== pedido);
    return { verificador: pedido.verificador, clientId: pedido.clientId };
  }

  limpar(): void {
    this.pedidos = [];
  }
}

export function urlDeAutorizacao(p: { clientId: string; redirectUri: string; estado: string; desafio: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: ESCOPOS.join(' '),
    state: p.estado,
    code_challenge: p.desafio,
    code_challenge_method: 'S256',
    // offline + consent: o Google só entrega o refresh token assim (e entrega de novo a cada reconexão).
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${URL_AUTORIZACAO}?${q.toString()}`;
}

export type MotivoOAuth = 'concessao-invalida' | 'cliente-invalido' | 'rede' | 'recusado' | 'outro';

/** Falha ao falar com o servidor de autorização. A mensagem já é para a pessoa ler. */
export class ErroOAuth extends Error {
  constructor(readonly motivo: MotivoOAuth, mensagem: string, readonly status = 0) {
    super(mensagem);
  }
}

export interface RespostaDeToken {
  acesso: string;
  expiraEmMs: number;
  refreshToken: string | null;
  escopos: string[];
  email: string | null;
}

/** E-mail do id_token. Veio direto do endpoint de token do Google por TLS: não precisa conferir assinatura (OIDC §3.1.3.7). */
export function emailDoIdToken(idToken: unknown, clientId?: string): string | null {
  if (typeof idToken !== 'string') return null;
  const partes = idToken.split('.');
  if (partes.length !== 3) return null;
  try {
    const corpo = JSON.parse(Buffer.from(partes[1]!, 'base64url').toString('utf8')) as { email?: unknown; email_verified?: unknown; aud?: unknown };
    if (clientId && corpo.aud !== undefined && corpo.aud !== clientId) return null;
    return typeof corpo.email === 'string' && corpo.email.length <= 320 && corpo.email_verified !== false ? corpo.email : null;
  } catch {
    return null;
  }
}

function erroDeRede(e: unknown): ErroOAuth {
  const nome = (e as { name?: string })?.name;
  return new ErroOAuth('rede', nome === 'TimeoutError' ? 'O Google demorou demais para responder. Tente de novo.' : 'Sem conexão com o Google. Confira a internet e tente de novo.');
}

const TEMPO_LIMITE_MS = 20_000;

/** As três conversas com o servidor de autorização: trocar o código, renovar o acesso e revogar. */
export class ClienteOAuthGoogle {
  constructor(private readonly buscar: Buscar) {}

  private async postar(url: string, campos: Record<string, string>): Promise<{ status: number; corpo: Record<string, unknown> }> {
    let resposta: Response;
    try {
      resposta = await this.buscar(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(campos).toString(),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch (e) {
      throw erroDeRede(e);
    }
    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: resposta.status, corpo };
  }

  private falha(status: number, corpo: Record<string, unknown>): ErroOAuth {
    const codigo = typeof corpo.error === 'string' ? corpo.error : '';
    if (codigo === 'invalid_grant') {
      return new ErroOAuth('concessao-invalida', 'O Google não aceitou mais a autorização (ela expirou ou foi revogada). Conecte de novo.', status);
    }
    if (codigo === 'invalid_client' || codigo === 'unauthorized_client') {
      return new ErroOAuth('cliente-invalido', 'O Google recusou o client ID ou o client secret. Confira as credenciais coladas em Ajustes.', status);
    }
    if (status >= 500) return new ErroOAuth('rede', 'O Google está com problemas agora. Tente de novo em alguns minutos.', status);
    return new ErroOAuth('outro', `O Google recusou o pedido (${codigo || `HTTP ${status}`}).`, status);
  }

  private lerToken(corpo: Record<string, unknown>, agora: number, clientId: string): RespostaDeToken {
    if (typeof corpo.access_token !== 'string') throw new ErroOAuth('outro', 'O Google respondeu sem o token de acesso.');
    const segundos = typeof corpo.expires_in === 'number' ? corpo.expires_in : 3600;
    return {
      acesso: corpo.access_token,
      expiraEmMs: agora + segundos * 1000,
      refreshToken: typeof corpo.refresh_token === 'string' ? corpo.refresh_token : null,
      escopos: typeof corpo.scope === 'string' ? corpo.scope.split(' ').filter(Boolean) : [],
      email: emailDoIdToken(corpo.id_token, clientId),
    };
  }

  async trocarCodigo(cliente: ClienteOAuth, p: { codigo: string; verificador: string; redirectUri: string }, agora = Date.now()): Promise<RespostaDeToken> {
    const { status, corpo } = await this.postar(URL_TOKEN, {
      grant_type: 'authorization_code',
      code: p.codigo,
      code_verifier: p.verificador,
      redirect_uri: p.redirectUri,
      client_id: cliente.clientId,
      client_secret: cliente.clientSecret,
    });
    if (status !== 200) throw this.falha(status, corpo);
    return this.lerToken(corpo, agora, cliente.clientId);
  }

  async renovar(cliente: ClienteOAuth, refreshToken: string, agora = Date.now()): Promise<RespostaDeToken> {
    const { status, corpo } = await this.postar(URL_TOKEN, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cliente.clientId,
      client_secret: cliente.clientSecret,
    });
    if (status !== 200) throw this.falha(status, corpo);
    return this.lerToken(corpo, agora, cliente.clientId);
  }

  /** Revoga no Google. Token que o Google já não conhece (400) conta como revogado. */
  async revogar(token: string): Promise<void> {
    const { status, corpo } = await this.postar(URL_REVOGAR, { token });
    if (status === 200 || (status === 400 && corpo.error === 'invalid_token')) return;
    throw this.falha(status, corpo);
  }
}
