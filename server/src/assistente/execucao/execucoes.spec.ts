import { APICallError } from 'ai';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../config';
import { abrirBanco } from '../../db/conexao';
import { relogioFixo } from '../../relogio';
import { ChavesDeApi } from '../apis/chaves-de-api';
import type { FabricaDeModelos } from '../apis/fabrica-de-modelos';
import { chamada, modeloFalso, modeloQueFalha, texto as textoFalso } from '../apis/testing/modelo-falso';
import { comoObjeto, lerLinhaJson, texto } from '../cli/comum';
import type { AdaptadorCli } from '../cli/tipos';
import { contaPadraoDe, RepositorioAssistente } from '../dados/repositorio-assistente';
import type { Ferramentas } from '../ferramentas/ferramentas';
import type { EventoExecucao, Mensagem } from '../tipos-api';
import { ConflitoDeExecucao, Execucoes, type ResolvedorCli } from './execucoes';
import { INSTRUCOES_DE_VOZ } from './prompt';

/**
 * CLI de mentira: responde conforme o prompt. "DEVAGAR" espera para dar
 * tempo de cancelar; "SESSAO" finge que a sessão sumiu quando recebe --resume.
 */
const SCRIPT = `
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const resume = process.argv.includes('--resume');
  if (entrada.includes('LOGIN')) { out({ t: 'erro_login' }); return; }
  if (entrada.includes('SESSAO') && resume) { process.stderr.write('No conversation found'); process.exit(1); }
  out({ t: 'sessao', id: 'sess-nova' });
  out({ t: 'ferramenta', id: 'f1', nome: 'mcp__fluxo__resumo_do_mes', entrada: { mes: '2026-09' } });
  out({ t: 'fim_ferramenta', id: 'f1' });
  out({ t: 'texto', d: 'Olá! ' });
  if (entrada.includes('DEVAGAR')) { setInterval(() => {}, 1000); return; }
  out({ t: 'texto', d: 'resume=' + resume + ' historico=' + entrada.includes('Histórico recente') });
});
`;

let raiz: string;
let script: string;

const adaptador: AdaptadorCli = {
  provedor: 'claude', nome: 'CLI falso', binario: 'node', comoInstalar: '', comoEntrar: '', variavelDeConta: 'CONTA_DIR', modelos: [], variaveisPermitidas: [],
  montar: (p) => ({ args: [script, ...(p.sessaoId ? ['--resume', p.sessaoId] : [])], entrada: p.prompt, arquivos: [], env: {} }),
  novoInterprete: () => (linha) => {
    const o = lerLinhaJson(linha);
    if (o?.t === 'sessao') return [{ tipo: 'sessao', sessaoId: texto(o.id)!, modelo: 'modelo-x' }];
    if (o?.t === 'texto') return [{ tipo: 'texto', delta: texto(o.d)! }];
    if (o?.t === 'ferramenta') return [{ tipo: 'ferramenta', id: texto(o.id)!, nome: texto(o.nome)!, entrada: comoObjeto(o.entrada) ?? {} }];
    if (o?.t === 'fim_ferramenta') return [{ tipo: 'ferramenta_fim', id: texto(o.id)!, ok: true, resultado: '{"x":1}' }];
    if (o?.t === 'erro_login') return [{ tipo: 'erro', codigo: 'autenticacao', mensagem: 'Rode claude e /login.' }];
    return [];
  },
  explicarFalha: () => null,
  sessaoPerdida: (_c, stderr) => stderr.includes('No conversation found'),
};

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'fluxo-execucoes-'));
  script = join(raiz, 'cli.js');
  writeFileSync(script, SCRIPT);
});

afterAll(() => rmSync(raiz, { recursive: true, force: true }));

/** Ferramentas de mentira: `panorama` responde; o resto devolve erro de entrada (sem lançar, como a de verdade). */
const ferramentasFalsas = {
  rotulo: (nome: string) => `Rótulo de ${nome}`,
  lista: () => [{ nome: 'panorama', descricao: 'Panorama', inputSchema: { type: 'object', properties: {} } }],
  executar: async (nome: string) => (nome === 'panorama' ? { ok: true, texto: '{"hoje":"2026-10-01"}' } : { ok: false, texto: 'não' }),
} as unknown as Ferramentas;

function montar(
  resolver: ResolvedorCli = async () => ({ caminho: process.execPath, adaptador, conta: contaPadraoDe('claude'), env: {} }),
  fabrica: FabricaDeModelos = () => modeloFalso([textoFalso('nunca usado')]),
) {
  const relogio = relogioFixo('2026-10-01');
  const repo = new RepositorioAssistente(abrirBanco(':memory:'), relogio);
  const config = { porta: 8778, pastaAssistente: join(raiz, `a-${Math.random()}`) } as Config;
  const chaves = new ChavesDeApi(config.pastaAssistente);
  const execucoes = new Execucoes(repo, ferramentasFalsas, config, relogio, resolver, { comando: process.execPath, args: ['ponte.js'] }, chaves, fabrica);
  repo.criarConversa({ id: 'c1', titulo: 'Teste', provedor: 'claude', modelo: null });
  return { repo, execucoes, config, chaves };
}

function perguntar(
  m: ReturnType<typeof montar>, texto: string, historico: { papel: 'usuario' | 'assistente'; texto: string }[] = [], extra: { contaId?: string; voz?: boolean } = {},
) {
  const assistente = m.repo.adicionarMensagem({ id: `a-${Math.random()}`, conversaId: 'c1', papel: 'assistente', texto: '', situacao: 'gerando', provedor: 'claude', modelo: null });
  const id = m.execucoes.iniciar({ conversaId: 'c1', mensagemId: assistente.id, contaId: extra.contaId ?? 'claude', provedor: 'claude', modelo: null, texto, anexos: [], historico, voz: extra.voz });
  return { id, mensagemId: assistente.id };
}

/** Assina e espera o evento `fim`. */
function ate(m: ReturnType<typeof montar>, id: string, desde = 0): Promise<{ eventos: { seq: number; evento: EventoExecucao }[]; fim: Mensagem }> {
  return new Promise((resolver) => {
    const eventos: { seq: number; evento: EventoExecucao }[] = [];
    m.execucoes.assinar(id, desde, (seq, evento) => {
      eventos.push({ seq, evento });
      if (evento.tipo === 'fim') resolver({ eventos, fim: evento.mensagem });
    });
  });
}

describe('Execucoes', () => {
  it('transmite texto e passos, grava a resposta e guarda a sessão do CLI', async () => {
    const m = montar();
    const { id, mensagemId } = perguntar(m, 'Quanto gastei?');
    const { eventos, fim } = await ate(m, id);
    expect(eventos.map((e) => e.seq)).toEqual(eventos.map((_, i) => i + 1));
    expect(eventos.filter((e) => e.evento.tipo === 'texto').map((e) => (e.evento as { delta: string }).delta).join('')).toBe('Olá! resume=false historico=false');
    expect(fim).toMatchObject({ id: mensagemId, situacao: 'ok', texto: 'Olá! resume=false historico=false', modelo: 'modelo-x' });
    expect(fim.passos).toEqual([
      { id: 'f1', nome: 'resumo_do_mes', rotulo: 'Rótulo de resumo_do_mes', entrada: { mes: '2026-09' }, situacao: 'ok', resultado: '{"x":1}' },
    ]);
    expect(fim.uso?.duracaoMs).toEqual(expect.any(Number));
    expect(m.repo.mensagem(mensagemId)?.situacao).toBe('ok');
    expect(m.repo.sessao('c1', 'claude')).toBe('sess-nova');
    expect(m.execucoes.ativa('c1')).toBeNull();
  });

  it('a segunda pergunta continua a sessão do CLI', async () => {
    const m = montar();
    await ate(m, perguntar(m, 'um').id);
    const { fim } = await ate(m, perguntar(m, 'dois').id);
    expect(fim.texto).toContain('resume=true');
  });

  it('sessão perdida: recomeça sem ela e manda o histórico no prompt', async () => {
    const m = montar();
    m.repo.salvarSessao('c1', { id: 'claude', provedor: 'claude' }, 'velha');
    const { fim } = await ate(m, perguntar(m, 'SESSAO', [{ papel: 'usuario', texto: 'antes' }]).id);
    expect(fim.situacao).toBe('ok');
    expect(fim.texto).toContain('resume=false historico=true');
    expect(m.repo.sessao('c1', 'claude')).toBe('sess-nova');
  });

  it('com sessão, o histórico não vai no prompt (o CLI já tem)', async () => {
    const m = montar();
    m.repo.salvarSessao('c1', { id: 'claude', provedor: 'claude' }, 'boa');
    const { fim } = await ate(m, perguntar(m, 'x', [{ papel: 'usuario', texto: 'antes' }]).id);
    expect(fim.texto).toContain('historico=false');
  });

  it('uma execução por conversa', async () => {
    const m = montar();
    const { id } = perguntar(m, 'DEVAGAR');
    expect(() => perguntar(m, 'outra')).toThrow(ConflitoDeExecucao);
    m.execucoes.cancelar(id);
    await ate(m, id);
  });

  it('cancelar encerra o processo e grava o que já tinha vindo como cancelada', async () => {
    const m = montar();
    const { id } = perguntar(m, 'DEVAGAR');
    await vi.waitFor(() => expect(m.repo.mensagens('c1').at(-1)?.texto ?? '').toContain('Olá'), { timeout: 10_000 }).catch(() => undefined);
    const fimPromessa = ate(m, id);
    await vi.waitFor(() => expect(m.execucoes.cancelar(id)).toBe(true));
    const { fim } = await fimPromessa;
    expect(fim.situacao).toBe('cancelada');
    expect(fim.erro).toBeNull();
  });

  it('quem chega depois recebe tudo de novo (desde=0) ou só o que falta (desde=n)', async () => {
    const m = montar();
    const { id } = perguntar(m, 'x');
    const primeira = await ate(m, id);
    const todos = await ate(m, id, 0);
    expect(todos.eventos).toEqual(primeira.eventos);
    const resto = await ate(m, id, primeira.eventos.length - 1);
    expect(resto.eventos.map((e) => e.evento.tipo)).toEqual(['fim']);
  });

  it('reservar toma a vaga na hora: um segundo envio simultâneo recebe 409 antes de gravar qualquer coisa', async () => {
    const m = montar();
    const liberar = m.execucoes.reservar('c1');
    expect(() => m.execucoes.reservar('c1')).toThrow(ConflitoDeExecucao);
    expect(m.execucoes.ativa('c1')).toBeNull();
    liberar();
    const outra = m.execucoes.reservar('c1');
    const { id } = perguntar(m, 'x');
    outra();
    expect(m.execucoes.ativa('c1')).toBe(id);
    await ate(m, id);
  });

  it('sem login numa conta com pasta própria, a mensagem traz o comando daquela conta', async () => {
    const conta = { ...contaPadraoDe('claude'), id: 'ct', nome: 'Claude trabalho', pastaLogin: '/home/ana/.claude-trabalho' };
    const m = montar(async () => ({ caminho: process.execPath, adaptador: { ...adaptador, comoEntrar: 'claude' }, conta, env: { CONTA_DIR: conta.pastaLogin } }));
    const { fim } = await ate(m, perguntar(m, 'LOGIN').id);
    expect(fim.situacao).toBe('erro');
    expect(fim.erro).toBe("A conta “Claude trabalho” não está logada (ou o login expirou). Num terminal, rode: CONTA_DIR='/home/ana/.claude-trabalho' claude");
  });

  it('execução desconhecida não é assinável', () => {
    expect(montar().execucoes.assinar('nao-existe', 0, () => undefined)).toBeNull();
  });

  it('CLI não configurado: a resposta termina em erro com a explicação', async () => {
    const m = montar(async () => ({ erro: 'Nenhum CLI encontrado. Instale nos Ajustes.' }));
    const { fim } = await ate(m, perguntar(m, 'x').id);
    expect(fim).toMatchObject({ situacao: 'erro', erro: 'Nenhum CLI encontrado. Instale nos Ajustes.' });
  });

  it('o token da ponte vale só durante a execução e aponta a conversa', async () => {
    const m = montar();
    let token = '';
    const resolverEspiao: ResolvedorCli = async () => ({
      caminho: process.execPath,
      adaptador: { ...adaptador, montar: (p) => ((token = p.mcp.segredo.valor), adaptador.montar(p)) },
      conta: contaPadraoDe('claude'),
      env: {},
    });
    const m2 = { ...m, execucoes: new Execucoes(m.repo, { rotulo: () => '' } as unknown as Ferramentas, m.config, relogioFixo('2026-10-01'), resolverEspiao, { comando: 'node', args: [] }, m.chaves, () => modeloFalso([])) };
    const { id } = perguntar(m2, 'DEVAGAR');
    await vi.waitFor(() => expect(token).not.toBe(''));
    expect(m2.execucoes.contextoDoToken(token)).toEqual({ conversaId: 'c1' });
    expect(m2.execucoes.contextoDoToken('inventado')).toBeNull();
    m2.execucoes.cancelar(id);
    await ate(m2, id);
    expect(m2.execucoes.contextoDoToken(token)).toBeNull();
  });

  it('apaga a pasta temporária da execução no fim', async () => {
    const m = montar();
    const { id } = perguntar(m, 'x');
    await ate(m, id);
    expect(existsSync(join(m.config.pastaAssistente, 'execucoes', id))).toBe(false);
  });
});

describe('Execucoes — contas por API', () => {
  /** Chave de mentira: o modelo é o MockLanguageModel do AI SDK, nada sai daqui. */
  const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';

  function comContaApi(fabrica: FabricaDeModelos, comChave = true) {
    const m = montar(async () => ({ erro: 'o resolvedor de CLI não pode ser chamado numa conta por API' }), fabrica);
    const conta = { ...contaPadraoDe('claude'), id: 'api-1', nome: 'Claude API', tipo: 'api' as const };
    m.repo.salvarConfig({ contaPadrao: 'api-1', contas: [conta] });
    if (comChave) m.chaves.salvar('api-1', CHAVE);
    return m;
  }

  it('responde pela API: ferramenta do Fluxo, texto, uso e o modelo padrão — sem sessão nem pasta de execução', async () => {
    const pedidos: { provedor: string; chave: string; modelo: string }[] = [];
    const modelo = modeloFalso([chamada('f1', 'panorama', {}), textoFalso('Tudo ', 'certo.')]);
    const m = comContaApi((provedor, chave, id) => (pedidos.push({ provedor, chave, modelo: id }), modelo));
    const { id, mensagemId } = perguntar(m, 'Como estou?', [{ papel: 'usuario', texto: 'oi' }, { papel: 'assistente', texto: 'olá' }], { contaId: 'api-1', voz: true });
    const { fim } = await ate(m, id);
    expect(fim).toMatchObject({ id: mensagemId, situacao: 'ok', texto: 'Tudo certo.', erro: null, modelo: 'claude-sonnet-5' });
    expect(fim.passos).toEqual([{ id: 'f1', nome: 'panorama', rotulo: 'Rótulo de panorama', entrada: {}, situacao: 'ok', resultado: '{"hoje":"2026-10-01"}' }]);
    // Somado entre os dois passos (a chamada da ferramenta e a resposta).
    expect(fim.uso).toMatchObject({ tokensEntrada: 240, tokensSaida: 60, duracaoMs: expect.any(Number) });
    expect(pedidos).toEqual([{ provedor: 'claude', chave: CHAVE, modelo: 'claude-sonnet-5' }]);
    const prompt = JSON.stringify(modelo.doStreamCalls[0]!.prompt);
    expect(prompt).toContain(INSTRUCOES_DE_VOZ.slice(0, 40));
    expect(modelo.doStreamCalls[0]!.prompt.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(m.repo.sessao('c1', 'api-1')).toBeNull();
    expect(existsSync(join(m.config.pastaAssistente, 'execucoes'))).toBe(false);
    expect(readdirSync(m.config.pastaAssistente)).toEqual(['chaves']);
  });

  it('sem chave guardada: erro que diz onde colar a chave', async () => {
    const m = comContaApi(() => modeloFalso([textoFalso('x')]), false);
    const { fim } = await ate(m, perguntar(m, 'oi', [], { contaId: 'api-1' }).id);
    expect(fim).toMatchObject({ situacao: 'erro', erro: 'A conta “Claude API” está sem a chave da API. Cole a chave nos Ajustes do assistente.' });
  });

  it('chave recusada (401): erro amigável, sem a chave', async () => {
    const erro = new APICallError({ message: `invalid x-api-key ${CHAVE}`, url: 'https://api.anthropic.com/v1/messages', statusCode: 401, isRetryable: false, requestBodyValues: {} });
    const m = comContaApi(() => modeloQueFalha(erro));
    const { fim } = await ate(m, perguntar(m, 'oi', [], { contaId: 'api-1' }).id);
    expect(fim).toMatchObject({ situacao: 'erro', erro: 'A chave da API foi recusada (inválida, revogada ou sem permissão). Troque a chave nos Ajustes.' });
    expect(JSON.stringify(fim)).not.toContain(CHAVE);
  });

  it('cancelar uma resposta por API grava como cancelada', async () => {
    const m = comContaApi(() => modeloFalso([textoFalso('a', 'b', 'c', 'd', 'e', 'f')], { atrasoMs: 100 }));
    const { id } = perguntar(m, 'oi', [], { contaId: 'api-1' });
    const fimPromessa = ate(m, id);
    await vi.waitFor(() => expect(m.execucoes.cancelar(id)).toBe(true));
    expect((await fimPromessa).fim.situacao).toBe('cancelada');
  });

  it('testar: um "OK" pela API, sem ferramentas', async () => {
    const modelo = modeloFalso([textoFalso('OK')]);
    const m = comContaApi(() => modelo);
    expect(await m.execucoes.testar('api-1')).toEqual({ ok: true, mensagem: 'Funcionando: respondeu “OK”.', duracaoMs: expect.any(Number) });
    expect(modelo.doStreamCalls[0]!.tools ?? []).toEqual([]);
    const semChave = comContaApi(() => modelo, false);
    expect(await semChave.execucoes.testar('api-1')).toMatchObject({ ok: false, mensagem: expect.stringContaining('sem a chave da API') });
  });

  it('testar duas vezes ao mesmo tempo a mesma conta: o segundo é recusado (nada de chamadas pagas em paralelo)', async () => {
    const m = comContaApi(() => modeloFalso([textoFalso('OK')], { atrasoMs: 50 }));
    const primeiro = m.execucoes.testar('api-1');
    await expect(m.execucoes.testar('api-1')).rejects.toThrow('Já há um teste desta conta em andamento.');
    expect(await primeiro).toMatchObject({ ok: true });
    expect(await m.execucoes.testar('api-1')).toMatchObject({ ok: true });
  });
});
