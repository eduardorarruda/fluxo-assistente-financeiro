import { ModelosAoVivo, type BuscarHttp } from './modelos-ao-vivo';
import { PROVEDORES_API } from './provedores-api';

/** Chave de mentira; o fetch é falso — nenhuma chamada sai daqui. */
const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';

function buscaFalsa(corpo: unknown, status = 200) {
  const pedidos: { url: string; headers: Record<string, string> }[] = [];
  const buscar: BuscarHttp = async (url, init) => {
    pedidos.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  };
  return { buscar, pedidos };
}

describe('ModelosAoVivo', () => {
  it('Anthropic: catálogo primeiro (só os que a chave tem), depois os outros com o nome da API', async () => {
    const { buscar, pedidos } = buscaFalsa({ data: [
      { id: 'claude-novo-9', display_name: 'Claude Novo 9' }, { id: 'claude-haiku-4-5', display_name: 'Haiku' },
      { id: 'claude-sonnet-5', display_name: 'Sonnet 5' }, { id: '--yolo', display_name: 'mau' },
    ] });
    const r = await new ModelosAoVivo(buscar).listar('c1', 'claude', CHAVE);
    expect(r.aoVivo).toBe(true);
    expect(r.modelos.map((m) => m.id)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5', 'claude-novo-9']);
    expect(r.modelos[0]).toEqual(PROVEDORES_API.claude.modelos[0]);
    expect(r.modelos[2]).toEqual({ id: 'claude-novo-9', nome: 'Claude Novo 9', descricao: 'da API' });
    expect(pedidos).toEqual([{ url: 'https://api.anthropic.com/v1/models?limit=1000', headers: expect.objectContaining({ 'x-api-key': CHAVE, 'anthropic-version': '2023-06-01' }) }]);
    expect(pedidos[0]!.url).not.toContain(CHAVE);
  });

  it('OpenAI: só modelos de conversa (sem embeddings, áudio, imagem…), chave no Authorization', async () => {
    const ids = ['gpt-6.1-sol', 'gpt-7-preview', 'o5-mini', 'chatgpt-4o-latest', 'text-embedding-3-large', 'gpt-4o-mini-tts', 'whisper-1',
      'dall-e-3', 'gpt-image-1', 'gpt-realtime', 'omni-moderation-latest', 'gpt-4o-transcribe', 'gpt-4o-search-preview', 'davinci-002', 'gpt-audio'];
    const { buscar, pedidos } = buscaFalsa({ data: ids.map((id) => ({ id })) });
    const r = await new ModelosAoVivo(buscar).listar('c2', 'codex', CHAVE);
    expect(r.modelos.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-7-preview', 'o5-mini', 'chatgpt-4o-latest']);
    expect(r.modelos[1]).toEqual({ id: 'gpt-7-preview', nome: 'gpt-7-preview', descricao: 'da API' });
    expect(pedidos[0]).toEqual({ url: 'https://api.openai.com/v1/models', headers: expect.objectContaining({ Authorization: `Bearer ${CHAVE}` }) });
  });

  it('Gemini: só os que geram conteúdo e não são de imagem/voz/embedding; chave no x-goog-api-key', async () => {
    const { buscar, pedidos } = buscaFalsa({ models: [
      { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-9-ultra', displayName: 'Gemini 9 Ultra', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.1-flash-image-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'] },
    ] });
    const r = await new ModelosAoVivo(buscar).listar('c3', 'gemini', CHAVE);
    expect(r.modelos.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-9-ultra']);
    expect(r.modelos[1]?.nome).toBe('Gemini 9 Ultra');
    expect(pedidos[0]).toEqual({ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: expect.objectContaining({ 'x-goog-api-key': CHAVE }) });
  });

  it('guarda por 10 minutos por conta; esquecer busca de novo', async () => {
    let agora = 0;
    const { buscar, pedidos } = buscaFalsa({ data: [{ id: 'claude-sonnet-5' }] });
    const m = new ModelosAoVivo(buscar, () => agora);
    await m.listar('c1', 'claude', CHAVE);
    agora += 9 * 60_000;
    await m.listar('c1', 'claude', CHAVE);
    expect(pedidos).toHaveLength(1);
    await m.listar('outra', 'claude', CHAVE);
    expect(pedidos).toHaveLength(2);
    agora += 2 * 60_000;
    await m.listar('c1', 'claude', CHAVE);
    expect(pedidos).toHaveLength(3);
    m.esquecer('c1');
    await m.listar('c1', 'claude', CHAVE);
    expect(pedidos).toHaveLength(4);
  });

  it('falhou (HTTP de erro, rede, JSON estranho) ou sem chave: o catálogo, aoVivo false — e não guarda a falha', async () => {
    const catalogo = { modelos: [...PROVEDORES_API.codex.modelos], aoVivo: false };
    const { buscar: recusa, pedidos } = buscaFalsa({ error: {} }, 401);
    const m = new ModelosAoVivo(recusa);
    expect(await m.listar('c', 'codex', CHAVE)).toEqual(catalogo);
    await m.listar('c', 'codex', CHAVE);
    expect(pedidos).toHaveLength(2);
    const semRede = new ModelosAoVivo(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await semRede.listar('c', 'codex', CHAVE)).toEqual(catalogo);
    expect(await new ModelosAoVivo(buscaFalsa('lixo').buscar).listar('c', 'codex', CHAVE)).toEqual(catalogo);
    expect(await m.listar('c', 'codex', null)).toEqual(catalogo);
  });
});
