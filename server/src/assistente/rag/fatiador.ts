/**
 * Corta texto em trechos para a busca. Cada trecho cabe no tamanho pedido,
 * termina num lugar natural (parágrafo, fim de frase, quebra de linha,
 * espaço — nessa ordem de preferência) e repete um pouco do fim do anterior,
 * para que uma informação na borda não fique sem contexto.
 */

export interface OpcoesFatiador {
  /** Caracteres por trecho, no máximo. */
  tamanho: number;
  /** Quanto do fim de um trecho se repete no começo do próximo. */
  sobreposicao: number;
}

export const FATIADOR_PADRAO: OpcoesFatiador = { tamanho: 900, sobreposicao: 150 };

/** Abaixo disto o corte "natural" deixaria um trecho curto demais; aí vale descer de preferência. */
const FRACAO_MINIMA = 0.4;

export function fatiar(bruto: string, opcoes: OpcoesFatiador = FATIADOR_PADRAO): string[] {
  const { tamanho, sobreposicao } = opcoes;
  if (tamanho < 20 || sobreposicao < 0 || sobreposicao * 2 >= tamanho) {
    throw new Error('Fatiador: o tamanho precisa ser pelo menos 20 e a sobreposição menor que metade dele.');
  }
  const texto = normalizar(bruto);
  const trechos: string[] = [];
  let inicio = 0;
  while (inicio < texto.length) {
    if (texto.length - inicio <= tamanho) {
      adicionar(trechos, texto.slice(inicio));
      break;
    }
    const corte = pontoDeCorte(texto.slice(inicio, inicio + tamanho), tamanho);
    adicionar(trechos, texto.slice(inicio, inicio + corte));
    const alvo = Math.max(inicio + corte - sobreposicao, inicio + 1);
    inicio = comecoDePalavra(texto, alvo, inicio + corte);
  }
  return trechos;
}

function normalizar(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function adicionar(trechos: string[], trecho: string): void {
  const limpo = trecho.trim();
  if (limpo) trechos.push(limpo);
}

/** Onde cortar a janela: o melhor separador que não deixe o trecho curto demais. */
function pontoDeCorte(janela: string, tamanho: number): number {
  const minimo = Math.floor(tamanho * FRACAO_MINIMA);
  const paragrafo = janela.lastIndexOf('\n\n');
  if (paragrafo >= minimo) return paragrafo;
  const frase = ultimoFimDeFrase(janela);
  if (frase >= minimo) return frase;
  const linha = janela.lastIndexOf('\n');
  if (linha >= minimo) return linha;
  const espaco = janela.lastIndexOf(' ');
  if (espaco > 0) return espaco;
  return janela.length;
}

/** Posição logo depois do último ".", "!", "?", ";" ou ":" seguido de espaço. */
function ultimoFimDeFrase(janela: string): number {
  let posicao = -1;
  for (const m of janela.matchAll(/[.!?;:](?=\s)/g)) posicao = m.index + 1;
  return posicao;
}

/**
 * Leva o começo do próximo trecho para o início de uma palavra (sem passar do
 * fim do trecho atual). Se não houver espaço até lá, a palavra é gigante e o
 * corte é no meio mesmo.
 */
function comecoDePalavra(texto: string, alvo: number, limite: number): number {
  if (alvo === 0 || /\s/.test(texto[alvo - 1] ?? '')) return alvo;
  const espaco = texto.slice(alvo, limite).search(/\s/);
  if (espaco === -1) return alvo;
  let i = alvo + espaco;
  while (i < texto.length && /\s/.test(texto[i] ?? '')) i++;
  return i;
}
