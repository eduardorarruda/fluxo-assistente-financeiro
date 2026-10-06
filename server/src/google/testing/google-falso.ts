import { URL_AGENDA } from '../agenda-api';
import { URL_REVOGAR, URL_TOKEN } from '../oauth';

/**
 * Um Google de mentira para os testes: o servidor de token e a Calendar API
 * em memória, atrás de um `fetch` falso. Nenhum teste fala com o Google de verdade.
 */

export const CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
export const CLIENT_SECRET = 'GOCSPX-segredo_de_teste-AbCdEf123456';
export const REFRESH = '1//refresh-token-de-teste-bem-comprido';
export const EMAIL = 'pessoa@gmail.com';

export interface Chamada {
  metodo: string;
  url: string;
  corpo: unknown;
  cabecalhos: Record<string, string>;
}

interface EventoFalso {
  id: string;
  corpo: Record<string, unknown>;
  apagado: boolean;
}

function idToken(email: string): string {
  const parte = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${parte({ alg: 'RS256' })}.${parte({ email, email_verified: true })}.assinatura`;
}

const json = (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...cabecalhos } });

export class GoogleFalso {
  readonly chamadas: Chamada[] = [];
  readonly agendas = new Map<string, Map<string, EventoFalso>>();
  /** Respostas forçadas, consumidas em ordem, para a próxima chamada que casar com o trecho de URL. */
  private readonly forcadas: { trecho: string; resposta: () => Response }[] = [];
  refreshValido = true;
  escoposConcedidos = `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.app.created`;
  tokensDeAcesso = 0;
  private proximoId = 1;
  redeFora = false;

  forcar(trecho: string, resposta: () => Response): void {
    this.forcadas.push({ trecho, resposta });
  }

  eventosDe(agendaId: string): Record<string, unknown>[] {
    return [...(this.agendas.get(agendaId)?.values() ?? [])].filter((e) => !e.apagado).map((e) => ({ id: e.id, ...e.corpo }));
  }

  chamadasDaAgenda(): Chamada[] {
    return this.chamadas.filter((c) => c.url.startsWith(URL_AGENDA));
  }

  readonly fetch = (async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(entrada);
    const metodo = init?.method ?? 'GET';
    const texto = typeof init?.body === 'string' ? init.body : '';
    const cabecalhos = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const corpo = cabecalhos['content-type']?.includes('json') && texto ? JSON.parse(texto) : texto ? Object.fromEntries(new URLSearchParams(texto)) : undefined;
    this.chamadas.push({ metodo, url, corpo, cabecalhos });
    if (this.redeFora) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const forcada = this.forcadas.findIndex((f) => url.includes(f.trecho));
    if (forcada >= 0) return this.forcadas.splice(forcada, 1)[0]!.resposta();
    if (url === URL_TOKEN) return this.token(corpo as Record<string, string>);
    if (url === URL_REVOGAR) return json(200, {});
    if (url.startsWith(URL_AGENDA)) return this.agenda(metodo, url.slice(URL_AGENDA.length), corpo as Record<string, unknown> | undefined, cabecalhos);
    return json(404, { error: 'desconhecido' });
  }) as typeof fetch;

  private token(c: Record<string, string>): Response {
    if (c.client_id !== CLIENT_ID || c.client_secret !== CLIENT_SECRET) return json(401, { error: 'invalid_client' });
    if (c.grant_type === 'authorization_code') {
      if (c.code !== 'codigo-do-google' || !c.code_verifier) return json(400, { error: 'invalid_grant' });
      this.tokensDeAcesso++;
      return json(200, { access_token: `acesso-${this.tokensDeAcesso}`, expires_in: 3599, refresh_token: REFRESH, scope: this.escoposConcedidos, id_token: idToken(EMAIL), token_type: 'Bearer' });
    }
    if (c.grant_type === 'refresh_token') {
      if (!this.refreshValido || c.refresh_token !== REFRESH) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      this.tokensDeAcesso++;
      return json(200, { access_token: `acesso-${this.tokensDeAcesso}`, expires_in: 3599, scope: this.escoposConcedidos, token_type: 'Bearer' });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  private agenda(metodo: string, caminho: string, corpo: Record<string, unknown> | undefined, cabecalhos: Record<string, string>): Response {
    if (!cabecalhos.authorization?.startsWith('Bearer acesso-')) return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    const [rota = '', consulta = ''] = caminho.split('?');
    const partes = rota.split('/').filter(Boolean).map(decodeURIComponent);
    if (partes[0] !== 'calendars') return json(404, {});
    if (partes.length === 1 && metodo === 'POST') {
      const id = `agenda${this.proximoId++}@group.calendar.google.com`;
      this.agendas.set(id, new Map());
      return json(200, { id, summary: corpo?.summary });
    }
    const agenda = this.agendas.get(partes[1] ?? '');
    if (!agenda) return json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
    if (partes.length === 2) {
      if (metodo === 'DELETE') {
        this.agendas.delete(partes[1]!);
        return json(204, null);
      }
      return json(200, { id: partes[1] });
    }
    if (partes[2] !== 'events') return json(404, {});
    if (partes.length === 3 && metodo === 'GET') {
      const q = new URLSearchParams(consulta);
      const [chave, valor] = (q.get('privateExtendedProperty') ?? '').split('=');
      const itens = [...agenda.values()]
        .filter((e) => !e.apagado)
        .filter((e) => !chave || (e.corpo.extendedProperties as { private?: Record<string, string> })?.private?.[chave] === valor)
        .map((e) => ({ id: e.id, extendedProperties: e.corpo.extendedProperties }));
      return json(200, { items: itens });
    }
    if (partes.length === 3 && metodo === 'POST') {
      const id = `evento${this.proximoId++}`;
      agenda.set(id, { id, corpo: corpo ?? {}, apagado: false });
      return json(200, { id });
    }
    const evento = agenda.get(partes[3] ?? '');
    if (!evento || evento.apagado) return json(metodo === 'DELETE' && evento ? 410 : 404, { error: { code: 404 } });
    if (metodo === 'PUT') {
      evento.corpo = corpo ?? {};
      return json(200, { id: evento.id });
    }
    if (metodo === 'DELETE') {
      evento.apagado = true;
      return json(204, null);
    }
    return json(200, { id: evento.id, ...evento.corpo });
  }
}
