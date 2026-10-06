import { abrirBanco, type Banco } from '../../db/conexao';
import * as s from '../../db/schema';
import { Repositorio } from '../../dados/repositorio';
import { relogioFixo } from '../../relogio';
import { RepositorioAssistente } from './repositorio-assistente';

let banco: Banco;
let repo: RepositorioAssistente;
let instante: number;

beforeEach(() => {
  banco = abrirBanco(':memory:');
  instante = Date.parse('2026-10-01T12:00:00.000Z');
  repo = new RepositorioAssistente(banco, { agora: () => new Date((instante += 1000)), hoje: () => '2026-10-01' });
});

const conversa = (id = 'c1', titulo = 'Gastos de setembro') => repo.criarConversa({ id, titulo, provedor: 'claude', modelo: null });

const usuario = (conversaId: string, texto: string) =>
  repo.adicionarMensagem({ id: `u-${texto}`, conversaId, papel: 'usuario', texto, situacao: 'ok', provedor: null, modelo: null });

describe('conversas', () => {
  it('cria, lê e lista com a prévia da última mensagem', () => {
    conversa();
    usuario('c1', 'Quanto gastei com mercado?');
    const [resumo] = repo.listarConversas();
    expect(resumo).toMatchObject({ id: 'c1', titulo: 'Gastos de setembro', provedor: 'claude', fixada: false, previa: 'Quanto gastei com mercado?' });
  });

  it('lista fixadas primeiro e depois as mais recentes', () => {
    conversa('a', 'A');
    conversa('b', 'B');
    conversa('c', 'C');
    repo.atualizarConversa('a', { fixada: true });
    expect(repo.listarConversas().map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('nova mensagem leva a conversa para o topo', () => {
    conversa('a', 'A');
    conversa('b', 'B');
    usuario('a', 'oi');
    expect(repo.listarConversas()[0]?.id).toBe('a');
  });

  it('busca pelo título e pelo texto das mensagens, sem se confundir com % e _', () => {
    conversa('a', 'Fatura do cartão');
    conversa('b', 'Outra');
    usuario('b', 'quanto foi o iFood?');
    conversa('c', '100% gasto');
    expect(repo.listarConversas('fatura').map((c) => c.id)).toEqual(['a']);
    expect(repo.listarConversas('ifood').map((c) => c.id)).toEqual(['b']);
    expect(repo.listarConversas('%').map((c) => c.id)).toEqual(['c']);
    expect(repo.listarConversas('_').map((c) => c.id)).toEqual([]);
  });

  it('atualiza título, provedor e modelo', () => {
    conversa();
    const c = repo.atualizarConversa('c1', { titulo: 'Novo', provedor: 'gemini', modelo: 'pro' });
    expect(c).toMatchObject({ titulo: 'Novo', provedor: 'gemini', modelo: 'pro' });
  });

  it('remover apaga mensagens, anexos e sessões junto', () => {
    conversa();
    const m = usuario('c1', 'oi');
    repo.criarAnexo(anexo('x1', 'c1'));
    repo.vincularAnexos('c1', ['x1'], m.id);
    repo.salvarSessao('c1', { id: 'claude', provedor: 'claude' }, 'sess');
    repo.removerConversa('c1');
    expect(repo.conversa('c1')).toBeUndefined();
    expect(banco.select().from(s.mensagens).all()).toEqual([]);
    expect(banco.select().from(s.anexos).all()).toEqual([]);
    expect(banco.select().from(s.sessoesCli).all()).toEqual([]);
  });
});

function anexo(id: string, conversaId: string) {
  return { id, conversaId, nome: 'extrato.pdf', mime: 'application/pdf', tipo: 'pdf' as const, tamanho: 1234, arquivo: `${id}.pdf`, sha256: 'abc' };
}

describe('mensagens', () => {
  it('guardam a ordem de chegada mesmo no mesmo instante', () => {
    conversa();
    repo = new RepositorioAssistente(banco, { agora: () => new Date('2026-10-01T12:00:00.000Z'), hoje: () => '2026-10-01' });
    for (const t of ['um', 'dois', 'três']) usuario('c1', t);
    expect(repo.mensagens('c1').map((m) => m.texto)).toEqual(['um', 'dois', 'três']);
  });

  it('atualiza texto, passos, situação e uso do assistente', () => {
    conversa();
    repo.adicionarMensagem({ id: 'a1', conversaId: 'c1', papel: 'assistente', texto: '', situacao: 'gerando', provedor: 'claude', modelo: null });
    const passo = { id: 't1', nome: 'resumo_do_mes', rotulo: 'Resumo de set/2026', entrada: { mes: '2026-09' }, situacao: 'ok' as const, resultado: '{}' };
    const uso = { tokensEntrada: 10, tokensSaida: 5, custoUsd: null, duracaoMs: 900 };
    repo.atualizarMensagem('a1', { texto: 'Pronto.', passos: [passo], situacao: 'ok', uso, modelo: 'sonnet' });
    expect(repo.mensagem('a1')).toMatchObject({ texto: 'Pronto.', passos: [passo], situacao: 'ok', uso, modelo: 'sonnet', erro: null });
  });

  it('as mensagens trazem os anexos enviados com elas', () => {
    conversa();
    const m = usuario('c1', 'veja o extrato');
    repo.criarAnexo(anexo('x1', 'c1'));
    repo.vincularAnexos('c1', ['x1'], m.id);
    expect(repo.mensagens('c1')[0]?.anexos.map((a) => a.id)).toEqual(['x1']);
  });

  it('na subida, o que ficou "gerando" vira "interrompida"', () => {
    conversa();
    repo.adicionarMensagem({ id: 'a1', conversaId: 'c1', papel: 'assistente', texto: 'meia resp', situacao: 'gerando', provedor: 'claude', modelo: null });
    expect(repo.interromperPendentes()).toBe(1);
    expect(repo.mensagem('a1')?.situacao).toBe('interrompida');
  });

  it('remove uma mensagem (para refazer a resposta)', () => {
    conversa();
    const m = usuario('c1', 'oi');
    repo.removerMensagem(m.id);
    expect(repo.mensagens('c1')).toEqual([]);
  });
});

describe('anexos', () => {
  it('ficam soltos até serem enviados, e só os da própria conversa são vinculados', () => {
    conversa('c1');
    conversa('c2');
    repo.criarAnexo(anexo('x1', 'c1'));
    repo.criarAnexo(anexo('x2', 'c2'));
    expect(repo.anexosSoltos('c1').map((a) => a.id)).toEqual(['x1']);
    const m = usuario('c1', 'oi');
    expect(repo.vincularAnexos('c1', ['x1', 'x2'], m.id)).toEqual(['x1']);
    expect(repo.anexosSoltos('c1')).toEqual([]);
    expect(repo.anexo('x2')?.situacao).toBe('pendente');
  });

  it('atualiza a situação da indexação', () => {
    conversa();
    repo.criarAnexo(anexo('x1', 'c1'));
    repo.atualizarAnexo('x1', { situacao: 'erro', erro: 'PDF protegido' });
    expect(repo.anexo('x1')).toMatchObject({ situacao: 'erro', erro: 'PDF protegido' });
  });

  it('conta os anexos da conversa (para o limite)', () => {
    conversa();
    repo.criarAnexo(anexo('x1', 'c1'));
    repo.criarAnexo(anexo('x2', 'c1'));
    expect(repo.anexosDaConversa('c1')).toHaveLength(2);
  });
});

describe('sessões dos CLIs', () => {
  it('guarda uma sessão por conversa e conta (duas contas do mesmo CLI não se misturam)', () => {
    conversa();
    repo.salvarSessao('c1', { id: 'claude', provedor: 'claude' }, 's1');
    repo.salvarSessao('c1', { id: 'claude', provedor: 'claude' }, 's2');
    repo.salvarSessao('c1', { id: 'claude-trabalho', provedor: 'claude' }, 't1');
    expect(repo.sessao('c1', 'claude')).toBe('s2');
    expect(repo.sessao('c1', 'claude-trabalho')).toBe('t1');
    expect(repo.sessao('c1', 'gemini')).toBeNull();
    repo.esquecerSessao('c1', 'claude');
    expect(repo.sessao('c1', 'claude')).toBeNull();
    expect(repo.sessao('c1', 'claude-trabalho')).toBe('t1');
  });
});

describe('configuração', () => {
  const padrao = (p: 'claude' | 'gemini' | 'codex', nome: string) => ({ id: p, provedor: p, nome, ativo: true, tipo: 'cli' as const, caminho: null, modelo: null, pastaLogin: null });

  it('começa com uma conta (de login padrão) para cada CLI', () => {
    expect(repo.lerConfig()).toEqual({
      contaPadrao: null,
      contas: [padrao('claude', 'Claude Code'), padrao('gemini', 'Gemini CLI'), padrao('codex', 'Codex CLI')],
    });
  });

  it('salva e lê de volta várias contas do mesmo CLI', () => {
    const config = repo.lerConfig();
    const trabalho = { ...padrao('claude', 'Claude trabalho'), id: 'ct', pastaLogin: '/home/ana/.claude-trabalho', modelo: 'opus' };
    repo.salvarConfig({ contaPadrao: 'ct', contas: [...config.contas, trabalho] });
    expect(repo.lerConfig().contaPadrao).toBe('ct');
    expect(repo.lerConfig().contas.find((c) => c.id === 'ct')).toEqual(trabalho);
  });

  it('migra a configuração antiga (um CLI de cada) sem perder caminho, modelo nem o padrão', () => {
    banco.insert(s.configuracoes).values({
      chave: 'assistente',
      valor: JSON.stringify({ provedorPadrao: 'gemini', clis: { claude: { ativo: false, caminho: '/opt/claude', modelo: 'sonnet' }, gemini: { ativo: true, caminho: null, modelo: 'pro' } } }),
    }).run();
    const config = repo.lerConfig();
    expect(config.contaPadrao).toBe('gemini');
    expect(config.contas.find((c) => c.id === 'claude')).toMatchObject({ ativo: false, caminho: '/opt/claude', modelo: 'sonnet', pastaLogin: null });
    expect(config.contas.find((c) => c.id === 'gemini')).toMatchObject({ modelo: 'pro' });
    expect(config.contas.map((c) => c.id)).toEqual(['claude', 'gemini', 'codex']);
  });

  it('contas gravadas antes das contas por API viram tipo "cli"', () => {
    const semTipo = { id: 'ct', provedor: 'claude', nome: 'Claude trabalho', ativo: true, caminho: null, modelo: 'opus', pastaLogin: '/home/ana/.claude-trabalho' };
    banco.insert(s.configuracoes).values({ chave: 'assistente', valor: JSON.stringify({ contaPadrao: 'ct', contas: [semTipo] }) }).run();
    expect(repo.lerConfig().contas).toEqual([{ ...semTipo, tipo: 'cli' }]);
  });

  it('conta por API nunca tem caminho nem pasta de login, mesmo se o gravado tiver', () => {
    const api = { id: 'ka', provedor: 'gemini', nome: 'Gemini API', ativo: true, tipo: 'api', caminho: '/bin/sh', modelo: null, pastaLogin: '/tmp/x' };
    banco.insert(s.configuracoes).values({ chave: 'assistente', valor: JSON.stringify({ contaPadrao: null, contas: [api] }) }).run();
    expect(repo.lerConfig().contas).toEqual([{ ...api, caminho: null, pastaLogin: null }]);
  });

  it('lixo gravado volta ao padrão em vez de quebrar', () => {
    banco.insert(s.configuracoes).values({ chave: 'assistente', valor: '{"contas":"nada"}' }).run();
    expect(repo.lerConfig().contas).toHaveLength(3);
  });

  it('conta removida: a conversa passa para outra', () => {
    conversa();
    repo.atualizarConversa('c1', { contaId: 'velha' });
    repo.reatribuirConversas('velha', { ...padrao('gemini', 'Gemini CLI') });
    expect(repo.conversa('c1')).toMatchObject({ contaId: 'gemini', provedor: 'gemini' });
  });

  it('a configuração do assistente não vaza para as configurações do cálculo', () => {
    repo.salvarConfig(repo.lerConfig());
    const financeiro = new Repositorio(banco, relogioFixo('2026-10-01'));
    expect(Object.keys(financeiro.configuracoes()).sort()).toEqual(['caixinhasNoSaldo', 'demoDispensada']);
  });
});
