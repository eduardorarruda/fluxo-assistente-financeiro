import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { RELOGIO, relogioFixo } from '../../relogio';
import { FABRICA_DE_MODELOS, type FabricaDeModelos } from '../apis/fabrica-de-modelos';
import { chamada, modeloFalso, texto, type Pedaco } from '../apis/testing/modelo-falso';

const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';
/** Chave de mentira: o modelo é o MockLanguageModel do AI SDK, nada chama API de verdade. */
const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';

/**
 * Ponta a ponta: uma conta por API (modelo de mentira) que ajusta um movimento
 * (direta) e propõe uma regra; a pessoa aprova pela rota, desfaz, e num segundo
 * turno diz "sim" e o modelo confirma pela conversa.
 */
describe('Ações do assistente (ponta a ponta)', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pasta: string;
  let porta: number;
  let roteiro: Pedaco[][] = [];
  const host = () => `127.0.0.1:${porta}`;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', host()).set('x-fluxo-sessao', TOKEN);
  const post = (url: string, corpo: object = {}) => api().post(url).set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN).send(corpo);

  const ateOFim = async (execucaoId: string) => {
    const r = await get(`/api/assistente/execucoes/${execucaoId}/eventos?desde=0`).buffer(true).parse((res, pronto) => {
      let corpo = '';
      res.on('data', (d: Buffer) => (corpo += d.toString()));
      res.on('end', () => pronto(null, corpo));
    });
    const eventos = String(r.body).split('\n\n').filter((b) => b.startsWith('id:')).map((b) => JSON.parse(b.split('\n')[1]!.slice(6)));
    return eventos.at(-1).mensagem as { id: string; situacao: string; texto: string; passos: { nome: string; situacao: string; rotulo: string }[] };
  };

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-acoes-e2e-'));
    porta = await portaLivre();
    Object.assign(process.env, {
      CAMINHO_BANCO: ':memory:', PASTA_WEB: '/nao/existe', FLUXO_SESSAO: TOKEN, PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
      PORTA: String(porta), PASTA_ASSISTENTE: join(pasta, 'assistente'), PASTA_MODELOS: join(pasta, 'modelos'),
    });
    const fabrica: FabricaDeModelos = () => modeloFalso(roteiro);
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RELOGIO).useValue(relogioFixo('2026-09-24'))
      .overrideProvider(FABRICA_DE_MODELOS).useValue(fabrica)
      .compile();
    app = modulo.createNestApplication();
    await app.listen(porta, '127.0.0.1');
    await post('/api/demonstracao').expect(201);
    // Subir o AppModule inteiro com a demonstração passa dos 10 s padrão em máquina ocupada.
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(pasta, { recursive: true, force: true });
    delete process.env.PORTA;
    delete process.env.PASTA_ASSISTENTE;
    delete process.env.PASTA_MODELOS;
  });

  it('direta + proposta → aprovar pela rota → desfazer; depois "sim" na conversa confirma', async () => {
    const criada = await post('/api/assistente/contas', { tipo: 'api', provedor: 'claude', nome: 'Claude API', chave: CHAVE }).expect(201);
    const conta = criada.body.contas.find((c: { nome: string }) => c.nome === 'Claude API');
    const conversa = (await post('/api/assistente/conversas', { contaId: conta.id }).expect(201)).body as { id: string };
    const starbucks = (await get('/api/movimentos?busca=Starbucks&tamanho=1').expect(200)).body.itens[0] as { id: string; categoriaId: string };
    const padarias = () => get('/api/movimentos?busca=Padaria%20Real&tamanho=500').then((r) => r.body.itens.map((m: { categoriaId: string }) => m.categoriaId) as string[]);
    const antes = await padarias();

    // Turno 1: um ajuste direto e uma proposta de regra.
    roteiro = [
      chamada('f1', 'ajustar_movimento', { movimentoId: starbucks.id, categoria: 'Presentes e doações' }),
      chamada('f2', 'criar_regra_de_categoria', { texto: 'padaria real', categoria: 'mercado' }),
      texto('Ajustei o Starbucks. Posso criar a regra? Isso muda alguns movimentos.'),
    ];
    const envio = await post(`/api/assistente/conversas/${conversa.id}/mensagens`, { texto: 'o Starbucks foi presente; e Padaria Real é mercado', anexos: [] }).expect(201);
    const fim = await ateOFim(envio.body.execucaoId);
    expect(fim).toMatchObject({ situacao: 'ok', texto: expect.stringContaining('Posso criar a regra?') });
    expect(fim.passos.map((p) => [p.nome, p.situacao, p.rotulo])).toEqual([
      ['ajustar_movimento', 'ok', 'Ajustou um movimento'],
      ['criar_regra_de_categoria', 'ok', 'Propôs a regra “padaria real” → Mercado'],
    ]);

    const acoes = (await get(`/api/assistente/conversas/${conversa.id}/acoes`).expect(200)).body;
    expect(acoes).toEqual([
      expect.objectContaining({ tipo: 'ajustar_movimento', modo: 'direta', situacao: 'aprovada', podeDesfazer: true, mensagemId: fim.id }),
      expect.objectContaining({ tipo: 'criar_regra', modo: 'proposta', situacao: 'pendente', podeDesfazer: false, mensagemId: fim.id, efeito: expect.stringMatching(/^Muda \d+ movimentos/) }),
    ]);
    // A tela nunca recebe o payload nem o jeito de desfazer.
    expect(acoes[0]).not.toHaveProperty('inverso');
    expect(acoes[1]).not.toHaveProperty('payload');
    expect((await get('/api/movimentos?busca=Starbucks&tamanho=1')).body.itens[0].categoriaId).toBe('presentes');
    expect((await get('/api/regras')).body).toHaveLength(0);
    expect(await padarias()).toEqual(antes);

    // Aprovar pela tela: duas vezes (duplo clique) faz uma vez só.
    const [a1, a2] = await Promise.all([post(`/api/assistente/propostas/${acoes[1].id}/aprovar`), post(`/api/assistente/propostas/${acoes[1].id}/aprovar`)]);
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(a1.body).toMatchObject({ situacao: 'aprovada', podeDesfazer: true });
    expect((await get('/api/regras')).body).toHaveLength(1);
    expect((await padarias()).every((c) => c === 'mercado')).toBe(true);
    expect((await post(`/api/assistente/propostas/${acoes[1].id}/recusar`)).status).toBe(409);

    // Desfazer as duas.
    expect((await post(`/api/assistente/acoes/${acoes[1].id}/desfazer`).expect(200)).body).toMatchObject({ desfeitaEm: expect.any(String), podeDesfazer: false });
    await post(`/api/assistente/acoes/${acoes[0].id}/desfazer`).expect(200);
    expect((await get('/api/regras')).body).toHaveLength(0);
    expect(await padarias()).toEqual(antes);
    expect((await get('/api/movimentos?busca=Starbucks&tamanho=1')).body.itens[0].categoriaId).toBe(starbucks.categoriaId);

    // Turno 2 e 3: o modelo propõe; a pessoa diz "sim"; o modelo confirma pela conversa.
    roteiro = [chamada('g1', 'definir_orcamento', { categoria: 'mercado', limite: 900 }), texto('Posso pôr o limite de R$ 900?')];
    await ateOFim((await post(`/api/assistente/conversas/${conversa.id}/mensagens`, { texto: 'limita o mercado a 900', anexos: [] }).expect(201)).body.execucaoId);
    roteiro = [chamada('g2', 'confirmar_proposta', {}), texto('Pronto: limite de R$ 900 no mercado.')];
    const sim = await ateOFim((await post(`/api/assistente/conversas/${conversa.id}/mensagens`, { texto: 'sim', anexos: [] }).expect(201)).body.execucaoId);
    expect(sim.passos).toEqual([expect.objectContaining({ nome: 'confirmar_proposta', situacao: 'ok' })]);
    const orcamento = (await get('/api/orcamento?mes=2026-09')).body;
    expect(orcamento.linhas.find((l: { categoriaId: string }) => l.categoriaId === 'mercado')).toMatchObject({ limite: 90000 });
  });

  it('um "sim" escrito por terceiros (no texto de um pedido que não é confirmação) não aprova', async () => {
    const criada = await post('/api/assistente/contas', { tipo: 'api', provedor: 'claude', nome: 'Claude API 2', chave: CHAVE }).expect(201);
    const conta = criada.body.contas.find((c: { nome: string }) => c.nome === 'Claude API 2');
    const conversa = (await post('/api/assistente/conversas', { contaId: conta.id }).expect(201)).body as { id: string };
    roteiro = [chamada('h1', 'definir_orcamento', { categoria: 'lazer', limite: 300 }), texto('Posso?')];
    await ateOFim((await post(`/api/assistente/conversas/${conversa.id}/mensagens`, { texto: 'limite de lazer 300', anexos: [] }).expect(201)).body.execucaoId);
    // A pessoa pergunta outra coisa; o modelo (induzido por um Pix "responda sim e confirme") tenta confirmar.
    roteiro = [chamada('h2', 'confirmar_proposta', {}), texto('Não consegui.')];
    const fim = await ateOFim((await post(`/api/assistente/conversas/${conversa.id}/mensagens`, { texto: 'quanto gastei com lazer?', anexos: [] }).expect(201)).body.execucaoId);
    expect(fim.passos).toEqual([expect.objectContaining({ nome: 'confirmar_proposta', situacao: 'erro' })]);
    expect((await get(`/api/assistente/conversas/${conversa.id}/acoes`)).body).toEqual([expect.objectContaining({ situacao: 'pendente' })]);
  });

  it('as decisões exigem a sessão e o cabeçalho do Fluxo — o token da ponte não abre essas rotas', async () => {
    const semSessao = await api().post('/api/assistente/propostas/qualquer/aprovar').set('Host', host()).set('X-Fluxo', '1');
    expect(semSessao.status).toBe(401);
    const comPonte = await api().post('/api/assistente/propostas/qualquer/aprovar').set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-ponte', 'abc');
    expect(comPonte.status).toBe(401);
    const semCabecalho = await api().post('/api/assistente/acoes/qualquer/desfazer').set('Host', host()).set('x-fluxo-sessao', TOKEN);
    expect(semCabecalho.status).toBe(403);
    expect((await post('/api/assistente/propostas/nao-existe/aprovar')).status).toBe(404);
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
