import { normalizar } from '../../domain/texto';

/**
 * Guardas das ações por conversa. Quem decide aprovar ou desfazer é a PESSOA:
 * o modelo só pode chamar `confirmar_proposta`/`desfazer_acao` quando a última
 * mensagem que ela mesma escreveu é um "sim" (ou um "desfaz"). Texto de
 * terceiros (descrição de Pix, anexo) nunca passa por aqui — ele não é a
 * mensagem da pessoa — e por isso não consegue aprovar nada.
 *
 * Tudo é comparado sem acento e em minúsculas (`normalizar`), como `pediuImagem`.
 */

/** Um "sim" é curto: acima disto, a mensagem é outra coisa (um pedido novo, um texto colado). */
const TAMANHO_MAXIMO = 140;

const CONFIRMACAO = new RegExp(
  [
    'sim', 'pode', 'confirm\\w*', 'aprov\\w*', 'manda', 'isso', 'ok', 'okay', 'beleza', 'fechado', 'fechou', 'claro', 'com certeza',
    'ta (bom|certo|otimo|beleza)', 'faz', 'faca', 'fazer', 'bora', 'positivo', 'afirmativo', 'perfeito', 'exato', 'combinado', 'autorizo',
  ].map((p) => `\\b${p}\\b`).join('|'),
);

/**
 * "para"/"pare" só valem como negação no começo ("para", "pare tudo"): no meio
 * são preposição ("coloca para Mercado").
 */
const NEGACAO = /\b(nao|nem|nunca|negativo|espera|espere|aguarda|aguarde|cancel\w*|recus\w*|desist\w*|deixa (pra|para) la)\b|^(para|pare)\b/;

const DESFAZER = /\b(desfa\w*|revert\w*|anul\w*|volta(r)? (como|atras|ao|pra|para|o que))\b/;

export function temNegacao(texto: string | null | undefined): boolean {
  return NEGACAO.test(normalizar(texto));
}

/** A mensagem da pessoa é uma confirmação ("sim", "pode fazer", "confirmo")? Pergunta e negação não contam. */
export function pareceConfirmacao(texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  if (!t || t.length > TAMANHO_MAXIMO || t.includes('?')) return false;
  return CONFIRMACAO.test(t) && !NEGACAO.test(t);
}

/** A mensagem da pessoa pede para desfazer ("desfaz", "volta como estava")? Aqui a pergunta vale ("pode desfazer?"). */
export function pareceDesfazer(texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  if (!t || t.length > TAMANHO_MAXIMO) return false;
  return DESFAZER.test(t) && !NEGACAO.test(t);
}
