import type { CorpoDoEvento } from './eventos';
import { FUSO } from './eventos';
import type { Buscar } from './oauth';

/** Endereço fixo da Calendar API v3. Ids só entram no caminho depois de `encodeURIComponent`. */
export const URL_AGENDA = 'https://www.googleapis.com/calendar/v3';

export const NOME_DA_AGENDA = 'Fluxo';

export type MotivoAgenda = 'autorizacao' | 'escopo' | 'api-desativada' | 'limite' | 'rede' | 'outro';

/** Falha ao falar com o Google Agenda. A mensagem já é para a pessoa ler (nunca traz token nem corpo de requisição). */
export class ErroAgenda extends Error {
  constructor(readonly motivo: MotivoAgenda, mensagem: string, readonly status = 0) {
    super(mensagem);
  }

  /** Vale tentar sozinho mais tarde (rede, limite, instabilidade do Google). */
  get passageiro(): boolean {
    return this.motivo === 'rede' || this.motivo === 'limite' || (this.motivo === 'outro' && this.status >= 500);
  }
}

export interface EventoRemoto {
  id: string;
  chave: string;
  hash: string | null;
}

interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

export interface OpcoesApiAgenda {
  /** Token de acesso válido (renova sozinho quando precisa). */
  tokenDeAcesso: () => Promise<string>;
  /** Esquece o token em memória: o próximo `tokenDeAcesso` renova. */
  descartarToken: () => void;
  /** Pausa entre tentativas e entre chamadas (os testes passam uma que não espera). */
  esperar?: (ms: number) => Promise<void>;
  /** Folga entre chamadas seguidas, para não esbarrar no limite por usuário. */
  intervaloMs?: number;
}

const TENTATIVAS = 4;
const ESPERA_BASE_MS = 1000;
const ESPERA_MAXIMA_MS = 30_000;
const TEMPO_LIMITE_MS = 20_000;
const esperarDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** O motivo que o Google escreveu: `error.errors[0].reason` (v3) ou `error.details[].reason`/`error.status`. */
function motivoDoGoogle(corpo: Record<string, unknown>): string {
  const erro = (corpo.error ?? {}) as { errors?: { reason?: string }[]; details?: { reason?: string }[]; status?: string };
  return erro.errors?.[0]?.reason ?? erro.details?.find((d) => d.reason)?.reason ?? erro.status ?? '';
}

const LIMITE = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED/;
const API_DESATIVADA = /accessNotConfigured|SERVICE_DISABLED/;
const SEM_ESCOPO = /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/;

/**
 * A Calendar API v3 com `fetch` puro. Uma chamada por vez (quem chama é
 * sequencial), com folga entre elas; 401 renova o token e tenta de novo uma
 * vez; 429/403 de limite e 5xx esperam (respeitando o Retry-After) e tentam de novo.
 */
export class ApiAgenda {
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly intervaloMs: number;
  private ultimaChamada = 0;

  constructor(private readonly buscar: Buscar, private readonly opcoes: OpcoesApiAgenda) {
    this.esperar = opcoes.esperar ?? esperarDeVerdade;
    this.intervaloMs = opcoes.intervaloMs ?? 120;
  }

  private async umaVez(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta & { tentarEm: number | null }> {
    const folga = this.ultimaChamada + this.intervaloMs - Date.now();
    if (folga > 0) await this.esperar(folga);
    this.ultimaChamada = Date.now();
    const token = await this.opcoes.tokenDeAcesso();
    let r: Response;
    try {
      r = await this.buscar(`${URL_AGENDA}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch (e) {
      const nome = (e as { name?: string })?.name;
      throw new ErroAgenda('rede', nome === 'TimeoutError' ? 'O Google Agenda demorou demais para responder.' : 'Sem conexão com o Google Agenda. Confira a internet.');
    }
    const texto = r.status === 204 ? '' : await r.text().catch(() => '');
    let json: Record<string, unknown> = {};
    try {
      json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    } catch {
      // corpo que não é JSON (página de erro de proxy): fica vazio
    }
    const segundos = Number(r.headers.get('retry-after'));
    return { status: r.status, corpo: json, tentarEm: Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : null };
  }

  /** Faz a chamada com as regras de nova tentativa. Devolve a resposta (2xx, 404 ou 410); o resto vira ErroAgenda. */
  private async pedir(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
    let renovou = false;
    for (let tentativa = 1; ; tentativa++) {
      const r = await this.umaVez(metodo, caminho, corpo);
      if ((r.status >= 200 && r.status < 300) || r.status === 404 || r.status === 410) return r;
      const motivo = motivoDoGoogle(r.corpo);
      if (r.status === 401) {
        if (!renovou) {
          renovou = true;
          this.opcoes.descartarToken();
          continue;
        }
        throw new ErroAgenda('autorizacao', 'O Google não aceitou mais o acesso. Conecte de novo em Ajustes.', 401);
      }
      if (r.status === 403 && API_DESATIVADA.test(motivo)) {
        throw new ErroAgenda('api-desativada', 'A Google Calendar API está desativada no seu projeto do Google Cloud. Ative-a (passo 2 do guia) e sincronize de novo.', 403);
      }
      if (r.status === 403 && SEM_ESCOPO.test(motivo)) {
        throw new ErroAgenda('escopo', 'Falta a permissão da agenda. Conecte de novo e deixe marcada a opção do Google Agenda.', 403);
      }
      const limite = r.status === 429 || (r.status === 403 && LIMITE.test(motivo));
      if ((limite || r.status >= 500) && tentativa < TENTATIVAS) {
        await this.esperar(Math.min(r.tentarEm ?? ESPERA_BASE_MS * 2 ** (tentativa - 1), ESPERA_MAXIMA_MS));
        continue;
      }
      if (limite) throw new ErroAgenda('limite', 'O Google pediu para ir mais devagar. O Fluxo tenta de novo sozinho em alguns minutos.', r.status);
      if (r.status >= 500) throw new ErroAgenda('outro', 'O Google Agenda está instável agora. O Fluxo tenta de novo sozinho.', r.status);
      throw new ErroAgenda('outro', `O Google Agenda recusou o pedido (${motivo || `HTTP ${r.status}`}).`, r.status);
    }
  }

  private agenda(id: string): string {
    return `/calendars/${encodeURIComponent(id)}`;
  }

  /** A agenda existe? (A pessoa pode ter apagado a "Fluxo" no Google.) */
  async existeAgenda(id: string): Promise<boolean> {
    const r = await this.pedir('GET', `${this.agenda(id)}?fields=id`);
    return r.status !== 404 && r.status !== 410;
  }

  async criarAgenda(): Promise<string> {
    const r = await this.pedir('POST', '/calendars', {
      summary: NOME_DA_AGENDA,
      description: 'Vencimentos do cartão, contas a pagar e alertas de atraso, mantidos pelo app Fluxo (finanças pessoais).',
      timeZone: FUSO,
    });
    if (typeof r.corpo.id !== 'string') throw new ErroAgenda('outro', 'O Google não devolveu o id da agenda criada.', r.status);
    return r.corpo.id;
  }

  async apagarAgenda(id: string): Promise<void> {
    await this.pedir('DELETE', this.agenda(id));
  }

  /** Só os eventos criados pelo Fluxo (marcados com `fluxo=1`): o que a pessoa puser à mão na agenda não é tocado. */
  async listarEventos(agendaId: string): Promise<EventoRemoto[]> {
    const eventos: EventoRemoto[] = [];
    let pagina: string | undefined;
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({
        privateExtendedProperty: 'fluxo=1',
        showDeleted: 'false',
        maxResults: '2500',
        fields: 'items(id,extendedProperties/private),nextPageToken',
        ...(pagina ? { pageToken: pagina } : {}),
      });
      const r = await this.pedir('GET', `${this.agenda(agendaId)}/events?${q.toString()}`);
      if (r.status === 404 || r.status === 410) throw new ErroAgenda('outro', 'A agenda "Fluxo" sumiu durante a sincronização.', r.status);
      const itens = Array.isArray(r.corpo.items) ? (r.corpo.items as { id?: unknown; extendedProperties?: { private?: Record<string, unknown> } }[]) : [];
      for (const e of itens) {
        const privado = e.extendedProperties?.private ?? {};
        if (typeof e.id === 'string' && typeof privado.fluxoChave === 'string') {
          eventos.push({ id: e.id, chave: privado.fluxoChave, hash: typeof privado.fluxoHash === 'string' ? privado.fluxoHash : null });
        }
      }
      pagina = typeof r.corpo.nextPageToken === 'string' ? r.corpo.nextPageToken : undefined;
      if (!pagina) break;
    }
    return eventos;
  }

  async inserirEvento(agendaId: string, corpo: CorpoDoEvento): Promise<string> {
    const r = await this.pedir('POST', `${this.agenda(agendaId)}/events?fields=id`, corpo);
    if (r.status === 404 || r.status === 410) throw new ErroAgenda('outro', 'A agenda "Fluxo" sumiu durante a sincronização.', r.status);
    if (typeof r.corpo.id !== 'string') throw new ErroAgenda('outro', 'O Google não devolveu o id do evento criado.', r.status);
    return r.corpo.id;
  }

  /** Substitui o evento inteiro (PUT): o que saiu do corpo — uma cor, um lembrete — sai do Google também. `false` = o evento não existe mais. */
  async atualizarEvento(agendaId: string, id: string, corpo: CorpoDoEvento): Promise<boolean> {
    const r = await this.pedir('PUT', `${this.agenda(agendaId)}/events/${encodeURIComponent(id)}?fields=id`, corpo);
    return r.status !== 404 && r.status !== 410;
  }

  /** Apagar o que já não existe (404/410) conta como apagado. */
  async apagarEvento(agendaId: string, id: string): Promise<void> {
    await this.pedir('DELETE', `${this.agenda(agendaId)}/events/${encodeURIComponent(id)}`);
  }
}
