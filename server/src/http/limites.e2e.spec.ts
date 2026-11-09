import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';

const TOKEN = 'token-de-teste-limites';
const HOST = '127.0.0.1:8778';

describe('limites por minuto', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.CAMINHO_BANCO = ':memory:';
    process.env.FLUXO_SEM_AUTOMACAO = '1';
    process.env.PASTA_WEB = '/nao/existe';
    process.env.FLUXO_SESSAO = TOKEN;
    process.env.PLUGGY_CLIENT_ID = '';
    process.env.PLUGGY_CLIENT_SECRET = '';
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('aprovar em rajada para em 30 por minuto (429), sem derrubar o resto da API', async () => {
    const aprovar = () => request(app.getHttpServer()).post('/api/assistente/propostas/nao-existe/aprovar').set('Host', HOST).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    const status: number[] = [];
    for (let i = 0; i < 31; i++) status.push((await aprovar()).status);
    expect(status.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(status[30]).toBe(429);
    const leitura = await request(app.getHttpServer()).get('/api/estado').set('Host', HOST).set('x-fluxo-sessao', TOKEN);
    expect(leitura.status).toBe(200);
  });
});
