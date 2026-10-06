import { ApiAgenda, ErroAgenda, URL_AGENDA } from './agenda-api';
import { GoogleFalso } from './testing/google-falso';

function montar(google = new GoogleFalso()) {
  const esperas: number[] = [];
  let tokens = 0;
  const api = new ApiAgenda(google.fetch, {
    tokenDeAcesso: async () => `acesso-${++tokens}`,
    descartarToken: vi.fn(),
    esperar: async (ms) => {
      esperas.push(ms);
    },
    intervaloMs: 0,
  });
  return { api, google, esperas, tokens: () => tokens };
}

const erroGoogle = (status: number, reason: string, cabecalhos: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ error: { code: status, errors: [{ reason }] } }), { status, headers: { 'Content-Type': 'application/json', ...cabecalhos } });

describe('ApiAgenda (fetch falso)', () => {
  it('cria a agenda "Fluxo" no fuso de São Paulo, com o token no cabeçalho, e confere se ela existe', async () => {
    const { api, google } = montar();
    const id = await api.criarAgenda();
    expect(google.chamadas[0]).toMatchObject({
      metodo: 'POST', url: `${URL_AGENDA}/calendars`, corpo: { summary: 'Fluxo', timeZone: 'America/Sao_Paulo' },
      cabecalhos: { authorization: 'Bearer acesso-1' },
    });
    expect(await api.existeAgenda(id)).toBe(true);
    expect(await api.existeAgenda('sumiu@group.calendar.google.com')).toBe(false);
    expect(google.chamadas.at(-1)!.url).toBe(`${URL_AGENDA}/calendars/sumiu%40group.calendar.google.com?fields=id`);
  });

  it('401: descarta o token, renova e tenta de novo uma vez; o segundo 401 vira erro de autorização', async () => {
    const { api, google, tokens } = montar();
    const id = await api.criarAgenda();
    google.forcar('/events', () => new Response('{}', { status: 401 }));
    await expect(api.inserirEvento(id, {} as never)).resolves.toMatch(/^evento/);
    expect(tokens()).toBe(3);
    google.forcar('/events', () => new Response('{}', { status: 401 }));
    google.forcar('/events', () => new Response('{}', { status: 401 }));
    await expect(api.inserirEvento(id, {} as never)).rejects.toMatchObject({ motivo: 'autorizacao', status: 401 });
  });

  it('429 espera (Retry-After quando vem, senão 1 s, 2 s, 4 s) e desiste na 4ª, com erro passageiro', async () => {
    const { api, google, esperas } = montar();
    const id = await api.criarAgenda();
    google.forcar('/events', erroGoogle(429, 'rateLimitExceeded', { 'Retry-After': '7' }));
    google.forcar('/events', erroGoogle(403, 'userRateLimitExceeded'));
    await expect(api.inserirEvento(id, {} as never)).resolves.toMatch(/^evento/);
    expect(esperas).toEqual([7000, 2000]);
    for (let i = 0; i < 4; i++) google.forcar('/events', erroGoogle(429, 'rateLimitExceeded'));
    const erro = await api.inserirEvento(id, {} as never).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroAgenda);
    expect(erro).toMatchObject({ motivo: 'limite', passageiro: true });
    expect(esperas.slice(2)).toEqual([1000, 2000, 4000]);
  });

  it('5xx tenta de novo; API desativada e falta de escopo viram mensagens claras (não passageiras)', async () => {
    const { api, google } = montar();
    const id = await api.criarAgenda();
    google.forcar('/events', () => new Response('<html>', { status: 503 }));
    await expect(api.inserirEvento(id, {} as never)).resolves.toMatch(/^evento/);
    google.forcar('/events', erroGoogle(403, 'accessNotConfigured'));
    await expect(api.inserirEvento(id, {} as never)).rejects.toMatchObject({ motivo: 'api-desativada', passageiro: false, message: expect.stringMatching(/Calendar API/) });
    google.forcar('/events', erroGoogle(403, 'insufficientPermissions'));
    await expect(api.inserirEvento(id, {} as never)).rejects.toMatchObject({ motivo: 'escopo' });
    google.forcar('/events', erroGoogle(400, 'invalid'));
    await expect(api.inserirEvento(id, {} as never)).rejects.toMatchObject({ motivo: 'outro', message: expect.stringContaining('invalid') });
  });

  it('sem rede: erro de rede passageiro', async () => {
    const { api, google } = montar();
    google.redeFora = true;
    await expect(api.criarAgenda()).rejects.toMatchObject({ motivo: 'rede', passageiro: true });
  });

  it('atualizar devolve false e apagar não reclama quando o evento já não existe', async () => {
    const { api, google } = montar();
    const id = await api.criarAgenda();
    const ev = await api.inserirEvento(id, { extendedProperties: { private: { fluxo: '1', fluxoChave: 'a' } } } as never);
    expect(await api.atualizarEvento(id, ev, { summary: 'novo' } as never)).toBe(true);
    await api.apagarEvento(id, ev);
    await expect(api.apagarEvento(id, ev)).resolves.toBeUndefined();
    expect(await api.atualizarEvento(id, ev, {} as never)).toBe(false);
    expect(google.eventosDe(id)).toEqual([]);
  });

  it('lista só os eventos marcados pelo Fluxo, seguindo as páginas', async () => {
    const { api, google } = montar();
    const id = await api.criarAgenda();
    google.forcar('/events?', () => Response.json({ items: [{ id: 'e1', extendedProperties: { private: { fluxoChave: 'a', fluxoHash: 'h1' } } }, { id: 'e2' }], nextPageToken: 'p2' }));
    google.forcar('/events?', () => Response.json({ items: [{ id: 'e3', extendedProperties: { private: { fluxoChave: 'b' } } }] }));
    expect(await api.listarEventos(id)).toEqual([{ id: 'e1', chave: 'a', hash: 'h1' }, { id: 'e3', chave: 'b', hash: null }]);
    const urls = google.chamadas.filter((c) => c.url.includes('/events?')).map((c) => new URL(c.url).searchParams);
    expect(urls[0]!.get('privateExtendedProperty')).toBe('fluxo=1');
    expect(urls[1]!.get('pageToken')).toBe('p2');
  });
});
