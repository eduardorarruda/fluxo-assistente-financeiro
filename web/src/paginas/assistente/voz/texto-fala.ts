/**
 * O que a voz lê. A resposta do assistente é markdown — às vezes com gráfico
 * (```grafico), tabela, imagem gerada (![…](anexo:…)) e emoji. Nada disso se
 * fala: aqui o texto vira frases limpas, prontas para a síntese de voz.
 *
 * A resposta chega em pedaços (SSE). O divisor guarda o que ainda não fechou e
 * só entrega frases inteiras, para a voz começar antes do fim sem cortar no meio
 * de um link ou dentro de um bloco de código.
 */

/** Frase longa demais trava algumas vozes do Chrome (~15 s): corta perto disto. */
const MAX_CARACTERES = 220;

const CERCA = /^\s*(```|~~~)/;
const LINHA_DE_TABELA = /^\s*\|/;
const SEPARADOR_DE_TABELA = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const LINHA_HORIZONTAL = /^\s*([-*_])(\s*\1){2,}\s*$/;
const MARCADOR_DE_LISTA = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
/** Fim de frase: pontuação seguida de espaço (o ponto de "1.234,56" não conta). */
const FIM_DE_FRASE = /[.!?…]+["”’')\]]*\s+/g;

/** Uma linha de markdown → texto falável (sem a estrutura de bloco). */
export function limparLinha(linha: string): string {
  return linha
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // imagens, inclusive as geradas (anexo:)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links: fica o texto
    .replace(/<https?:\/\/[^>]*>/g, ' ')
    .replace(/https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"”]/g, ' ') // endereço solto (sem levar o ponto final junto)
    .replace(/<\/?[a-z][^>]*>/gi, ' ') // HTML cru
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^(\s*>\s?)+/, '')
    .replace(MARCADOR_DE_LISTA, '')
    .replace(/^\s*\[[ xX]\]\s+/, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/(^|[^\p{L}\p{N}])[*_]([^*_\s][^*_]*?)[*_](?=[^\p{L}\p{N}]|$)/gu, '$1$2')
    .replace(/[*`#]+/g, ' ')
    .replace(/\|/g, ' ')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim();
}

/** Corta texto sem pontuação que passou do limite, na vírgula ou no espaço mais perto. */
function cortarLongas(frase: string): string[] {
  const partes: string[] = [];
  let resto = frase;
  while (resto.length > MAX_CARACTERES) {
    const janela = resto.slice(0, MAX_CARACTERES);
    const virgula = Math.max(janela.lastIndexOf(', '), janela.lastIndexOf('; '));
    const corte = virgula > MAX_CARACTERES / 2 ? virgula + 1 : janela.lastIndexOf(' ');
    const ponto = corte > 0 ? corte : MAX_CARACTERES;
    partes.push(resto.slice(0, ponto).trim());
    resto = resto.slice(ponto).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Texto já limpo → frases (cada uma vira uma fala). */
export function dividirEmFrases(texto: string): string[] {
  const frases: string[] = [];
  let inicio = 0;
  for (const m of texto.matchAll(FIM_DE_FRASE)) {
    const fim = (m.index ?? 0) + m[0].length;
    frases.push(texto.slice(inicio, fim).trim());
    inicio = fim;
  }
  frases.push(texto.slice(inicio).trim());
  return frases.filter((f) => /[\p{L}\p{N}]/u.test(f)).flatMap(cortarLongas);
}

/** O trecho tem link, código ou ênfase pela metade? Aí ainda não dá para limpar. */
function equilibrado(trecho: string): boolean {
  const contar = (re: RegExp) => (trecho.match(re) ?? []).length;
  return (
    contar(/\[/g) === contar(/\]/g) &&
    contar(/\(/g) === contar(/\)/g) &&
    contar(/`/g) % 2 === 0 &&
    contar(/\*\*/g) % 2 === 0 &&
    contar(/</g) === contar(/>/g)
  );
}

/** Linha que não se fala: cerca de código, tabela, régua. */
const linhaMuda = (linha: string) =>
  LINHA_DE_TABELA.test(linha) || SEPARADOR_DE_TABELA.test(linha) || LINHA_HORIZONTAL.test(linha) || (linha.match(/\|/g) ?? []).length >= 2;

export interface DivisorDeFrases {
  /** Mais um pedaço da resposta; devolve as frases que ficaram completas. */
  empurrar: (delta: string) => string[];
  /** A resposta acabou: devolve o que sobrou. */
  terminar: () => string[];
}

export function criarDivisorDeFrases(): DivisorDeFrases {
  let pendente = '';
  let emBloco = false;

  const linhaInteira = (linha: string): string[] => {
    if (CERCA.test(linha)) {
      emBloco = !emBloco;
      return [];
    }
    if (emBloco || linhaMuda(linha)) return [];
    return dividirEmFrases(limparLinha(linha));
  };

  /** A linha ainda não acabou: entrega só as frases que já fecharam, se o markdown estiver inteiro. */
  const linhaParcial = (): string[] => {
    if (emBloco || /^\s*[`~|]/.test(pendente)) return [];
    const marcador = pendente.match(MARCADOR_DE_LISTA)?.[0].length ?? 0;
    let corte = -1;
    for (const m of pendente.slice(marcador).matchAll(FIM_DE_FRASE)) corte = marcador + (m.index ?? 0) + m[0].length;
    if (corte <= 0) return [];
    const pronto = pendente.slice(0, corte);
    if (!equilibrado(pronto.slice(marcador))) return [];
    // O que sobra continua sendo a mesma linha, mas sem o marcador de lista do começo.
    pendente = pendente.slice(corte);
    return dividirEmFrases(limparLinha(pronto));
  };

  return {
    empurrar(delta) {
      pendente += delta;
      const frases: string[] = [];
      let quebra = pendente.indexOf('\n');
      while (quebra !== -1) {
        frases.push(...linhaInteira(pendente.slice(0, quebra)));
        pendente = pendente.slice(quebra + 1);
        quebra = pendente.indexOf('\n');
      }
      frases.push(...linhaParcial());
      return frases;
    },
    terminar() {
      const resto = pendente;
      pendente = '';
      const frases = linhaInteira(resto);
      emBloco = false;
      return frases;
    },
  };
}

/** A resposta inteira, pronta para ser lida (as frases unidas por espaço). */
export function limparParaFala(markdown: string): string {
  const divisor = criarDivisorDeFrases();
  return [...divisor.empurrar(markdown), ...divisor.terminar()].join(' ');
}
