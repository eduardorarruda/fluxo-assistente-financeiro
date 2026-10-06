import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { Sessao } from './http/sessao';
import { RELOGIO, relogioFixo } from './relogio';

const HOST = '127.0.0.1:8778';
const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';

describe('API do Fluxo (ponta a ponta, SQLite em memória, modo demonstração)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', HOST).set('x-fluxo-sessao', TOKEN);
  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', url: string, corpo?: object) => {
    const r = api()[metodo](url).set('Host', HOST).set('Origin', `http://${HOST}`).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };

  beforeAll(async () => {
    process.env.CAMINHO_BANCO = ':memory:';
    process.env.FLUXO_SEM_AUTOMACAO = '1';
    process.env.PASTA_WEB = '/nao/existe';
    process.env.FLUXO_SESSAO = TOKEN;
    // Vazias (e não apagadas): o dotenv não sobrescreve variável que já existe, então
    // um .env real com credenciais não vaza para dentro do teste.
    process.env.PLUGGY_CLIENT_ID = '';
    process.env.PLUGGY_CLIENT_SECRET = '';
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RELOGIO)
      .useValue(relogioFixo('2026-09-24'))
      .compile();
    app = modulo.createNestApplication();
    await app.init();
    await enviar('post', '/api/demonstracao').expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('segurança', () => {
    it('recusa Host estranho (DNS rebinding)', async () => {
      const r = await api().get('/api/estado').set('Host', 'evil.example:8778');
      expect(r.status).toBe(403);
      expect(r.body.erro).toBe('Host não permitido.');
    });

    it('recusa escrita vinda de outro site', async () => {
      const r = await api().put('/api/orcamento/mercado').set('Host', HOST).set('Origin', 'https://site-malicioso.com').set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN).send({ limite: 1 });
      expect(r.status).toBe(403);
    });

    it('recusa corpo que não é JSON (formulário de outro site)', async () => {
      const r = await api().put('/api/orcamento/mercado').set('Host', HOST).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN).set('Content-Type', 'text/plain').send('limite=1');
      expect(r.status).toBe(403);
      expect(r.body.erro).toBe('Envie JSON.');
    });

    it('escrita sem o cabeçalho do Fluxo é recusada, mesmo sem corpo', async () => {
      const r = await api().post('/api/demonstracao').set('Host', HOST).set('x-fluxo-sessao', TOKEN);
      expect(r.status).toBe(403);
    });

    it('sem sessão, outro programa da máquina não lê nada', async () => {
      expect((await api().get('/api/movimentos').set('Host', HOST)).status).toBe(401);
      expect((await api().get('/api/estado').set('Host', HOST).set('x-fluxo-sessao', 'chute')).status).toBe(401);
      expect((await api().get('/api/estado').set('Host', HOST).set('Cookie', 'fluxo_sessao=chute')).status).toBe(401);
      expect((await api().get('/api/saude').set('Host', HOST)).status).toBe(200);
    });

    it('a entrada pelo atalho troca o código de uso único pelo cookie, e o código não serve duas vezes', async () => {
      const sessao = app.get(Sessao);
      const codigo = sessao.codigoAtual();
      const entrada = await api().get(`/entrar?c=${codigo}`).set('Host', HOST);
      expect(entrada.status).toBe(302);
      expect(entrada.headers.location).toBe('/');
      const cookie = String(entrada.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      const valor = cookie.split(';')[0]!;
      expect((await api().get('/api/estado').set('Host', HOST).set('Cookie', valor)).status).toBe(200);
      expect((await api().get(`/entrar?c=${codigo}`).set('Host', HOST)).status).toBe(403);
    });

    it('id de conexão estranho não chega à API da Pluggy', async () => {
      expect((await enviar('post', '/api/conexoes/..%2F..%2Fitems/sincronizar', {})).status).toBe(400);
      expect((await enviar('post', '/api/conexoes', { itemId: '../x' })).status).toBe(400);
    });

    it('cabeçalhos de segurança do helmet ficam para o main.ts; aqui não há x-powered-by vazando stack', async () => {
      const r = await get('/api/nao-existe');
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('at ');
    });
  });

  describe('leitura', () => {
    it('estado: modo demonstração, sem Pluggy, com meses disponíveis', async () => {
      const r = await get('/api/estado').expect(200);
      expect(r.body).toMatchObject({ demonstracao: true, pluggyConfigurada: false, mesAtual: '2026-09' });
      expect(r.body.mesesDisponiveis[0]).toBe('2026-09');
      expect(r.body.conexoes[0].contas).toHaveLength(2);
    });

    it('visão geral traz patrimônio, resumo e cartão coerentes', async () => {
      const r = await get('/api/visao-geral?mes=2026-08').expect(200);
      const { patrimonio, resumo } = r.body;
      expect(patrimonio.total).toBe(patrimonio.contas + patrimonio.caixinhas + patrimonio.investimentos - patrimonio.faturaAberta);
      expect(resumo.resultado).toBe(resumo.receitas - resumo.despesas);
      expect(r.body.serieMensal).toHaveLength(12);
      expect(r.body.cartoes[0].faturaAberta).not.toBeNull();
    });

    it('fluxo: os dois lados do Sankey fecham', async () => {
      const { body } = await get('/api/fluxo?mes=2026-08').expect(200);
      const soma = (lado: string) => body.sankey.nos.filter((n: { lado: string }) => n.lado === lado).reduce((s: number, n: { valor: number }) => s + n.valor, 0);
      expect(soma('ORIGEM')).toBe(soma('DESTINO'));
    });

    it('extrato filtra, pagina e busca', async () => {
      const todos = await get('/api/movimentos?mes=2026-08&tamanho=10').expect(200);
      expect(todos.body.itens).toHaveLength(10);
      expect(todos.body.paginas).toBeGreaterThan(1);
      const ifood = await get('/api/movimentos?busca=ifood').expect(200);
      expect(ifood.body.itens.every((m: { descricao: string }) => m.descricao === 'iFood')).toBe(true);
      const cartao = await get('/api/movimentos?contaId=demo-cartao&natureza=PAGAMENTO_FATURA').expect(200);
      expect(cartao.body.itens.length).toBeGreaterThan(0);
    });

    it('cartão, fatura por mês, caixinhas, recorrências, insights e orçamento', async () => {
      const cartoes = await get('/api/cartoes').expect(200);
      const { contaId, faturaAtual } = cartoes.body[0];
      const itens = await get(`/api/cartoes/${contaId}/faturas/${faturaAtual}`).expect(200);
      expect(itens.body.length).toBeGreaterThan(0);
      expect((await get('/api/caixinhas').expect(200)).body.caixinhas).toHaveLength(3);
      const rec = await get('/api/recorrencias').expect(200);
      expect(rec.body.itens.map((r: { nome: string }) => r.nome)).toContain('Netflix.com');
      expect(rec.body.itens.map((r: { nome: string }) => r.nome)).not.toContain('Compra no débito Supermercado Pão de Açúcar');
      expect((await get('/api/insights?mes=2026-08').expect(200)).body.ritmo).toHaveLength(31);
      expect((await get('/api/orcamento?mes=2026-08').expect(200)).body.semLimite.length).toBeGreaterThan(0);
    });

    it('valida o mês', async () => {
      const r = await get('/api/visao-geral?mes=2026-13');
      expect(r.status).toBe(400);
      expect(r.body.erro).toContain('mês no formato AAAA-MM');
    });
  });

  describe('escrita', () => {
    it('recategorizar uma transação e criar regra muda as contas', async () => {
      const { body } = await get('/api/movimentos?busca=padaria real&tamanho=1');
      const alvo = body.itens[0];
      expect(alvo.categoriaId).toBe('restaurantes');
      const r = await enviar('patch', `/api/movimentos/${alvo.id}`, { categoriaId: 'mercado', nota: 'pão da semana', regra: { texto: 'padaria real' } }).expect(200);
      expect(r.body).toMatchObject({ categoriaId: 'mercado', nota: 'pão da semana', editado: true });
      const outras = await get('/api/movimentos?busca=padaria real&tamanho=500');
      expect(outras.body.itens.every((m: { categoriaId: string }) => m.categoriaId === 'mercado')).toBe(true);
      expect((await get('/api/regras')).body).toHaveLength(1);
    });

    it('ignorar tira o movimento das contas', async () => {
      const antes = (await get('/api/visao-geral?mes=2026-08')).body.resumo.despesas;
      const { body } = await get('/api/movimentos?mes=2026-08&natureza=DESPESA&tamanho=1');
      const alvo = body.itens[0];
      await enviar('patch', `/api/movimentos/${alvo.id}`, { ignorar: true }).expect(200);
      const depois = (await get('/api/visao-geral?mes=2026-08')).body.resumo.despesas;
      expect(antes - depois).toBe(alvo.competencia === '2026-08' ? alvo.valor : 0);
    });

    it('regra com categoria de receita para gasto é recusada; transação inexistente é 404', async () => {
      expect((await enviar('patch', '/api/movimentos/nao-existe', { nota: 'x' })).status).toBe(404);
      expect((await enviar('post', '/api/regras', { texto: 'x', categoriaId: 'inexistente' })).status).toBe(400);
    });

    it('orçamento: define, aparece avaliado, zero remove', async () => {
      await enviar('put', '/api/orcamento/delivery', { limite: 50000 }).expect(204);
      const r = await get('/api/orcamento?mes=2026-08');
      expect(r.body.linhas[0]).toMatchObject({ categoriaId: 'delivery', limite: 50000 });
      await enviar('put', '/api/orcamento/delivery', { limite: 0 }).expect(204);
      expect((await get('/api/orcamento?mes=2026-08')).body.linhas).toEqual([]);
      expect((await enviar('put', '/api/orcamento/delivery', { limite: -5 })).status).toBe(400);
    });

    it('metas: cria ligada à caixinha, calcula progresso, edita e apaga', async () => {
      const criada = await enviar('post', '/api/metas', { nome: 'Japão', alvo: 3000000, prazo: '2027-10', caixinhaId: 'demo-conta:viagem' }).expect(201);
      expect(criada.body.caixinhaNome).toBe('Viagem Japão');
      expect(criada.body.progresso.atual).toBeGreaterThan(0);
      expect(criada.body.progresso.ritmoMensal).toBeGreaterThan(0);
      await enviar('put', `/api/metas/${criada.body.id}`, { nome: 'Japão 2027', alvo: 3500000 }).expect(200);
      await enviar('delete', `/api/metas/${criada.body.id}`).expect(204);
      expect((await get('/api/metas')).body).toEqual([]);
    });

    it('configuração: caixinhas no saldo muda o patrimônio', async () => {
      const antes = (await get('/api/visao-geral')).body.patrimonio;
      await enviar('put', '/api/configuracoes', { caixinhasNoSaldo: true }).expect(200);
      const depois = (await get('/api/visao-geral')).body.patrimonio;
      expect(antes.total - depois.total).toBe(antes.caixinhas);
      await enviar('put', '/api/configuracoes', { caixinhasNoSaldo: false }).expect(200);
    });

    it('sem credenciais da Pluggy, conectar explica o que falta (409)', async () => {
      const r = await enviar('post', '/api/conexoes/token', {});
      expect(r.status).toBe(409);
      expect(r.body.erro).toContain('PLUGGY_CLIENT_ID');
    });

    it('sincronizar de novo a demonstração não duplica', async () => {
      const r = await enviar('post', '/api/conexoes/demo-nubank/sincronizar', {}).expect(201);
      expect(r.body).toMatchObject({ novas: 0, removidas: 0 });
    });

    it('remover a demonstração zera tudo e ela não volta sozinha; reativar traz de volta', async () => {
      await enviar('delete', '/api/demonstracao').expect(204);
      const vazio = await get('/api/estado');
      expect(vazio.body.conexoes).toEqual([]);
      expect(vazio.body.configuracoes.demoDispensada).toBe(true);
      await enviar('post', '/api/demonstracao').expect(201);
      expect((await get('/api/estado')).body.demonstracao).toBe(true);
    });
  });
});
