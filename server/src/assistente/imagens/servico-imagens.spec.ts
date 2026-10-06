import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../config';
import { abrirBanco } from '../../db/conexao';
import { Repositorio } from '../../dados/repositorio';
import { relogioFixo } from '../../relogio';
import { Financas } from '../../servicos/financas';
import { Anexos } from '../anexos/anexos';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { Ferramentas } from '../ferramentas/ferramentas';
import type { Indexador } from '../rag/indexador';
import { CofreChaveGemini } from './chave-gemini';
import { RepositorioImagens } from './repositorio-imagens';
import { SEM_CHAVE, ServicoDeImagens } from './servico-imagens';
import { CHAVE_TESTE, erroGoogle, fetchFalso, PNG, respostaComImagem, type RespostaFalsa } from './testing/gemini-falso';

const HOJE = '2026-10-02';

function montar(respostas: RespostaFalsa[] = [respostaComImagem()], { comChave = true, gerando = true } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'fluxo-imagens-'));
  const relogio = relogioFixo(HOJE);
  const banco = abrirBanco(':memory:');
  const assistente = new RepositorioAssistente(banco, relogio);
  assistente.criarConversa({ id: 'c1', titulo: 't', provedor: 'claude', modelo: null });
  assistente.adicionarMensagem({ id: 'u1', conversaId: 'c1', papel: 'usuario', texto: 'faz uma imagem', situacao: 'ok', provedor: null, modelo: null });
  assistente.adicionarMensagem({ id: 'r1', conversaId: 'c1', papel: 'assistente', texto: '', situacao: gerando ? 'gerando' : 'ok', provedor: 'claude', modelo: null });
  const anexos = new Anexos(assistente, {} as Indexador, { pastaAssistente: pasta } as Config);
  const cofre = new CofreChaveGemini(pasta);
  if (comChave) cofre.salvar(CHAVE_TESTE);
  const preferencias = new RepositorioImagens(banco);
  const { buscar, pedidos } = fetchFalso(respostas);
  const servico = new ServicoDeImagens(preferencias, cofre, anexos, assistente, relogio, buscar);
  const financas = new Financas(new Repositorio(banco, relogio), relogio);
  const ferramentas = new Ferramentas(financas, assistente, { buscar: async () => [], modo: () => 'palavras' }, { texto: () => null }, servico);
  const chamar = (entrada: unknown) => ferramentas.executar('gerar_imagem', entrada, { conversaId: 'c1' });
  return { pasta, servico, ferramentas, chamar, assistente, preferencias, pedidos, anexos };
}

describe('gerar_imagem (ServicoDeImagens)', () => {
  const pastas: string[] = [];
  const criar = (...a: Parameters<typeof montar>) => {
    const m = montar(...a);
    pastas.push(m.pasta);
    return m;
  };
  afterEach(() => pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

  it('aparece na lista do MCP com a entrada descrita', () => {
    const { ferramentas } = criar();
    const f = ferramentas.lista().find((x) => x.nome === 'gerar_imagem');
    expect(f?.inputSchema.required).toEqual(['descricao']);
    expect(f?.descricao).toMatch(/grafico/);
  });

  it('gera, grava como anexo "gerada" preso à resposta em andamento e devolve o markdown e o custo', async () => {
    const { chamar, assistente, pedidos, preferencias, pasta } = criar();
    const r = await chamar({ descricao: 'Infográfico [de] gastos (setembro)', proporcao: '16:9' });
    expect(r.ok).toBe(true);
    const dados = JSON.parse(r.texto) as { anexoId: string; markdown: string; custoEstimadoUsd: number; modelo: string };
    expect(dados.markdown).toBe(`![Infográfico de gastos setembro](anexo:${dados.anexoId})`);
    expect(dados.custoEstimadoUsd).toBe(0.067);
    expect(dados.modelo).toBe('gemini-3.1-flash-image');
    expect(pedidos[0]!.corpo.response_format.aspect_ratio).toBe('16:9');

    const anexo = assistente.anexo(dados.anexoId)!;
    expect(anexo).toMatchObject({ tipo: 'imagem', mime: 'image/png', origem: 'gerada', mensagemId: 'r1', situacao: 'pronto' });
    expect(anexo.nome).toBe('Infográfico [de] gastos (setembro).png');
    const arquivo = join(pasta, 'conversas', 'c1', 'anexos', anexo.arquivo);
    expect(readFileSync(arquivo).equals(PNG)).toBe(true);
    expect(statSync(arquivo).mode & 0o777).toBe(0o600);
    expect(assistente.anexosSoltos('c1')).toEqual([]);
    expect(assistente.mensagem('r1')!.anexos.map((a) => a.id)).toEqual([dados.anexoId]);
    expect(preferencias.geradasEm(HOJE)).toBe(1);
  });

  it('sem chave: erro amigável apontando os Ajustes, sem chamar o Google', async () => {
    const { chamar, pedidos } = criar(undefined, { comChave: false });
    const r = await chamar({ descricao: 'um gato' });
    expect(r).toEqual({ ok: false, texto: SEM_CHAVE });
    expect(r.texto).toMatch(/Configure a chave do Gemini em Ajustes/);
    expect(pedidos).toHaveLength(0);
  });

  it('chave recusada e cota esgotada viram respostas legíveis e devolvem a vaga do dia', async () => {
    const recusada = criar([erroGoogle(400, 'API key not valid', 'INVALID_ARGUMENT')]);
    const r1 = await recusada.chamar({ descricao: 'um gato' });
    expect(r1.ok).toBe(false);
    expect(r1.texto).toMatch(/chave do Gemini foi recusada/);
    expect(r1.texto).not.toContain(CHAVE_TESTE);
    expect(recusada.preferencias.geradasEm(HOJE)).toBe(0);

    const cota = criar([erroGoogle(429, 'Resource exhausted', 'RESOURCE_EXHAUSTED')]);
    expect((await cota.chamar({ descricao: 'um gato' })).texto).toMatch(/cota/);
  });

  it('respeita o limite diário e conta só as do dia', async () => {
    const { chamar, servico, pedidos, preferencias } = criar([respostaComImagem()]);
    servico.mudar({ limiteDiario: 2 });
    preferencias.contar('2026-10-01', 9);
    expect((await chamar({ descricao: 'imagem um' })).ok).toBe(true);
    expect((await chamar({ descricao: 'imagem dois' })).ok).toBe(true);
    const terceira = await chamar({ descricao: 'imagem três' });
    expect(terceira.ok).toBe(false);
    expect(terceira.texto).toMatch(/limite de 2 imagens por dia/);
    expect(pedidos).toHaveLength(2);
    expect(servico.config().geradasHoje).toBe(2);
  });

  it('o modelo dos Ajustes é o teto: "pro" não passa de um teto mais barato; "rapida" pode baixar', async () => {
    const { chamar, servico, pedidos } = criar([respostaComImagem()]);
    servico.mudar({ modelo: 'gemini-3.1-flash-lite-image' });
    await chamar({ descricao: 'imagem um', qualidade: 'pro' });
    servico.mudar({ modelo: 'gemini-3-pro-image' });
    await chamar({ descricao: 'imagem dois', qualidade: 'rapida' });
    await chamar({ descricao: 'imagem três' });
    expect(pedidos.map((p) => p.corpo.model)).toEqual(['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image']);
  });

  it('valida a entrada (descrição longa demais, proporção desconhecida)', async () => {
    const { chamar, pedidos } = criar();
    expect((await chamar({ descricao: 'x'.repeat(2001) })).texto).toMatch(/Entrada inválida/);
    expect((await chamar({ descricao: 'gato', proporcao: '2:1' })).texto).toMatch(/Entrada inválida/);
    expect(pedidos).toHaveLength(0);
  });

  it('fora de uma resposta em andamento não gera nada', async () => {
    const { chamar, pedidos } = criar(undefined, { gerando: false });
    expect((await chamar({ descricao: 'gato' })).texto).toMatch(/durante uma resposta/);
    expect(pedidos).toHaveLength(0);
  });

  it('resposta do Google que não é imagem de verdade (bytes de PDF) é recusada', async () => {
    const pdf = Buffer.from('%PDF-1.7 não é imagem, mas tem tamanho suficiente para passar do mínimo de base64...').toString('base64');
    const { chamar, assistente } = criar([{ status: 200, corpo: { output_image: { mime_type: 'image/png', data: pdf } } }]);
    const r = await chamar({ descricao: 'gato' });
    expect(r).toEqual({ ok: false, texto: 'O Gemini devolveu um arquivo que não é imagem. Tente de novo.' });
    expect(assistente.anexosDaConversa('c1')).toEqual([]);
  });

  it('config nunca traz a chave, só o final', () => {
    const { servico } = criar();
    const config = servico.config();
    expect(config).toEqual({ configurada: true, final: '…AbCd', modelo: 'gemini-3.1-flash-image', limiteDiario: 20, geradasHoje: 0 });
    expect(JSON.stringify(config)).not.toContain(CHAVE_TESTE);
    expect(servico.removerChave()).toMatchObject({ configurada: false, final: null });
  });
});
