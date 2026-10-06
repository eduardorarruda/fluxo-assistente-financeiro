import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { RELOGIO, relogioFixo } from '../relogio';
import { FABRICA_DE_MODELOS, type FabricaDeModelos } from './apis/fabrica-de-modelos';
import { ModelosAoVivo, type BuscarHttp } from './apis/modelos-ao-vivo';
import { chamada, modeloFalso, texto as textoFalso } from './apis/testing/modelo-falso';
import { lerLinhaJson, texto } from './cli/comum';
import type { AdaptadorCli } from './cli/tipos';
import { contaPadraoDe, RepositorioAssistente } from './dados/repositorio-assistente';
import { RESOLVEDOR_CLI, type ResolvedorCli } from './execucao/execucoes';
import { Ferramentas } from './ferramentas/ferramentas';

const TOKEN = 'token-de-teste-bem-comprido-para-a-sessao-local';
/** Chaves de mentira: o modelo é o MockLanguageModel do AI SDK e a lista de modelos vem de um fetch falso. */
const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';
const OUTRA_CHAVE = 'sk-teste-outra-chave-falsa-98765WxYz';

/**
 * CLI de mentira que faz o que o de verdade faria: chama a ferramenta
 * `panorama` pela API do Fluxo, com o token da execução, e responde com o
 * que veio. "DEVAGAR" fica esperando (para testar conflito e cancelamento).
 */
const SCRIPT = `
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', async () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ t: 'sessao', id: 'sess-e2e' });
  if (entrada.includes('DEVAGAR')) { setInterval(() => {}, 1000); return; }
  const url = process.env.FLUXO_PONTE_URL;
  const h = { 'x-fluxo-ponte': process.env.FLUXO_PONTE_ACESSO, 'X-Fluxo': '1', 'Content-Type': 'application/json' };
  const lista = await (await fetch(url, { headers: h })).json();
  out({ t: 'ferramenta', id: 'f1', nome: 'mcp__fluxo__panorama' });
  const r = await (await fetch(url + '/panorama', { method: 'POST', headers: h, body: JSON.stringify({ entrada: {} }) })).json();
  out({ t: 'fim_ferramenta', id: 'f1', ok: r.ok });
  out({ t: 'texto', d: 'ferramentas=' + lista.length + ' hoje=' + JSON.parse(r.texto).hoje });
});
`;

describe('Assistente (ponta a ponta)', () => {
  let app: INestApplication;
  let pasta: string;
  let porta: number;
  const host = () => `127.0.0.1:${porta}`;
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(url).set('Host', host()).set('x-fluxo-sessao', TOKEN);
  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', url: string, corpo?: object) => {
    const r = api()[metodo](url).set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN);
    return corpo ? r.send(corpo) : r;
  };
  const upload = (conversaId: string, nome: string, bytes: Buffer, tipo = 'application/octet-stream') =>
    api().post(`/api/assistente/conversas/${conversaId}/anexos?nome=${encodeURIComponent(nome)}`)
      .set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-sessao', TOKEN).set('Content-Type', tipo).send(bytes);

  /** Lê o SSE até o fim e devolve os eventos. */
  const eventos = async (execucaoId: string, desde = 0) => {
    const r = await get(`/api/assistente/execucoes/${execucaoId}/eventos?desde=${desde}`)
      .buffer(true)
      .parse((res, pronto) => {
        let corpo = '';
        res.on('data', (d: Buffer) => (corpo += d.toString()));
        res.on('end', () => pronto(null, corpo));
      });
    expect(r.headers['content-type']).toContain('text/event-stream');
    return String(r.body).split('\n\n').filter((b) => b.startsWith('id:')).map((b) => {
      const [linhaId, linhaDados] = b.split('\n');
      return { id: Number(linhaId!.slice(4)), evento: JSON.parse(linhaDados!.slice(6)) };
    });
  };

  let script: string;
  const pedidosDeModelo: { provedor: string; chave: string; modelo: string }[] = [];
  let proximoModelo = () => modeloFalso([textoFalso('OK')]);
  const adaptador: AdaptadorCli = {
    provedor: 'claude', nome: 'CLI falso', binario: 'node', comoInstalar: 'x', comoEntrar: 'claude', variavelDeConta: 'CLAUDE_CONFIG_DIR', modelos: [], variaveisPermitidas: [],
    montar: (p) => ({
      args: [script], entrada: p.prompt, arquivos: [],
      env: { FLUXO_PONTE_URL: p.mcp.env.FLUXO_PONTE_URL!, [p.mcp.segredo.variavel]: p.mcp.segredo.valor },
    }),
    novoInterprete: () => (linha) => {
      const o = lerLinhaJson(linha);
      if (o?.t === 'sessao') return [{ tipo: 'sessao', sessaoId: texto(o.id)!, modelo: null }];
      if (o?.t === 'texto') return [{ tipo: 'texto', delta: texto(o.d)! }];
      if (o?.t === 'ferramenta') return [{ tipo: 'ferramenta', id: 'f1', nome: texto(o.nome)!, entrada: {} }];
      if (o?.t === 'fim_ferramenta') return [{ tipo: 'ferramenta_fim', id: 'f1', ok: o.ok === true, resultado: '' }];
      return [];
    },
    explicarFalha: () => null,
    sessaoPerdida: () => false,
  };

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-assistente-e2e-'));
    script = join(pasta, 'cli.js');
    writeFileSync(script, SCRIPT);
    porta = await portaLivre();
    Object.assign(process.env, {
      CAMINHO_BANCO: ':memory:', PASTA_WEB: '/nao/existe', FLUXO_SESSAO: TOKEN, PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
      PORTA: String(porta), PASTA_ASSISTENTE: join(pasta, 'assistente'), PASTA_MODELOS: join(pasta, 'modelos'),
    });
    const resolver: ResolvedorCli = async (contaId) => ({ caminho: process.execPath, adaptador, conta: { ...contaPadraoDe('claude'), id: contaId }, env: {} });
    const fabrica: FabricaDeModelos = (provedor, chave, modelo) => (pedidosDeModelo.push({ provedor, chave, modelo }), proximoModelo());
    const modelosDaApi: BuscarHttp = async () => new Response(JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }, { id: 'claude-novo-9', display_name: 'Claude Novo 9' }] }));
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RELOGIO).useValue(relogioFixo('2026-09-24'))
      .overrideProvider(RESOLVEDOR_CLI).useValue(resolver)
      .overrideProvider(FABRICA_DE_MODELOS).useValue(fabrica)
      .overrideProvider(ModelosAoVivo).useValue(new ModelosAoVivo(modelosDaApi))
      .compile();
    app = modulo.createNestApplication();
    await app.listen(porta, '127.0.0.1');
    await enviar('post', '/api/demonstracao').expect(201);
  });

  afterAll(async () => {
    await app?.close();
    rmSync(pasta, { recursive: true, force: true });
    delete process.env.PORTA;
    delete process.env.PASTA_ASSISTENTE;
    delete process.env.PASTA_MODELOS;
  });

  const novaConversa = async () => (await enviar('post', '/api/assistente/conversas', { contaId: 'claude' }).expect(201)).body as { id: string };

  it('configuração: uma conta por CLI, os provedores e o estado da busca', async () => {
    const { body } = await get('/api/assistente/config').expect(200);
    expect(body.contas.map((c: { id: string }) => c.id)).toEqual(['claude', 'gemini', 'codex']);
    expect(body.provedores.map((p: { variavelDeConta: string }) => p.variavelDeConta)).toEqual(['CLAUDE_CONFIG_DIR', 'GEMINI_CLI_HOME', 'CODEX_HOME']);
    expect(body.pastaSugerida).toMatch(/\.config\/fluxo\/contas$/);
    expect(body.rag).toEqual(expect.objectContaining({ ativo: false, modelo: 'Xenova/multilingual-e5-small' }));
  });

  it('contas: duas do mesmo CLI, cada uma com a sua pasta de login, modelo livre e padrão', async () => {
    const pastaLogin = join(pasta, 'login-trabalho');
    const criada = await enviar('post', '/api/assistente/contas', { provedor: 'claude', nome: 'Claude trabalho', pastaLogin, modelo: 'claude-opus-5-5' }).expect(201);
    const conta = criada.body.contas.find((c: { nome: string }) => c.nome === 'Claude trabalho');
    expect(conta).toMatchObject({ provedor: 'claude', pastaLogin, modelo: 'claude-opus-5-5', comoEntrar: expect.stringMatching(new RegExp(`^CLAUDE_CONFIG_DIR='${pastaLogin}' claude +# depois digite /login`)) });
    // Mesma pasta de login para o mesmo CLI = a mesma conta: recusa.
    expect((await enviar('post', '/api/assistente/contas', { provedor: 'claude', nome: 'De novo', pastaLogin })).status).toBe(400);
    expect((await enviar('post', '/api/assistente/contas', { provedor: 'claude', nome: 'X', pastaLogin: 'relativa/pasta' })).status).toBe(400);
    expect((await enviar('post', '/api/assistente/contas', { provedor: 'claude', nome: 'X', pastaLogin: "/tmp/a'b" })).status).toBe(400);
    expect((await enviar('patch', `/api/assistente/contas/${conta.id}`, { modelo: '--yolo' })).status).toBe(400);
    expect((await enviar('patch', `/api/assistente/contas/${conta.id}`, { caminho: '/bin/sh' })).status).toBe(400);
    const padrao = await enviar('put', '/api/assistente/config', { contaPadrao: conta.id }).expect(200);
    expect(padrao.body.contaPadrao).toBe(conta.id);
    // Conversa nesta conta, com modelo escolhido na hora.
    const c = (await enviar('post', '/api/assistente/conversas', { contaId: conta.id, modelo: 'sonnet' }).expect(201)).body;
    expect(c).toMatchObject({ contaId: conta.id, contaNome: 'Claude trabalho', modelo: 'sonnet' });
    const { body } = await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'oi', anexos: [] }).expect(201);
    expect(body.assistente).toMatchObject({ contaId: conta.id, contaNome: 'Claude trabalho', modelo: 'sonnet' });
    await eventos(body.execucaoId);
    // Removida a conta, a conversa passa para outra e continua abrindo.
    await enviar('delete', `/api/assistente/contas/${conta.id}`).expect(200);
    expect((await get(`/api/assistente/conversas/${c.id}`).expect(200)).body.contaId).not.toBe(conta.id);
  });

  // GET /config detecta os CLIs de verdade (spawn de --version): em máquina ocupada passa dos 5 s padrão.
  describe('contas por API', { timeout: 30_000 }, () => {
    const chaveDe = (contaId: string) => join(pasta, 'assistente', 'chaves', contaId);
    const contaApi = (body: { contas: { id: string; nome: string }[] }, nome: string) => body.contas.find((c) => c.nome === nome)!;

    it('cria com a chave num arquivo 0600 — a chave nunca volta pela API nem vai para a configuração', async () => {
      const r = await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'gemini', nome: 'Gemini API', chave: `  ${CHAVE} `, modelo: 'gemini-3.8-flash' }).expect(201);
      const conta = contaApi(r.body, 'Gemini API');
      expect(conta).toEqual({
        id: expect.any(String), provedor: 'gemini', nome: 'Gemini API', ativo: true, tipo: 'api', caminho: null, modelo: 'gemini-3.8-flash', pastaLogin: null,
        caminhoDetectado: null, instalado: true, versao: null, comoEntrar: '', chaveFinal: '…AbCd',
      });
      expect(statSync(chaveDe(conta.id)).mode & 0o777).toBe(0o600);
      expect(statSync(join(pasta, 'assistente', 'chaves')).mode & 0o777).toBe(0o700);
      expect(readFileSync(chaveDe(conta.id), 'utf8')).toBe(CHAVE);
      const config = await get('/api/assistente/config').expect(200);
      expect(JSON.stringify(r.body)).not.toContain(CHAVE);
      expect(config.text).not.toContain(CHAVE);
      expect(JSON.stringify(app.get(RepositorioAssistente).lerConfig())).not.toContain(CHAVE);
      // As contas de CLI vêm com tipo e sem chave.
      expect(config.body.contas.find((c: { id: string }) => c.id === 'claude')).toMatchObject({ tipo: 'cli', chaveFinal: null });
      expect(config.body.provedores.map((p: { api: { nome: string; ondeCriarChave: string } }) => p.api.nome)).toEqual(['API da Anthropic', 'API do Gemini', 'API da OpenAI']);
      expect(config.body.provedores[1].api).toMatchObject({ ondeCriarChave: 'https://aistudio.google.com/apikey', modelos: expect.arrayContaining([expect.objectContaining({ id: 'gemini-3.8-flash' })]) });
      // Várias contas por API do mesmo provedor podem conviver.
      await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'gemini', nome: 'Gemini API 2', chave: OUTRA_CHAVE }).expect(201);
    });

    it('valida a chave e não a repete no erro', async () => {
      for (const chave of ['curta', 'chave com espaço 0123456789abcdef', 'x'.repeat(301), 'chave-com-acentuação-0123456789']) {
        const r = await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'claude', nome: 'X', chave });
        expect(r.status).toBe(400);
        expect(r.text).not.toContain(chave);
      }
      expect((await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'claude', nome: 'X' })).status).toBe(400);
      expect((await enviar('post', '/api/assistente/contas', { tipo: 'outro', provedor: 'claude', nome: 'X', chave: CHAVE })).status).toBe(400);
    });

    it('troca a chave; recusa caminho/pasta na conta por API e chave na conta de CLI; remover apaga o arquivo', async () => {
      const criada = await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'codex', nome: 'OpenAI', chave: CHAVE }).expect(201);
      const conta = contaApi(criada.body, 'OpenAI');
      const trocada = await enviar('patch', `/api/assistente/contas/${conta.id}`, { chave: OUTRA_CHAVE, nome: 'OpenAI pessoal', modelo: 'gpt-6-luna' }).expect(200);
      expect(contaApi(trocada.body, 'OpenAI pessoal')).toMatchObject({ chaveFinal: '…WxYz', modelo: 'gpt-6-luna', tipo: 'api' });
      expect(readFileSync(chaveDe(conta.id), 'utf8')).toBe(OUTRA_CHAVE);
      expect(trocada.text).not.toContain(OUTRA_CHAVE);
      expect((await enviar('patch', `/api/assistente/contas/${conta.id}`, { caminho: '/usr/bin/codex' })).status).toBe(400);
      expect((await enviar('patch', `/api/assistente/contas/${conta.id}`, { pastaLogin: '/tmp/x' })).status).toBe(400);
      expect((await enviar('patch', `/api/assistente/contas/${conta.id}`, { chave: 'curta' })).status).toBe(400);
      expect((await enviar('patch', '/api/assistente/contas/claude', { chave: CHAVE })).status).toBe(400);
      await enviar('delete', `/api/assistente/contas/${conta.id}`).expect(200);
      expect(existsSync(chaveDe(conta.id))).toBe(false);
    });

    it('a conversa numa conta por API responde pelo modelo, com as ferramentas do Fluxo rodando direto', async () => {
      const criada = await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'claude', nome: 'Claude API', chave: CHAVE }).expect(201);
      const conta = contaApi(criada.body, 'Claude API');
      proximoModelo = () => modeloFalso([chamada('f1', 'panorama', {}), textoFalso('Seu panorama ', 'está em dia.')]);
      const c = (await enviar('post', '/api/assistente/conversas', { contaId: conta.id }).expect(201)).body;
      const { body } = await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'Como estou?', anexos: [], voz: true }).expect(201);
      const fim = (await eventos(body.execucaoId)).at(-1)!.evento;
      expect(fim.mensagem).toMatchObject({ situacao: 'ok', texto: 'Seu panorama está em dia.', contaId: conta.id, contaNome: 'Claude API', modelo: 'claude-sonnet-5' });
      expect(fim.mensagem.passos).toEqual([expect.objectContaining({ id: 'f1', nome: 'panorama', rotulo: 'Panorama das finanças', situacao: 'ok', resultado: expect.stringContaining('2026-09-24') })]);
      expect(pedidosDeModelo.at(-1)).toEqual({ provedor: 'claude', chave: CHAVE, modelo: 'claude-sonnet-5' });
      // A ponte MCP não foi usada: nenhuma pasta de execução ficou para trás, e a chave não está no SSE.
      expect(existsSync(join(pasta, 'assistente', 'execucoes', body.execucaoId))).toBe(false);
      expect(JSON.stringify(fim)).not.toContain(CHAVE);
    });

    it('modelos: ao vivo na conta por API (catálogo + extras), catálogo do CLI na de CLI; testar responde', async () => {
      const criada = await enviar('post', '/api/assistente/contas', { tipo: 'api', provedor: 'claude', nome: 'Claude modelos', chave: CHAVE }).expect(201);
      const conta = contaApi(criada.body, 'Claude modelos');
      const api = await get(`/api/assistente/contas/${conta.id}/modelos`).expect(200);
      expect(api.body).toEqual({
        aoVivo: true,
        modelos: [expect.objectContaining({ id: 'claude-haiku-4-5', principal: true }), { id: 'claude-novo-9', nome: 'Claude Novo 9', descricao: 'da API' }],
      });
      const cli = await get('/api/assistente/contas/claude/modelos').expect(200);
      expect(cli.body.aoVivo).toBe(false);
      expect(cli.body.modelos[0]).toMatchObject({ id: 'claude-opus-5-5' });
      await get('/api/assistente/contas/nao-existe/modelos').expect(404);
      proximoModelo = () => modeloFalso([textoFalso('OK')]);
      const teste = await enviar('post', `/api/assistente/contas/${conta.id}/testar`, {}).expect(200);
      expect(teste.body).toEqual({ ok: true, mensagem: 'Funcionando: respondeu “OK”.', duracaoMs: expect.any(Number) });
    });
  });

  it('não remove a última conta', async () => {
    let config = (await get('/api/assistente/config').expect(200)).body;
    for (const conta of config.contas.slice(1)) config = (await enviar('delete', `/api/assistente/contas/${conta.id}`).expect(200)).body;
    expect(config.contas).toHaveLength(1);
    expect((await enviar('delete', `/api/assistente/contas/${config.contas[0].id}`)).status).toBe(400);
  });

  it('conversas: cria, lista, renomeia, fixa e apaga', async () => {
    const c = await novaConversa();
    expect((await get('/api/assistente/conversas').expect(200)).body.some((x: { id: string }) => x.id === c.id)).toBe(true);
    await enviar('patch', `/api/assistente/conversas/${c.id}`, { titulo: 'Fatura', fixada: true }).expect(200);
    expect((await get(`/api/assistente/conversas/${c.id}`).expect(200)).body).toMatchObject({ titulo: 'Fatura', fixada: true, mensagens: [], execucaoAtiva: null });
    await enviar('delete', `/api/assistente/conversas/${c.id}`).expect(204);
    await get(`/api/assistente/conversas/${c.id}`).expect(404);
  });

  it('pergunta → o CLI usa as ferramentas pela ponte → a resposta chega por SSE e fica gravada', async () => {
    const c = await novaConversa();
    const { body } = await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'Como estou?', anexos: [] }).expect(201);
    expect(body).toMatchObject({ execucaoId: expect.any(String), usuario: { papel: 'usuario', texto: 'Como estou?' }, assistente: { situacao: 'gerando' } });
    const lista = await eventos(body.execucaoId);
    expect(lista.map((e) => e.id)).toEqual(lista.map((_, i) => i + 1));
    const fim = lista.at(-1)!.evento;
    expect(fim.tipo).toBe('fim');
    // A ponte lista o catálogo inteiro (o número muda quando entra ferramenta nova).
    expect(fim.mensagem).toMatchObject({ situacao: 'ok', texto: `ferramentas=${app.get(Ferramentas).lista().length} hoje=2026-09-24` });
    expect(fim.mensagem.passos).toEqual([expect.objectContaining({ nome: 'panorama', rotulo: 'Panorama das finanças', situacao: 'ok' })]);
    const conversa = (await get(`/api/assistente/conversas/${c.id}`).expect(200)).body;
    expect(conversa.titulo).toBe('Como estou?');
    expect(conversa.mensagens.map((m: { papel: string }) => m.papel)).toEqual(['usuario', 'assistente']);
    // Reconectar depois do fim recebe tudo de novo.
    expect((await eventos(body.execucaoId)).length).toBe(lista.length);
  });

  it('uma resposta por vez na conversa; cancelar encerra', async () => {
    const c = await novaConversa();
    const { body } = await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'DEVAGAR', anexos: [] }).expect(201);
    expect((await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'outra', anexos: [] })).status).toBe(409);
    expect((await get('/api/assistente/conversas').expect(200)).body.find((x: { id: string }) => x.id === c.id).gerando).toBe(true);
    await enviar('post', `/api/assistente/execucoes/${body.execucaoId}/cancelar`, {}).expect(204);
    const fim = (await eventos(body.execucaoId)).at(-1)!.evento;
    expect(fim.mensagem.situacao).toBe('cancelada');
  });

  it('refazer a última resposta', async () => {
    const c = await novaConversa();
    const primeira = (await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'oi', anexos: [] }).expect(201)).body;
    await eventos(primeira.execucaoId);
    const r = await enviar('post', `/api/assistente/mensagens/${primeira.assistente.id}/repetir`, {}).expect(201);
    await eventos(r.body.execucaoId);
    const mensagens = (await get(`/api/assistente/conversas/${c.id}`).expect(200)).body.mensagens;
    expect(mensagens.map((m: { id: string }) => m.id)).toEqual([primeira.usuario.id, r.body.assistente.id]);
  });

  describe('anexos', () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

    it('aceita imagem e texto pelo conteúdo, e manda junto com a mensagem', async () => {
      const c = await novaConversa();
      const img = await upload(c.id, '../../foto.png', PNG).expect(201);
      expect(img.body).toMatchObject({ nome: 'foto.png', tipo: 'imagem', mime: 'image/png', situacao: 'pronto' });
      const csv = await upload(c.id, 'gastos.csv', Buffer.from('data;valor\n2026-09-01;10,00')).expect(201);
      expect(csv.body).toMatchObject({ tipo: 'texto', mime: 'text/csv' });
      const { body } = await enviar('post', `/api/assistente/conversas/${c.id}/mensagens`, { texto: 'veja', anexos: [img.body.id, csv.body.id] }).expect(201);
      expect(body.usuario.anexos.map((a: { id: string }) => a.id).sort()).toEqual([img.body.id, csv.body.id].sort());
      await eventos(body.execucaoId);
      // Enviado, não se apaga mais.
      expect((await enviar('delete', `/api/assistente/anexos/${img.body.id}`)).status).toBe(400);
    });

    it('recusa executável disfarçado, arquivo vazio e upload que não é octet-stream', async () => {
      const c = await novaConversa();
      expect((await upload(c.id, 'leia.txt', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0]))).status).toBe(400);
      expect((await upload(c.id, 'vazio.txt', Buffer.alloc(0))).status).toBe(400);
      expect((await upload(c.id, 'a.txt', Buffer.from('oi'), 'text/plain')).status).toBe(403);
    });

    it('anexo ainda não enviado pode ser removido', async () => {
      const c = await novaConversa();
      const a = await upload(c.id, 'foto.png', PNG).expect(201);
      await enviar('delete', `/api/assistente/anexos/${a.body.id}`).expect(204);
    });
  });

  describe('segurança da ponte', () => {
    it('as ferramentas exigem o token de uma execução em andamento — a sessão não basta', async () => {
      expect((await get('/api/assistente/ferramentas')).status).toBe(401);
      expect((await get('/api/assistente/ferramentas').set('x-fluxo-ponte', 'chute')).status).toBe(401);
      const r = await api().post('/api/assistente/ferramentas/panorama').set('Host', host()).set('X-Fluxo', '1').set('x-fluxo-ponte', 'chute').send({ entrada: {} });
      expect(r.status).toBe(401);
    });

    it('as rotas do assistente exigem a sessão como o resto da API', async () => {
      expect((await api().get('/api/assistente/conversas').set('Host', host())).status).toBe(401);
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
