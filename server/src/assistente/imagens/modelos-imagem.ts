/**
 * Os modelos de imagem do Gemini ("Nano Banana") que o Fluxo sabe usar, com o
 * preço aproximado por imagem 1K (out/2026). O gemini-2.5-flash-image foi
 * desligado em 2026-10-02 e não entra.
 */

export const MODELOS_IMAGEM = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'] as const;
export type ModeloImagem = (typeof MODELOS_IMAGEM)[number];

export const MODELO_IMAGEM_PADRAO: ModeloImagem = 'gemini-3.1-flash-image';

export const CUSTO_POR_IMAGEM_USD: Record<ModeloImagem, number> = {
  'gemini-3.1-flash-lite-image': 0.034,
  'gemini-3.1-flash-image': 0.067,
  'gemini-3-pro-image': 0.134,
};

export const QUALIDADES = ['rapida', 'padrao', 'pro'] as const;
export type QualidadeImagem = (typeof QUALIDADES)[number];

const MODELO_DA_QUALIDADE: Record<QualidadeImagem, ModeloImagem> = {
  rapida: 'gemini-3.1-flash-lite-image',
  padrao: 'gemini-3.1-flash-image',
  pro: 'gemini-3-pro-image',
};

export const PROPORCOES = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export type ProporcaoImagem = (typeof PROPORCOES)[number];

export const LIMITE_DIARIO_PADRAO = 20;
export const LIMITE_DIARIO_MAXIMO = 200;

/**
 * O modelo escolhido nos Ajustes é o teto de custo: o assistente pode pedir um
 * mais barato ("rapida"), nunca um mais caro do que a pessoa escolheu.
 */
export function modeloParaQualidade(teto: ModeloImagem, qualidade: QualidadeImagem | undefined): ModeloImagem {
  if (!qualidade) return teto;
  const pedido = MODELO_DA_QUALIDADE[qualidade];
  return CUSTO_POR_IMAGEM_USD[pedido] <= CUSTO_POR_IMAGEM_USD[teto] ? pedido : teto;
}
