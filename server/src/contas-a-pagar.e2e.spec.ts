import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { RELOGIO, relogioFixo } from './relogio';
import { ContasAPagar } from './servicos/contas-a-pagar';

const HOST = '127.0.0.1:8778';
const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';

describe('API de contas a pagar (ponta a ponta, demonstração em 24/09/2026)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', HOST).set('x-fluxo-sessao', TOKEN);
  const enviar = (metodo: 'post' | 'patch' | 'delete', url: string, corpo?: object) => {
    const r = api()[metodo](url).set('Host', HOST).set('Origin', `http://${HOST}`).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };

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
    await enviar('post', '/api/demonstracao').expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sem sessão não lê; escrita sem X-Fluxo é recusada', async () => {
    expect((await api().get('/api/contas-a-pagar').set('Host', HOST)).status).toBe(401);
    const r = await api().post('/api/contas-a-pagar').set('Host', HOST).set('x-fluxo-sessao', TOKEN).send({ descricao: 'x', valor: 1, vencimento: '2026-10-01' });
    expect(r.status).toBe(403);
  });

  it('valida a entrada e responde em português', async () => {
    const r = await enviar('post', '/api/contas-a-pagar', { descricao: 'Luz', valor: -5, vencimento: '2026-13-01' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toContain('o valor precisa ser maior que zero');
    expect(r.body.erro).toContain('não existe no calendário');
    expect((await get('/api/contas-a-pagar?situacao=talvez')).status).toBe(400);
    expect((await enviar('patch', '/api/contas-a-pagar/nao-existe', { valor: 100 })).status).toBe(404);
  });

  it('conta cujo débito já caiu nasce paga, ligada ao movimento do extrato', async () => {
    const r = await enviar('post', '/api/contas-a-pagar', { descricao: 'Internet', valor: 11990, vencimento: '2026-09-15', textoNoExtrato: 'vivo', repete: 'mensal' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ situacao: 'paga', pagaEm: '2026-09-14', origem: 'pessoa' });
    expect(r.body.movimento).toMatchObject({ data: '2026-09-14', valor: 11990 });
    expect(r.body.movimento.descricao).toContain('Vivo');
    const lista = (await get('/api/contas-a-pagar').expect(200)).body as { vencimento: string; situacao: string }[];
    expect(lista.map((c) => [c.vencimento, c.situacao])).toEqual([['2026-09-15', 'paga'], ['2026-10-15', 'aberta']]);
  });

  it('criar, editar, pagar à mão, reabrir e remover', async () => {
    const criada = (await enviar('post', '/api/contas-a-pagar', { descricao: 'IPVA', valor: 98000, vencimento: '2026-09-20' }).expect(201)).body;
    expect(criada.situacao).toBe('atrasada');
    const editada = (await enviar('patch', `/api/contas-a-pagar/${criada.id}`, { valor: 99000, nota: '2ª parcela' }).expect(200)).body;
    expect(editada).toMatchObject({ valor: 99000, nota: '2ª parcela' });
    const paga = (await enviar('post', `/api/contas-a-pagar/${criada.id}/paga`, { data: '2026-09-21' }).expect(200)).body;
    expect(paga).toMatchObject({ situacao: 'paga', pagaEm: '2026-09-21', movimento: null });
    const reaberta = (await enviar('post', `/api/contas-a-pagar/${criada.id}/reabrir`).expect(200)).body;
    expect(reaberta.situacao).toBe('atrasada');
    await enviar('delete', `/api/contas-a-pagar/${criada.id}`).expect(204);
    expect((await get('/api/contas-a-pagar').expect(200)).body.some((c: { id: string }) => c.id === criada.id)).toBe(false);
  });

  it('candidatos para escolher à mão, e pagar com o escolhido', async () => {
    const conta = (await enviar('post', '/api/contas-a-pagar', { descricao: 'Aluguel', valor: 235000, vencimento: '2026-09-11', textoNoExtrato: 'nao aparece no extrato' }).expect(201)).body;
    expect(conta.situacao).toBe('atrasada');
    const candidatos = (await get(`/api/contas-a-pagar/${conta.id}/candidatos`).expect(200)).body as { id: string; descricao: string; forte: boolean }[];
    expect(candidatos[0]?.descricao).toContain('Aluguel');
    expect(candidatos[0]?.forte).toBe(false);
    const paga = (await enviar('post', `/api/contas-a-pagar/${conta.id}/paga`, { movimentoId: candidatos[0]!.id }).expect(200)).body;
    expect(paga.movimento.id).toBe(candidatos[0]!.id);
    const r = await enviar('post', `/api/contas-a-pagar/${conta.id}/paga`, { movimentoId: '../../etc' });
    expect(r.status).toBe(400);
  });

  it('conciliar roda sob demanda; alertas avisam a conta que vence logo', async () => {
    expect((await enviar('post', '/api/contas-a-pagar/conciliar').expect(200)).body).toEqual([]);
    await enviar('post', '/api/contas-a-pagar', { descricao: 'Seguro do carro', valor: 32000, vencimento: '2026-09-26' }).expect(201);
    const alertas = (await get('/api/alertas').expect(200)).body as { id: string; titulo: string; destino: string }[];
    expect(alertas.find((a) => a.titulo === 'Seguro do carro vence em 2 dias')?.destino).toBe('/contas-a-pagar');
  });

  it('faturas do cartão aparecem para leitura, com fechamento e vencimento', async () => {
    const faturas = (await get('/api/contas-a-pagar/faturas').expect(200)).body as { vencimento: string; fechamento: string | null; situacao: string }[];
    expect(faturas.length).toBeGreaterThan(0);
    expect(faturas.some((f) => f.situacao === 'ABERTA')).toBe(true);
    for (const f of faturas) if (f.fechamento) expect(f.fechamento < f.vencimento).toBe(true);
  });

  it('o serviço é injetável (assistente e Agenda) e avisa quem acompanha', async () => {
    const servico = app.get(ContasAPagar);
    let avisos = 0;
    const cancelar = servico.aoMudar(() => avisos++);
    servico.criar({ descricao: 'Academia', valor: 9990, vencimento: '2026-10-05', origem: 'assistente' });
    await new Promise((r) => setTimeout(r, 400));
    cancelar();
    expect(avisos).toBe(1);
  });
});
