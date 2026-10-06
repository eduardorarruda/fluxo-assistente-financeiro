import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { vozDoCatalogo } from './catalogo';
import { ServicoDeVoz } from './servico-voz';
import { carregadorFalso, fetchFalso } from './testing/pacote-falso';

const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';

function portaLivre(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const porta = (s.address() as { port: number }).port;
      s.close(() => resolve(porta));
    });
  });
}

describe('Voz natural (HTTP)', () => {
  let app: INestApplication;
  let pasta: string;
  let porta: number;
  const falso = carregadorFalso();
  const rede = fetchFalso({});
  const host = () => `127.0.0.1:${porta}`;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', host()).set('x-fluxo-sessao', TOKEN);
  const enviar = (metodo: 'post' | 'delete', url: string, corpo?: object) => {
    const r = api()[metodo](url).set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-voz-e2e-'));
    porta = await portaLivre();
    Object.assign(process.env, {
      CAMINHO_BANCO: ':memory:', PASTA_WEB: '/nao/existe', FLUXO_SESSAO: TOKEN, PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
      PORTA: String(porta), PASTA_ASSISTENTE: join(pasta, 'assistente'), PASTA_MODELOS: join(pasta, 'modelos'),
    });
    const servico = new ServicoDeVoz(join(pasta, 'modelos'), { carregador: falso.carregador, fetch: rede.fetch });
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ServicoDeVoz).useValue(servico).compile();
    app = modulo.createNestApplication();
    await app.listen(porta, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.PASTA_MODELOS;
    rmSync(pasta, { recursive: true, force: true });
  });

  it('GET lista o catálogo com licença e tamanho; nada instalado', async () => {
    const r = await get('/api/assistente/voz').expect(200);
    expect(r.body).toMatchObject({ instalada: false, baixando: false, progresso: null, vozPadrao: 'faber', erro: null });
    expect(r.body.vozes[0]).toMatchObject({ id: 'faber', nome: 'Faber', genero: 'masculina', qualidade: 'média', tamanhoMb: 64, instalada: false });
    expect(r.body.vozes.find((v: { id: string }) => v.id === 'dii')).toMatchObject({ naoComercial: true, licenca: expect.stringContaining('CC BY-NC-ND') });
  });

  it('exige a sessão, e escrita exige X-Fluxo', async () => {
    await api().get('/api/assistente/voz').set('Host', host()).expect(401);
    await api().post('/api/assistente/voz/falar').set('Host', host()).set('x-fluxo-sessao', TOKEN).send({ texto: 'oi' }).expect(403);
    await api().post('/api/assistente/voz/baixar').set('Host', host()).set('x-fluxo-sessao', TOKEN).send({ voz: 'faber' }).expect(403);
  });

  it('baixar só aceita um id do catálogo (nunca URL) e usa a URL fixa dele', async () => {
    await enviar('post', '/api/assistente/voz/baixar', { voz: 'https://evil.example/x.tar.bz2' }).expect(400);
    await enviar('post', '/api/assistente/voz/baixar', { voz: 'faber', url: 'https://evil.example/x.tar.bz2' }).expect(400);
    await enviar('post', '/api/assistente/voz/baixar', {}).expect(400);
    const r = await enviar('post', '/api/assistente/voz/baixar', { voz: 'faber' }).expect(200);
    expect(r.body).toMatchObject({ baixando: true, vozBaixando: 'faber' });
    await app.get(ServicoDeVoz).esperarDownload();
    expect(rede.pedidas).toEqual([vozDoCatalogo('faber')?.url]);
    const depois = await get('/api/assistente/voz').expect(200);
    expect(depois.body).toMatchObject({ baixando: false, instalada: false, erro: expect.stringContaining('404') });
  });

  it('falar sem voz instalada é 409 com o caminho dos Ajustes', async () => {
    const r = await enviar('post', '/api/assistente/voz/falar', { texto: 'Oi.' }).expect(409);
    expect(r.body.erro).toMatch(/Ajustes/);
  });

  it('falar valida texto, voz e velocidade', async () => {
    await enviar('post', '/api/assistente/voz/falar', { texto: '' }).expect(400);
    await enviar('post', '/api/assistente/voz/falar', { texto: 'a'.repeat(601) }).expect(400);
    await enviar('post', '/api/assistente/voz/falar', { texto: 'oi', voz: '../faber' }).expect(400);
    await enviar('post', '/api/assistente/voz/falar', { texto: 'oi', velocidade: 5 }).expect(400);
    await enviar('post', '/api/assistente/voz/falar', { texto: 'oi', extra: 1 }).expect(400);
  });

  it('com a voz instalada, devolve audio/wav e não ecoa o texto em lugar nenhum', async () => {
    const voz = join(pasta, 'modelos', 'piper', 'faber');
    mkdirSync(join(voz, 'espeak-ng-data'), { recursive: true });
    writeFileSync(join(voz, 'pt_BR-faber-medium.onnx'), 'x');
    writeFileSync(join(voz, 'tokens.txt'), 'x');
    writeFileSync(join(voz, 'espeak-ng-data', 'phontab'), 'x');
    const texto = 'Você gastou mil e duzentos reais.';
    const r = await enviar('post', '/api/assistente/voz/falar', { texto, velocidade: 1.1 }).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (b: Buffer) => partes.push(b));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(r.headers['content-type']).toBe('audio/wav');
    const corpo = r.body as Buffer;
    expect(corpo.toString('ascii', 0, 4)).toBe('RIFF');
    expect(corpo.length).toBe(44 + texto.length * 2);
    expect(falso.geradas.at(-1)).toEqual({ texto, velocidade: 1.1 });
    await enviar('post', '/api/assistente/voz/preparar', {}).expect(202);
  });

  it('remover valida o id e apaga a voz', async () => {
    await enviar('delete', '/api/assistente/voz/..%2F..%2Fdata').expect(400);
    await enviar('delete', '/api/assistente/voz/inexistente').expect(400);
    const r = await enviar('delete', '/api/assistente/voz/faber').expect(200);
    expect(r.body.instalada).toBe(false);
  });
});
