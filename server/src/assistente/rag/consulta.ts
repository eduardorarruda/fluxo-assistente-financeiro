/**
 * Peças puras da busca: a consulta FTS5 montada com segurança a partir do
 * texto livre da pessoa, e a fusão das listas por Reciprocal Rank Fusion.
 */

/** Constante do RRF: amortece a diferença entre o 1º e o 2º lugar de cada lista. */
export const RRF_K = 60;

/** Palavras demais viram uma consulta lenta e sem foco. */
const MAXIMO_DE_PALAVRAS = 12;
const TAMANHO_MINIMO = 2;

/**
 * Consulta MATCH segura. O texto vem de quem digita (e do agente, que lê
 * descrição de Pix de terceiros): aspas, `*`, `NEAR(`, `OR`, `-`, `:` e
 * parênteses são sintaxe do FTS5 e quebrariam a consulta ou mudariam o
 * sentido dela. Daqui só saem palavras (letras, marcas e dígitos Unicode),
 * cada uma como frase entre aspas — aspas internas dobradas, por garantia —
 * com busca por prefixo, unidas por OR. `null` quando não sobra palavra.
 */
export function montarConsultaFts(texto: string): string | null {
  const palavras = texto.normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const vistas = new Set<string>();
  const escolhidas: string[] = [];
  for (const palavra of palavras) {
    const chave = palavra.toLowerCase();
    if ([...palavra].length < TAMANHO_MINIMO || vistas.has(chave)) continue;
    vistas.add(chave);
    escolhidas.push(`"${palavra.replaceAll('"', '""')}"*`);
    if (escolhidas.length === MAXIMO_DE_PALAVRAS) break;
  }
  return escolhidas.length ? escolhidas.join(' OR ') : null;
}

export type OrigemDaBusca = 'palavra' | 'vetor';

export interface ListaOrdenada {
  origem: OrigemDaBusca;
  /** Ids do melhor para o pior. */
  ids: readonly number[];
}

export interface ItemFundido {
  id: number;
  pontuacao: number;
  origem: OrigemDaBusca[];
}

/**
 * Reciprocal Rank Fusion: cada lista dá 1/(k + posição) ao item (posição a
 * partir de 1). Não depende da escala das notas (BM25 e cosseno não se
 * comparam), só da ordem. Empate: menor id primeiro, para ser estável.
 */
export function fundirPorRrf(listas: readonly ListaOrdenada[]): ItemFundido[] {
  const porId = new Map<number, ItemFundido>();
  for (const { origem, ids } of listas) {
    ids.forEach((id, i) => {
      const anterior = porId.get(id) ?? { id, pontuacao: 0, origem: [] };
      porId.set(id, {
        id,
        pontuacao: anterior.pontuacao + 1 / (RRF_K + i + 1),
        origem: anterior.origem.includes(origem) ? anterior.origem : [...anterior.origem, origem],
      });
    });
  }
  return [...porId.values()].sort((a, b) => b.pontuacao - a.pontuacao || a.id - b.id);
}
