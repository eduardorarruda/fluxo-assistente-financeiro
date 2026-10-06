import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { RELOGIO, relogioFixo } from '../../relogio';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { Ferramentas } from '../ferramentas/ferramentas';
import { ARQUIVO_CHAVE_GEMINI } from './chave-gemini';
import { SEM_CHAVE } from './servico-imagens';
import { CHAVE_TESTE, PNG } from './testing/gemini-falso';

const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';

describe('Imagens do assistente (HTTP)', () => {
  let app: INestApplication;
  let pasta: string;
  let porta: number;
  const host = () => `127.0.0.1:${porta}`;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', host()).set('x-fluxo-sessao', TOKEN);
  const enviar = (metodo: 'post' | 'put' | 'delete', url: string, corpo?: object) => {
    const r = api()[metodo](url).set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };
  const upload = (conversaId: string, nome: string, bytes: Buffer) =>
    api().post(`/api/assistente/conversas/${conversaId}/anexos?nome=${encodeURIComponent(nome)}`)
      .set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN).set('Content-Type', 'application/octet-stream').send(bytes);

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-imagens-e2e-'));
    porta = await portaLivre();
    Object.assign(process.env, {
      CAMINHO_BANCO: ':memory:', PASTA_WEB: '/nao/existe', FLUXO_SESSAO: TOKEN, PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
      PORTA: String(porta), PASTA_ASSISTENTE: join(pasta, 'assistente'), PASTA_MODELOS: join(pasta, 'modelos'),
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RELOGIO).useValue(relogioFixo('2026-10-02')).compile();
    app = modulo.createNestApplication();
    await app.listen(porta, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  describe('config da chave', () => {
    it('sem chave: configurada=false, modelo e limite padrão', async () => {
      const r = await get('/api/assistente/imagens/config').expect(200);
      expect(r.body).toEqual({ configurada: false, final: null, modelo: 'gemini-3.1-flash-image', limiteDiario: 20, geradasHoje: 0 });
    });

    it('PUT grava a chave em arquivo 0600 fora de conversas/ e nenhuma resposta devolve a chave', async () => {
      const r = await enviar('put', '/api/assistente/imagens/config', { chave: ` ${CHAVE_TESTE} `, modelo: 'gemini-3-pro-image', limiteDiario: 5 }).expect(200);
      expect(r.body).toEqual({ configurada: true, final: '…AbCd', modelo: 'gemini-3-pro-image', limiteDiario: 5, geradasHoje: 0 });
      expect(r.text).not.toContain(CHAVE_TESTE);
      const lida = await get('/api/assistente/imagens/config').expect(200);
      expect(lida.text).not.toContain(CHAVE_TESTE);
      const arquivo = join(pasta, 'assistente', ARQUIVO_CHAVE_GEMINI);
      expect(statSync(arquivo).mode & 0o777).toBe(0o600);
      expect(statSync(join(pasta, 'assistente')).mode & 0o777).toBe(0o700);
    });

    it('PUT com formato inválido é 400 sem ecoar o valor; campo desconhecido também é recusado', async () => {
      const ruim = 'chave com espaços que-não-é-chave-1234';
      const r = await enviar('put', '/api/assistente/imagens/config', { chave: ruim }).expect(400);
      expect(r.text).not.toContain(ruim);
      await enviar('put', '/api/assistente/imagens/config', { limiteDiario: 0 }).expect(400);
      await enviar('put', '/api/assistente/imagens/config', { modelo: 'gemini-2.5-flash-image' }).expect(400);
      await enviar('put', '/api/assistente/imagens/config', { url: 'https://evil' }).expect(400);
    });

    it('a ferramenta gerar_imagem está ligada ao serviço (sem chave responde apontando os Ajustes)', async () => {
      await enviar('delete', '/api/assistente/imagens/config').expect(200);
      expect(readdirSync(join(pasta, 'assistente'))).not.toContain(ARQUIVO_CHAVE_GEMINI);
      const ferramentas = app.get(Ferramentas);
      expect(ferramentas.existe('gerar_imagem')).toBe(true);
      const repo = app.get(RepositorioAssistente);
      repo.criarConversa({ id: 'c-img', titulo: 't', provedor: 'claude', modelo: null });
      repo.adicionarMensagem({ id: 'u-img', conversaId: 'c-img', papel: 'usuario', texto: 'Gera uma imagem de um gato', situacao: 'ok', provedor: null, modelo: null });
      expect(await ferramentas.executar('gerar_imagem', { descricao: 'um gato' }, { conversaId: 'c-img' })).toEqual({ ok: false, texto: SEM_CHAVE });
    });

    it('exige sessão e o cabeçalho do Fluxo na escrita', async () => {
      expect((await api().get('/api/assistente/imagens/config').set('Host', host())).status).toBe(401);
      const semCabecalho = await api().put('/api/assistente/imagens/config').set('Host', host()).set('x-fluxo-sessao', TOKEN).send({ limiteDiario: 3 });
      expect(semCabecalho.status).toBe(403);
    });
  });

  describe('GET /anexos/:id/arquivo', () => {
    let conversaId: string;
    beforeAll(async () => {
      conversaId = (await enviar('post', '/api/assistente/conversas', { contaId: 'claude' }).expect(201)).body.id;
    });

    it('serve a imagem com o Content-Type gravado, nosniff, inline e cache privado', async () => {
      const anexo = (await upload(conversaId, 'foto.png', PNG).expect(201)).body as { id: string; origem: string };
      expect(anexo.origem).toBe('pessoa');
      const r = await get(`/api/assistente/anexos/${anexo.id}/arquivo`).buffer(true).parse((res, pronto) => {
        const pedacos: Buffer[] = [];
        res.on('data', (d: Buffer) => pedacos.push(d));
        res.on('end', () => pronto(null, Buffer.concat(pedacos)));
      }).expect(200);
      expect(r.headers['content-type']).toBe('image/png');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-disposition']).toBe("inline; filename*=UTF-8''foto.png");
      expect(r.headers['cache-control']).toBe('private, max-age=86400');
      expect((r.body as Buffer).equals(PNG)).toBe(true);
    });

    it('404 para anexo que não é imagem e para id que não existe', async () => {
      const texto = (await upload(conversaId, 'notas.txt', Buffer.from('saldo 10')).expect(201)).body as { id: string };
      await get(`/api/assistente/anexos/${texto.id}/arquivo`).expect(404);
      await get('/api/assistente/anexos/00000000-0000-4000-8000-000000000000/arquivo').expect(404);
      await get('/api/assistente/anexos/..%2F..%2Fchave-gemini/arquivo').expect((r) => expect([400, 404]).toContain(r.status));
    });

    it('exige a sessão', async () => {
      const anexo = (await upload(conversaId, 'outra.png', PNG).expect(201)).body as { id: string };
      expect((await api().get(`/api/assistente/anexos/${anexo.id}/arquivo`).set('Host', host())).status).toBe(401);
    });
  });
});

function portaLivre(): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const s = createServer();
    s.once('error', rejeitar);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolver(port));
    });
  });
}
