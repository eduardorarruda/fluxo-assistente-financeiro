import type { ModeloImagem, ProporcaoImagem } from './modelos-imagem';

/**
 * Chamada à API de imagens do Gemini. O endereço é fixo (nada da entrada vira
 * URL); a chave vai só no cabeçalho `x-goog-api-key`. Primeiro a Interactions
 * API; se ela não existir para a chave/modelo (404, 400 de formato), o
 * `generateContent` clássico. A resposta é lida com desconfiança: procura a
 * imagem em base64 onde quer que ela venha.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const URL_INTERACTIONS = `${BASE}/interactions`;
export const urlGenerateContent = (modelo: ModeloImagem) => `${BASE}/models/${encodeURIComponent(modelo)}:generateContent`;

export const TEMPO_GEMINI_MS = 90_000;
const TAMANHO_IMAGEM = '1K';
const PROFUNDIDADE_MAXIMA = 8;
const ITENS_POR_LISTA = 50;
const BASE64_MINIMO = 64;
const TRECHO_DE_ERRO = 240;

export type MotivoErroGemini = 'chave' | 'cobranca' | 'cota' | 'modelo' | 'tempo' | 'rede' | 'sem_imagem' | 'servidor';

export class ErroDoGemini extends Error {
  constructor(public readonly motivo: MotivoErroGemini, mensagem: string) {
    super(mensagem);
  }
}

export interface PedidoImagem {
  chave: string;
  modelo: ModeloImagem;
  descricao: string;
  proporcao: ProporcaoImagem;
}

export interface ImagemGerada {
  bytes: Buffer;
  mime: string;
}

export interface OpcoesGemini {
  buscar?: typeof fetch;
  tempoMs?: number;
}

interface Resposta {
  status: number;
  corpo: unknown;
}

export async function gerarComGemini(p: PedidoImagem, o: OpcoesGemini = {}): Promise<ImagemGerada> {
  const primeira = await postar(URL_INTERACTIONS, corpoInteractions(p), p.chave, o);
  if (primeira.status >= 200 && primeira.status < 300) return imagemOuErro(primeira.corpo);
  const erro = classificar(primeira, p.chave);
  if (erro.motivo !== 'modelo') throw erro;
  const segunda = await postar(urlGenerateContent(p.modelo), corpoGenerateContent(p), p.chave, o);
  if (segunda.status >= 200 && segunda.status < 300) return imagemOuErro(segunda.corpo);
  throw classificar(segunda, p.chave);
}

function corpoInteractions(p: PedidoImagem) {
  return {
    model: p.modelo,
    input: [{ type: 'text', text: p.descricao }],
    response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: p.proporcao, image_size: TAMANHO_IMAGEM },
  };
}

function corpoGenerateContent(p: PedidoImagem) {
  return {
    contents: [{ role: 'user', parts: [{ text: p.descricao }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: p.proporcao, imageSize: TAMANHO_IMAGEM } },
  };
}

async function postar(url: string, corpo: unknown, chave: string, o: OpcoesGemini): Promise<Resposta> {
  const buscar = o.buscar ?? fetch;
  try {
    const r = await buscar(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': chave, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(o.tempoMs ?? TEMPO_GEMINI_MS),
      redirect: 'error',
    });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  } catch (e) {
    const nome = (e as Error).name;
    if (nome === 'TimeoutError' || nome === 'AbortError') {
      throw new ErroDoGemini('tempo', 'O Gemini demorou demais para gerar a imagem (mais de 90 s). Tente de novo ou peça algo mais simples.');
    }
    throw new ErroDoGemini('rede', 'Não consegui falar com o Gemini. Este computador está sem internet?');
  }
}

function imagemOuErro(corpo: unknown): ImagemGerada {
  const achada = acharImagem(corpo, '', 0);
  if (achada) {
    const bytes = Buffer.from(achada.data, 'base64');
    if (bytes.length) return { bytes, mime: achada.mime ?? 'image/png' };
  }
  const texto = acharTexto(corpo, 0);
  const motivo = texto ? ` Ele respondeu: “${cortar(texto)}”` : '';
  throw new ErroDoGemini('sem_imagem', `O Gemini não devolveu imagem.${motivo} Tente descrever de outro jeito.`);
}

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null;

/** Um `data` em base64 num objeto que é de imagem (mime image/*, tipo "image" ou chave com "image"). */
function acharImagem(v: unknown, chavePai: string, profundidade: number): { data: string; mime: string | null } | null {
  if (profundidade > PROFUNDIDADE_MAXIMA || !ehObjeto(v)) return null;
  if (Array.isArray(v)) {
    for (const item of v.slice(0, ITENS_POR_LISTA)) {
      const achada = acharImagem(item, chavePai, profundidade + 1);
      if (achada) return achada;
    }
    return null;
  }
  const mime = [v.mime_type, v.mimeType].find((m): m is string => typeof m === 'string') ?? null;
  const deImagem = mime?.startsWith('image/') || v.type === 'image' || /image/i.test(chavePai);
  if (deImagem && typeof v.data === 'string' && v.data.length >= BASE64_MINIMO) return { data: v.data, mime: mime?.startsWith('image/') ? mime : null };
  for (const [chave, filho] of Object.entries(v)) {
    const achada = acharImagem(filho, chave, profundidade + 1);
    if (achada) return achada;
  }
  return null;
}

function acharTexto(v: unknown, profundidade: number): string | null {
  if (profundidade > PROFUNDIDADE_MAXIMA || !ehObjeto(v)) return null;
  if (!Array.isArray(v) && typeof v.text === 'string' && v.text.trim()) return v.text.trim();
  for (const filho of Array.isArray(v) ? v.slice(0, ITENS_POR_LISTA) : Object.values(v)) {
    const achado = acharTexto(filho, profundidade + 1);
    if (achado) return achado;
  }
  return null;
}

/** Erro do Google → motivo e mensagem para a pessoa. A chave nunca aparece na mensagem. */
export function classificar(r: Resposta, chave: string): ErroDoGemini {
  const erro = ehObjeto(r.corpo) && ehObjeto(r.corpo.error) ? r.corpo.error : {};
  const textoBruto = `${typeof erro.message === 'string' ? erro.message : ''} ${typeof erro.status === 'string' ? erro.status : ''} ${JSON.stringify(erro.details ?? '')}`;
  const texto = textoBruto.split(chave).join('…');
  if (/API[_ ]?key[_ ]?(not valid|invalid)|API_KEY_INVALID|API key expired/i.test(texto) || r.status === 401) {
    return new ErroDoGemini('chave', 'A chave do Gemini foi recusada (inválida ou revogada). Confira em Ajustes → Assistente de IA → Imagens com Nano Banana.');
  }
  if (/billing|FAILED_PRECONDITION|free[_ ]tier|limit: 0|paid/i.test(texto)) {
    return new ErroDoGemini('cobranca', 'Gerar imagem exige uma chave do Gemini com faturamento ativo (não há cota grátis para imagens). Ative o faturamento no Google AI Studio.');
  }
  if (r.status === 403) {
    return new ErroDoGemini('chave', 'A chave do Gemini não tem permissão para gerar imagens neste projeto. Confira a chave no Google AI Studio.');
  }
  if (r.status === 429) return new ErroDoGemini('cota', 'A cota da chave do Gemini acabou por agora. Tente de novo mais tarde.');
  if ([400, 404, 405, 501].includes(r.status)) {
    return new ErroDoGemini('modelo', `O Gemini não aceitou o pedido (${r.status}${texto.trim() ? `: ${cortar(texto.trim())}` : ''}).`);
  }
  return new ErroDoGemini('servidor', `O Gemini respondeu com erro ${r.status}. Tente de novo daqui a pouco.`);
}

function cortar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ');
  return limpo.length > TRECHO_DE_ERRO ? `${limpo.slice(0, TRECHO_DE_ERRO)}…` : limpo;
}
