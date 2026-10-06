/**
 * As mesmas regras do servidor (docs/ASSISTENTE.md), conferidas antes de enviar
 * para a pessoa saber na hora — o servidor confere de novo, pelos bytes.
 */
export const LIMITE_BYTES = 15 * 1024 * 1024;
export const LIMITE_POR_CONVERSA = 20;

const EXTENSOES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'md', 'csv', 'ofx', 'json'] as const;
const MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/x-ofx', 'application/ofx',
]);

/** Para o `accept` do seletor de arquivos. */
export const ACEITOS = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.csv,.ofx,.json';

export const extensao = (nome: string) => (nome.includes('.') ? (nome.split('.').pop() ?? '').toLowerCase() : '');

export const ehImagem = (arquivo: { type: string; name: string }) =>
  arquivo.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extensao(arquivo.name));

function tipoAceito(arquivo: File): boolean {
  return MIMES.has(arquivo.type) || (EXTENSOES as readonly string[]).includes(extensao(arquivo.name));
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export interface Triagem {
  aceitos: File[];
  erros: string[];
}

/** Separa o que pode ir do que não pode, com um motivo claro para cada recusa. */
export function triarArquivos(arquivos: File[], jaNaConversa: number): Triagem {
  const aceitos: File[] = [];
  const erros: string[] = [];
  for (const a of arquivos) {
    if (!tipoAceito(a)) erros.push(`“${a.name}”: tipo não aceito. Use imagem, PDF, TXT, MD, CSV, OFX ou JSON.`);
    else if (a.size > LIMITE_BYTES) erros.push(`“${a.name}” tem ${tamanhoLegivel(a.size)}; o limite é 15 MB.`);
    else if (a.size === 0) erros.push(`“${a.name}” está vazio.`);
    else if (jaNaConversa + aceitos.length >= LIMITE_POR_CONVERSA) erros.push(`Cada conversa aceita até ${LIMITE_POR_CONVERSA} anexos; “${a.name}” ficou de fora.`);
    else aceitos.push(a);
  }
  return { aceitos, erros };
}
