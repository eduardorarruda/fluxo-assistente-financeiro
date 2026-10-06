import { APICallError, RetryError } from 'ai';
import { descreverParaLog, explicarErroDaApi, ocultarSegredos } from './erros-api';

/** Chave de mentira: nunca uma de verdade. */
const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';
const ctx = { provedor: 'codex' as const, modelo: 'gpt-6.1-sol', chave: CHAVE };

function erroHttp(statusCode: number, message: string) {
  return new APICallError({
    message, url: 'https://api.openai.com/v1/responses', statusCode, isRetryable: false,
    requestBodyValues: { input: 'extrato secreto' }, responseHeaders: { 'x-request-id': 'r1' }, responseBody: '{"error":{}}',
  });
}

describe('explicarErroDaApi', () => {
  it('401/403: a chave foi recusada', () => {
    for (const status of [401, 403]) {
      expect(explicarErroDaApi(erroHttp(status, `Incorrect API key provided: ${CHAVE}`), ctx)).toEqual({
        codigo: 'autenticacao',
        mensagem: 'A chave da API foi recusada (inválida, revogada ou sem permissão). Troque a chave nos Ajustes.',
      });
    }
  });

  it('429 e falta de créditos: limite', () => {
    expect(explicarErroDaApi(erroHttp(429, 'Rate limit'), ctx).codigo).toBe('limite');
    expect(explicarErroDaApi(erroHttp(400, 'Your credit balance is too low to access the Anthropic API.'), { ...ctx, provedor: 'claude' }).codigo).toBe('limite');
    expect(explicarErroDaApi(erroHttp(429, 'x'), ctx).mensagem).toMatch(/^A API recusou por limite de uso ou falta de créditos\./);
  });

  it('404: o modelo não existe (ou a chave não tem acesso)', () => {
    expect(explicarErroDaApi(erroHttp(404, 'The model `gpt-x` does not exist'), { ...ctx, modelo: 'gpt-x' })).toEqual({
      codigo: 'desconhecido', mensagem: 'O modelo “gpt-x” não existe nesta API (ou a sua chave não tem acesso).',
    });
  });

  it('desembrulha o RetryError e explica o último erro', () => {
    const e = new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [erroHttp(500, 'a'), erroHttp(429, 'b')] });
    expect(explicarErroDaApi(e, ctx).codigo).toBe('limite');
  });

  it('5xx: problema do lado do provedor, com o código', () => {
    expect(explicarErroDaApi(erroHttp(529, 'Overloaded'), { ...ctx, provedor: 'claude' }).mensagem).toBe(
      'A API da Anthropic está com problema agora (código 529). Tente de novo em instantes.',
    );
  });

  it('rede: diz que não conseguiu falar com a API e o motivo', () => {
    const e = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    expect(explicarErroDaApi(e, { ...ctx, provedor: 'gemini' })).toEqual({
      codigo: 'desconhecido', mensagem: 'Não consegui falar com a API do Gemini: ENOTFOUND.',
    });
  });

  it('outros: a mensagem do provedor, cortada e sem a chave', () => {
    const r = explicarErroDaApi(erroHttp(400, `Bad thing with ${CHAVE} and sk-proj-abcdefghij1234 ${'x'.repeat(600)}`), ctx);
    expect(r.codigo).toBe('desconhecido');
    expect(r.mensagem).toMatch(/^A API da OpenAI recusou o pedido \(código 400\): Bad thing/);
    expect(r.mensagem).not.toContain(CHAVE);
    expect(r.mensagem).not.toContain('sk-proj');
    expect(r.mensagem.length).toBeLessThan(400);
  });
});

describe('descreverParaLog', () => {
  it('só status e mensagem limpa — nada do corpo do pedido, cabeçalhos ou chave', () => {
    const linha = descreverParaLog(erroHttp(401, `Incorrect API key provided: ${CHAVE}`), CHAVE);
    expect(linha).toContain('401');
    expect(linha).not.toContain(CHAVE);
    expect(linha).not.toContain('extrato secreto');
    expect(linha).not.toContain('x-request-id');
  });
});

describe('ocultarSegredos', () => {
  it('apaga a chave e qualquer coisa com cara de chave', () => {
    expect(ocultarSegredos(`a ${CHAVE} b AIzaSyAbcdefghijklmnop c sk-ant-api03-xyz123456`, CHAVE)).toBe('a [chave] b [chave] c [chave]');
  });
});
