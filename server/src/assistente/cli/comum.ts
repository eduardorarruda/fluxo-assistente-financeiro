/**
 * Leitura defensiva da saída dos CLIs: cada linha é JSON de um programa de
 * terceiros, que muda de versão para versão. Nada aqui lança exceção — campo
 * que não veio, ou veio com outro tipo, vira null.
 */

export type Objeto = Record<string, unknown>;

/** Uma linha de saída como objeto JSON, ou null se não for (linha vazia, aviso solto, array). */
export function lerLinhaJson(linha: string): Objeto | null {
  const limpa = linha.trim();
  if (!limpa.startsWith('{')) return null;
  try {
    const valor: unknown = JSON.parse(limpa);
    return comoObjeto(valor);
  } catch {
    return null;
  }
}

export function comoObjeto(valor: unknown): Objeto | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
}

export function texto(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null;
}

export function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

export function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Soma o que for número; null se nenhum for. */
export function somar(...valores: unknown[]): number | null {
  const numeros = valores.map(numero).filter((n): n is number => n !== null);
  return numeros.length ? numeros.reduce((a, b) => a + b, 0) : null;
}

/** Texto de um retorno de ferramenta: string pura ou lista de blocos `{ type: 'text', text }`. */
export function textoDeConteudo(conteudo: unknown): string {
  if (typeof conteudo === 'string') return conteudo;
  return lista(conteudo)
    .map((b) => {
      const bloco = comoObjeto(b);
      if (!bloco) return '';
      if (bloco.type === 'text') return texto(bloco.text) ?? '';
      if (bloco.type === 'image') return '[imagem]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export interface EmissorDeTexto {
  readonly algumTexto: boolean;
  /** O próximo texto começa um bloco novo (depois de uma ferramenta, por exemplo). */
  novoBloco(): void;
  emitir(pedaco: string | null): { tipo: 'texto'; delta: string }[];
}

/** Junta os pedaços de texto de uma resposta com uma linha em branco entre blocos. */
export function criarEmissorDeTexto(): EmissorDeTexto {
  let algum = false;
  let separar = false;
  return {
    get algumTexto() {
      return algum;
    },
    novoBloco() {
      if (algum) separar = true;
    },
    emitir(pedaco) {
      if (!pedaco) return [];
      const prefixo = separar ? '\n\n' : '';
      separar = false;
      algum = true;
      return [{ tipo: 'texto', delta: prefixo + pedaco }];
    },
  };
}

const AUTENTICACAO = /\b(log ?in|logged|auth|authenticat\w*|unauthori[sz]ed|api key|oauth|credential\w*|token expired)\b/i;
const LIMITE = /\b(rate.?limit\w*|usage limit|quota|too many requests|429|limit reached|resource.?exhausted)\b/i;

/** Classificação comum das mensagens de erro (em inglês) dos três CLIs. */
export function classificarErro(mensagem: string): 'autenticacao' | 'limite' | null {
  if (LIMITE.test(mensagem)) return 'limite';
  if (AUTENTICACAO.test(mensagem)) return 'autenticacao';
  return null;
}

/** Corta texto longo para caber num registro ou numa prévia. */
export function cortar(valor: string, limite: number): string {
  return valor.length <= limite ? valor : `${valor.slice(0, limite - 1)}…`;
}
