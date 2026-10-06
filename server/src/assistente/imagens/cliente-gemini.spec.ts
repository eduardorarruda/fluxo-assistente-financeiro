import { ErroDoGemini, gerarComGemini, URL_INTERACTIONS, urlGenerateContent, type PedidoImagem } from './cliente-gemini';
import { CHAVE_TESTE, erroGoogle, fetchFalso, PNG, PNG64, type RespostaFalsa } from './testing/gemini-falso';

const CHAVE = CHAVE_TESTE;
const PEDIDO: PedidoImagem = { chave: CHAVE, modelo: 'gemini-3.1-flash-image', descricao: 'Um porquinho', proporcao: '16:9' };
const erro = erroGoogle;
type Rota = RespostaFalsa;

async function falha(respostas: Rota[]): Promise<ErroDoGemini> {
  const { buscar } = fetchFalso(respostas);
  const e = await gerarComGemini(PEDIDO, { buscar }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ErroDoGemini);
  expect((e as Error).message).not.toContain(CHAVE);
  return e as ErroDoGemini;
}

describe('gerarComGemini', () => {
  it('chama a Interactions API no endereço fixo, chave só no cabeçalho, e lê output_image.data', async () => {
    const { buscar, pedidos } = fetchFalso([{ status: 200, corpo: { id: 'i1', output_image: { mime_type: 'image/png', data: PNG64 } } }]);
    const img = await gerarComGemini(PEDIDO, { buscar });
    expect(img.bytes.equals(PNG)).toBe(true);
    expect(img.mime).toBe('image/png');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((pedidos[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(CHAVE);
    expect(pedidos[0]!.url).not.toContain(CHAVE);
    expect(pedidos[0]!.corpo).toEqual({
      model: 'gemini-3.1-flash-image',
      input: [{ type: 'text', text: 'Um porquinho' }],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '16:9', image_size: '1K' },
    });
  });

  it('acha a imagem em outros formatos da resposta (outputs[], inlineData)', async () => {
    for (const corpo of [
      { outputs: [{ type: 'text', text: 'pronto' }, { type: 'image', data: PNG64, mime_type: 'image/png' }] },
      { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: PNG64 } }] } }] },
    ]) {
      const { buscar } = fetchFalso([{ status: 200, corpo }]);
      expect((await gerarComGemini(PEDIDO, { buscar })).bytes.equals(PNG)).toBe(true);
    }
  });

  it('sem a Interactions API (404), cai no generateContent clássico com imageConfig', async () => {
    const { buscar, pedidos } = fetchFalso([
      erro(404, 'Not found'),
      { status: 200, corpo: { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: PNG64 } }] } }] } },
    ]);
    const img = await gerarComGemini(PEDIDO, { buscar });
    expect(img.bytes.equals(PNG)).toBe(true);
    expect(pedidos.map((p) => p.url)).toEqual([URL_INTERACTIONS, urlGenerateContent('gemini-3.1-flash-image')]);
    expect(pedidos[1]!.corpo.generationConfig).toEqual({ responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } });
  });

  it('chave inválida (400 API_KEY_INVALID, 401) → motivo "chave", sem tentar de novo', async () => {
    const { buscar, pedidos } = fetchFalso([erro(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT')]);
    await expect(gerarComGemini(PEDIDO, { buscar })).rejects.toMatchObject({ motivo: 'chave' });
    expect(pedidos).toHaveLength(1);
    expect((await falha([erro(401, 'Unauthenticated')])).motivo).toBe('chave');
    expect((await falha([erro(403, 'Permission denied', 'PERMISSION_DENIED')])).motivo).toBe('chave');
  });

  it('cota (429) e faturamento exigido (billing / free tier) têm mensagens próprias', async () => {
    const cota = await falha([erro(429, 'Resource has been exhausted', 'RESOURCE_EXHAUSTED')]);
    expect(cota.motivo).toBe('cota');
    const cobranca = await falha([erro(429, 'Quota exceeded for metric generate_content_free_tier_requests, limit: 0')]);
    expect(cobranca.motivo).toBe('cobranca');
    expect(cobranca.message).toMatch(/faturamento/);
    expect((await falha([erro(400, 'Billing is not enabled for this project', 'FAILED_PRECONDITION')])).motivo).toBe('cobranca');
  });

  it('resposta sem imagem vira erro legível com o que o modelo disse', async () => {
    const e = await falha([{ status: 200, corpo: { outputs: [{ type: 'text', text: 'Não posso desenhar isso.' }] } }]);
    expect(e.motivo).toBe('sem_imagem');
    expect(e.message).toContain('Não posso desenhar isso.');
  });

  it('a mensagem de erro do Google nunca devolve a chave, mesmo se ela vier no texto', async () => {
    const e = await falha([erro(404, `model not found for key ${CHAVE}`), erro(404, `still ${CHAVE}`)]);
    expect(e.motivo).toBe('modelo');
  });

  it('tempo esgotado e falta de rede viram motivos próprios', async () => {
    const lento = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await expect(gerarComGemini(PEDIDO, { buscar: lento })).rejects.toMatchObject({ motivo: 'tempo' });
    const semRede = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(gerarComGemini(PEDIDO, { buscar: semRede })).rejects.toMatchObject({ motivo: 'rede' });
  });

  it('5xx vira "servidor"', async () => {
    expect((await falha([erro(503, 'overloaded', 'UNAVAILABLE')])).motivo).toBe('servidor');
  });
});
