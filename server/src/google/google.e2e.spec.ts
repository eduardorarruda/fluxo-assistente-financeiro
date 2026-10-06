import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { RELOGIO, relogioFixo } from '../relogio';
import { URL_AGENDA } from './agenda-api';
import { URL_REVOGAR } from './oauth';
import { ESPERA_GOOGLE, FETCH_GOOGLE, ServicoGoogle } from './servico-google';
import { CLIENT_ID, CLIENT_SECRET, EMAIL, GoogleFalso, REFRESH } from './testing/google-falso';

const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';
const PORTA = 8779;
const HOST = `127.0.0.1:${PORTA}`;

describe('Google Agenda (HTTP, Google falso)', () => {
  let app: INestApplication;
  let pasta: string;
  const google = new GoogleFalso();
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', HOST).set('x-fluxo-sessao', TOKEN);
  const semSessao = (url: string) => api().get(url).set('Host', HOST);
  const enviar = (metodo: 'post' | 'put' | 'delete', url: string, corpo?: object) => {
    const r = api()[metodo](url).set('Host', HOST).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };
  const servico = () => app.get(ServicoGoogle);
  /** A sincronização disparada pela conexão roda em segundo plano: espera ela (e as enfileiradas) acabarem. */
  const aguardarSincronia = async () => {
    for (let i = 0; i < 200 && servico().estado().sincronizando; i++) await new Promise((r) => setTimeout(r, 10));
  };
  const conectar = async () => {
    const { body } = await enviar('post', '/api/google/conectar').expect(200);
    const estado = new URL(body.url).searchParams.get('state')!;
    const r = await semSessao(`/api/google/retorno?state=${estado}&code=codigo-do-google&scope=x`);
    await aguardarSincronia();
    return { estado, r };
  };

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-google-e2e-'));
    Object.assign(process.env, {
      CAMINHO_BANCO: ':memory:', PASTA_WEB: '/nao/existe', FLUXO_SESSAO: TOKEN, FLUXO_SEM_AUTOMACAO: '1', PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
      PORTA: String(PORTA), PASTA_ASSISTENTE: join(pasta, 'assistente'), PASTA_MODELOS: join(pasta, 'modelos'), PASTA_GOOGLE: join(pasta, 'google'),
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RELOGIO).useValue(relogioFixo('2026-10-02'))
      .overrideProvider(FETCH_GOOGLE).useValue(google.fetch)
      .overrideProvider(ESPERA_GOOGLE).useValue(async () => undefined)
      .compile();
    app = modulo.createNestApplication();
    await app.init();
    await enviar('post', '/api/demonstracao').expect(201);
    await enviar('post', '/api/contas-a-pagar', { descricao: 'Energia', valor: 15000, vencimento: '2026-10-15' }).expect(201);
    await enviar('post', '/api/contas-a-pagar', { descricao: 'Internet', valor: 9990, vencimento: '2026-09-25' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    rmSync(pasta, { recursive: true, force: true });
    delete process.env.PASTA_GOOGLE;
  });

  it('começa sem credenciais e com as preferências padrão', async () => {
    const r = await get('/api/google/estado').expect(200);
    expect(r.body).toMatchObject({
      configurado: false, conectado: false, clienteId: null, email: null, eventos: 0, erro: null,
      enderecoDeRetorno: `http://127.0.0.1:${PORTA}/api/google/retorno`, contasDisponiveis: true,
      preferencias: { cartao: true, contas: true, atrasos: true, hora: 9, antecedencias: [2, 1] },
    });
    await enviar('post', '/api/google/conectar').expect(400);
  });

  it('credenciais: formato errado é recusado sem repetir o valor; certas ficam em arquivo 0600 e nunca voltam', async () => {
    const ruim = await enviar('put', '/api/google/cliente', { clientId: 'meu-id', clientSecret: 'segredo com espaço' }).expect(400);
    expect(ruim.body.erro).toMatch(/client ID do Google/);
    expect(ruim.text).not.toContain('segredo com espaço');
    const r = await enviar('put', '/api/google/cliente', { clientId: ` ${CLIENT_ID} `, clientSecret: CLIENT_SECRET }).expect(200);
    expect(r.body).toMatchObject({ configurado: true, conectado: false, clienteId: '123456…apps.googleusercontent.com' });
    expect(r.text).not.toContain(CLIENT_SECRET);
    expect(statSync(join(pasta, 'google')).mode & 0o777).toBe(0o700);
    expect(statSync(join(pasta, 'google', 'cliente.json')).mode & 0o777).toBe(0o600);
  });

  it('as rotas do Google exigem a sessão; o retorno só passa sem ela com um state em aberto', async () => {
    await semSessao('/api/google/estado').expect(401);
    await api().post('/api/google/conectar').set('Host', HOST).set('X-Fluxo', '1').expect(401);
    await semSessao('/api/google/retorno?state=chute-qualquer-com-tamanho-suficiente&code=x').expect(401);
    await semSessao('/api/google/retorno').expect(401);
    await api().get('/api/google/retorno?state=x').set('Host', 'evil.example:8779').expect(403);
  });

  it('conecta: PKCE + state, callback sem cookie mostra a página de sucesso com CSP própria, e o state não serve duas vezes', async () => {
    const { body } = await enviar('post', '/api/google/conectar').expect(200);
    const url = new URL(body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${PORTA}/api/google/retorno`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const estado = url.searchParams.get('state')!;
    // Outro state em aberto não autoriza este estado inventado; uma rota vizinha não ganha a exceção.
    await semSessao(`/api/google/estado?state=${estado}`).expect(401);
    await semSessao(`/api/google/retorno/?state=${estado}&code=codigo-do-google`).expect(401);
    await semSessao(`/api/google/retorno?state=${estado}&state=${estado}&code=codigo-do-google`).expect(401);
    await api().head(`/api/google/retorno?state=${estado}&code=codigo-do-google`).set('Host', HOST).expect(401);

    const r = await semSessao(`/api/google/retorno?state=${estado}&code=codigo-do-google`).expect(200);
    expect(r.text).toContain('Google Agenda conectado');
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text).not.toContain(REFRESH);
    const troca = google.chamadas.find((c) => (c.corpo as Record<string, string> | undefined)?.grant_type === 'authorization_code');
    expect(troca?.corpo).toMatchObject({ code: 'codigo-do-google', client_id: CLIENT_ID, redirect_uri: `http://127.0.0.1:${PORTA}/api/google/retorno` });
    expect((troca?.corpo as Record<string, string>).code_verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);

    await semSessao(`/api/google/retorno?state=${estado}&code=codigo-do-google`).expect(401);
    // Com a sessão (a pessoa recarregou a janelinha), a página explica em vez de reconectar.
    const repetido = await get(`/api/google/retorno?state=${estado}&code=codigo-do-google`).expect(400);
    expect(repetido.text).toContain('já foi usado ou expirou');

    await aguardarSincronia();
    const e = await get('/api/google/estado').expect(200);
    expect(e.body).toMatchObject({ conectado: true, email: EMAIL, erro: null, precisaReconectar: false });
    expect(e.text).not.toContain(REFRESH);
    expect(e.text).not.toContain(CLIENT_SECRET);
    for (const arquivo of readdirSync(join(pasta, 'google'))) expect(statSync(join(pasta, 'google', arquivo)).mode & 0o777).toBe(0o600);
  });

  it('sincroniza: cria a agenda "Fluxo" e os eventos do cartão e das contas; de novo, só confere a agenda', async () => {
    const e = await enviar('post', '/api/google/sincronizar').expect(200);
    expect(e.body.agendaId).toMatch(/@group\.calendar\.google\.com$/);
    expect(e.body.ultimaSincronizacao).toBeTruthy();
    const eventos = google.eventosDe(e.body.agendaId);
    expect(e.body.eventos).toBe(eventos.length);
    const titulos = eventos.map((x) => String(x.summary));
    expect(titulos).toContain('Pagar: Energia · R$ 150,00');
    expect(titulos).toContain('⚠ Atrasada: Internet · R$ 99,90');
    expect(titulos).toContain('⚠ Em atraso: Internet · R$ 99,90 (venceu 25/09)');
    expect(titulos.some((t) => t.endsWith(': fecha a fatura'))).toBe(true);
    expect(titulos.some((t) => /: vence a fatura|fatura do/.test(t))).toBe(true);

    const antes = google.chamadasDaAgenda().length;
    await servico().sincronizar();
    const novas = google.chamadasDaAgenda().slice(antes);
    expect(novas.map((c) => `${c.metodo} ${c.url.replace(URL_AGENDA, '').split('?')[0]}`)).toEqual([`GET /calendars/${encodeURIComponent(e.body.agendaId)}`]);
  });

  it('conta paga vira "✓ Paga" no mesmo evento (PUT), sem criar outro', async () => {
    const { body: contas } = await get('/api/contas-a-pagar').expect(200);
    const energia = (contas.itens ?? contas).find((c: { descricao: string }) => c.descricao === 'Energia');
    await enviar('post', `/api/contas-a-pagar/${energia.id}/paga`, {}).expect((r) => expect([200, 201]).toContain(r.status));
    const antes = google.chamadasDaAgenda().length;
    await servico().sincronizar();
    const novas = google.chamadasDaAgenda().slice(antes).filter((c) => c.url.includes('/events'));
    expect(novas.map((c) => c.metodo)).toEqual(['PUT']);
    const { agendaId } = servico().estado();
    expect(google.eventosDe(agendaId!).map((x) => x.summary)).toContain('✓ Paga: Energia · R$ 150,00');
  });

  it('preferências: valida, grava e desligar as contas tira os eventos delas na próxima sincronização', async () => {
    await enviar('put', '/api/google/preferencias', { hora: 3 }).expect(400);
    await enviar('put', '/api/google/preferencias', { antecedencias: [4] }).expect(400);
    await enviar('put', '/api/google/preferencias', { outra: true }).expect(400);
    const r = await enviar('put', '/api/google/preferencias', { contas: false, antecedencias: [1, 7, 1] }).expect(200);
    expect(r.body.preferencias).toEqual({ cartao: true, contas: false, atrasos: true, hora: 9, antecedencias: [7, 1] });
    await servico().sincronizar();
    const { agendaId } = servico().estado();
    expect(google.eventosDe(agendaId!).some((x) => String(x.summary).includes('Energia'))).toBe(false);
    await enviar('put', '/api/google/preferencias', { contas: true }).expect(200);
  });

  it('a pessoa apagou a agenda "Fluxo" no Google: a próxima sincronização cria outra e refaz os eventos', async () => {
    const velha = servico().estado().agendaId!;
    google.agendas.delete(velha);
    await servico().sincronizar();
    const nova = servico().estado().agendaId!;
    expect(nova).not.toBe(velha);
    expect(google.eventosDe(nova).length).toBeGreaterThan(3);
  });

  it('sem rede: estado guarda o erro amigável e o servidor segue de pé', async () => {
    google.redeFora = true;
    await enviar('post', '/api/google/sincronizar').expect(200);
    google.redeFora = false;
    const e = await get('/api/google/estado').expect(200);
    expect(e.body.erro).toMatch(/conexão/i);
    expect(e.body.conectado).toBe(true);
    await enviar('post', '/api/google/sincronizar').expect(200);
    expect((await get('/api/google/estado')).body.erro).toBeNull();
  });

  it('refresh token revogado (ou os 7 dias do modo Teste): pede reconexão e aparece no sino do Fluxo', async () => {
    google.refreshValido = false;
    // Força renovar: o token de acesso em memória é descartado por um 401.
    google.forcar('/calendars/', () => new Response('{}', { status: 401 }));
    await enviar('post', '/api/google/sincronizar').expect(200);
    const e = await get('/api/google/estado').expect(200);
    expect(e.body).toMatchObject({ conectado: false, precisaReconectar: true, erro: expect.stringMatching(/Conecte de novo/) });
    expect(existsSync(join(pasta, 'google', 'token.json'))).toBe(false);
    const alertas = await get('/api/alertas').expect(200);
    expect(alertas.body[0]).toMatchObject({ id: 'google:reconectar', gravidade: 'CRITICO', destino: '/ajustes#google' });
    google.refreshValido = true;
    await conectar();
    expect((await get('/api/google/estado')).body).toMatchObject({ conectado: true, precisaReconectar: false, erro: null });
    expect((await get('/api/alertas')).body.some((a: { id: string }) => a.id.startsWith('google:'))).toBe(false);
  });

  it('a pessoa recusou no Google: página explica e nada é conectado', async () => {
    const { body } = await enviar('post', '/api/google/conectar').expect(200);
    const estado = new URL(body.url).searchParams.get('state')!;
    const r = await semSessao(`/api/google/retorno?state=${estado}&error=access_denied`).expect(400);
    expect(r.text).toContain('Você não autorizou o acesso');
  });

  it('desmarcou a permissão da agenda no consentimento granular: recusa e revoga', async () => {
    await enviar('post', '/api/google/desconectar', {}).expect(200);
    google.escoposConcedidos = 'openid https://www.googleapis.com/auth/userinfo.email';
    const { r } = await conectar();
    expect(r.status).toBe(400);
    expect(r.text).toContain('permissão do Google Agenda ficou desmarcada');
    expect(google.chamadas.at(-1)!.url).toBe(URL_REVOGAR);
    expect((await get('/api/google/estado')).body.conectado).toBe(false);
    google.escoposConcedidos = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.app.created';
  });

  it('trocar ou remover credenciais exige desconectar antes; desconectar revoga, apaga a agenda (se pedido) e os arquivos', async () => {
    await conectar();
    await servico().sincronizar();
    const { agendaId } = servico().estado();
    await enviar('put', '/api/google/cliente', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }).expect(409);
    await enviar('delete', '/api/google/cliente').expect(409);
    const r = await enviar('post', '/api/google/desconectar', { apagarAgenda: true }).expect(200);
    expect(r.body).toMatchObject({ conectado: false, configurado: true, email: null, eventos: 0, aviso: null });
    expect(google.agendas.has(agendaId!)).toBe(false);
    expect(google.chamadas.some((c) => c.url === URL_REVOGAR && (c.corpo as Record<string, string>).token === REFRESH)).toBe(true);
    expect(readdirSync(join(pasta, 'google')).sort()).toEqual(['cliente.json', 'estado.json']);
    const removido = await enviar('delete', '/api/google/cliente').expect(200);
    expect(removido.body.configurado).toBe(false);
  });
});
