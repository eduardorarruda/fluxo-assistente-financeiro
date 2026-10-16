import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { RELOGIO, relogioFixo } from './relogio';

const HOST = '127.0.0.1:8778';
const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';

interface Aviso { id: string; gravidade: string; titulo: string }

describe('Avisos dispensados (ponta a ponta, demonstração)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', HOST).set('x-fluxo-sessao', TOKEN);
  const post = (url: string, corpo?: object) => {
    const r = api().post(url).set('Host', HOST).set('Origin', `http://${HOST}`).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };
  const avisos = async () => (await get('/api/alertas').expect(200)).body as Aviso[];

  beforeAll(async () => {
    process.env.CAMINHO_BANCO = ':memory:';
    process.env.FLUXO_SEM_AUTOMACAO = '1';
    process.env.PASTA_WEB = '/nao/existe';
    process.env.FLUXO_SESSAO = TOKEN;
    process.env.PLUGGY_CLIENT_ID = '';
    process.env.PLUGGY_CLIENT_SECRET = '';
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RELOGIO)
      .useValue(relogioFixo('2026-09-24'))
      .compile();
    app = modulo.createNestApplication();
    await app.init();
    await post('/api/demonstracao').expect(201);
    // Uma conta atrasada garante mais de um aviso, sem depender do que a demonstração gera na data.
    await post('/api/contas-a-pagar').send({ descricao: 'Condomínio', valor: 65000, vencimento: '2026-09-10' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a demonstração tem avisos para dispensar', async () => {
    expect((await avisos()).length).toBeGreaterThanOrEqual(2);
  });

  it('dispensar esconde o aviso do sino e da visão geral, e conta quantos estão escondidos', async () => {
    const [primeiro, ...resto] = await avisos();
    const r = await post('/api/alertas/dispensar', { ids: [primeiro!.id, 'inventado:nao-existe'] }).expect(200);
    expect(r.body).toEqual({ alertas: resto, dispensados: 1 });
    expect(await avisos()).toEqual(resto);
    const v = (await get('/api/visao-geral').expect(200)).body as { alertas: Aviso[]; alertasDispensados: number };
    expect(v.alertas).toEqual(resto);
    expect(v.alertasDispensados).toBe(1);
  });

  it('marcar todos como vistos e mostrar os dispensados de novo', async () => {
    const r = await post('/api/alertas/dispensar-todos').expect(200);
    expect(r.body.alertas).toEqual([]);
    expect(r.body.dispensados).toBeGreaterThanOrEqual(2);
    expect(await avisos()).toEqual([]);
    const volta = await post('/api/alertas/restaurar').expect(200);
    expect(volta.body.dispensados).toBe(0);
    expect((await avisos()).length).toBe(r.body.dispensados);
  });

  it('valida o corpo: ids obrigatórios, lista de texto, nada além disso (a gravidade é do servidor)', async () => {
    await post('/api/alertas/dispensar', {}).expect(400);
    await post('/api/alertas/dispensar', { ids: [] }).expect(400);
    await post('/api/alertas/dispensar', { ids: [123] }).expect(400);
    await post('/api/alertas/dispensar', { ids: ['x'.repeat(301)] }).expect(400);
    await post('/api/alertas/dispensar', { ids: Array.from({ length: 201 }, (_, i) => `a:${i}`) }).expect(400);
    const [aviso] = await avisos();
    await post('/api/alertas/dispensar', { ids: [aviso!.id], gravidade: 'INFO' }).expect(400);
  });

  it('escrita sem X-Fluxo ou sem sessão é recusada', async () => {
    const [aviso] = await avisos();
    for (const rota of ['dispensar', 'dispensar-todos', 'restaurar']) {
      const semCabecalho = await api().post(`/api/alertas/${rota}`).set('Host', HOST).set('x-fluxo-sessao', TOKEN).send({ ids: [aviso!.id] });
      expect(semCabecalho.status).toBe(403);
      const semSessao = await api().post(`/api/alertas/${rota}`).set('Host', HOST).set('X-Fluxo', '1').send({ ids: [aviso!.id] });
      expect(semSessao.status).toBe(401);
    }
    expect(await avisos()).toContainEqual(aviso);
  });
});
