import { decodificarTexto } from '../anexos/tipo-arquivo';

/**
 * Texto de um anexo, para fatiar e indexar. O PDF é lido com o unpdf (pdf.js
 * empacotado para Node), página a página, e cada página leva a marcação
 * "[Página N]" — é por ela que o agente cita de onde tirou a informação.
 */

/** ~2 milhões de caracteres: uns 600 páginas de texto corrido. Mais que isso não ajuda a conversa. */
export const LIMITE_DE_CARACTERES = 2_000_000;

export interface TextoExtraido {
  texto: string;
  /** `null` quando o arquivo não tem páginas (texto puro). */
  paginas: number | null;
}

export async function extrairTexto(bytes: Buffer, tipo: 'pdf' | 'texto'): Promise<TextoExtraido> {
  if (tipo === 'texto') return { texto: limitar(decodificarTexto(bytes)), paginas: null };
  const { totalPages, text } = await lerPdf(bytes);
  const texto = text
    .map((pagina, i) => ({ numero: i + 1, conteudo: pagina.trim() }))
    .filter((p) => p.conteudo)
    .map((p) => `[Página ${p.numero}]\n${p.conteudo}`)
    .join('\n\n');
  return { texto: limitar(texto), paginas: totalPages };
}

async function lerPdf(bytes: Buffer): Promise<{ totalPages: number; text: string[] }> {
  const { extractText } = await import('unpdf');
  try {
    // Cópia: o pdf.js pode transferir (e esvaziar) o buffer que recebe.
    return await extractText(new Uint8Array(bytes), { mergePages: false });
  } catch (e) {
    throw new Error(mensagemAmigavel(e), { cause: e });
  }
}

function mensagemAmigavel(e: unknown): string {
  const nome = e instanceof Error ? e.name : '';
  if (nome === 'PasswordException') {
    return 'Este PDF está protegido por senha. Remova a senha (imprima como PDF, por exemplo) e anexe de novo.';
  }
  return 'Não foi possível ler este PDF: o arquivo parece corrompido ou não é um PDF válido.';
}

function limitar(texto: string): string {
  return texto.length > LIMITE_DE_CARACTERES ? texto.slice(0, LIMITE_DE_CARACTERES) : texto;
}
