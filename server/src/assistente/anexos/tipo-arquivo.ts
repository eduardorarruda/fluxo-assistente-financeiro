/**
 * Que arquivo é este? Decidido pelos bytes, não pelo nome: um ".txt" que é
 * executável, ou uma "foto.png" que é PDF, não engana. Só os tipos que o
 * assistente sabe aproveitar passam.
 */

export type TipoAnexo = 'imagem' | 'pdf' | 'texto';

export interface ArquivoIdentificado {
  tipo: TipoAnexo;
  mime: string;
  /** Extensão canônica, sem ponto — é ela que vai no nome do arquivo gravado. */
  extensao: string;
}

const TEXTO_POR_EXTENSAO: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  ofx: 'application/x-ofx',
  json: 'application/json',
};

/** Quanto do começo do arquivo olhar para decidir se é binário. */
const AMOSTRA_BINARIO = 64 * 1024;
const FRACAO_MAXIMA_DE_CONTROLE = 0.1;

export function identificarArquivo(bytes: Buffer, nome: string): ArquivoIdentificado | null {
  if (bytes.length === 0) return null;
  const binario = porAssinatura(bytes);
  if (binario) return binario;
  const extensao = nome.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? '';
  const mime = TEXTO_POR_EXTENSAO[extensao];
  if (!mime || pareceBinario(bytes)) return null;
  return { tipo: 'texto', mime, extensao };
}

function porAssinatura(b: Buffer): ArquivoIdentificado | null {
  const comeca = (assinatura: number[], deslocamento = 0) => assinatura.every((v, i) => b[deslocamento + i] === v);
  const ascii = (inicio: number, fim: number) => b.subarray(inicio, fim).toString('latin1');
  if (comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { tipo: 'imagem', mime: 'image/png', extensao: 'png' };
  if (comeca([0xff, 0xd8, 0xff])) return { tipo: 'imagem', mime: 'image/jpeg', extensao: 'jpg' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { tipo: 'imagem', mime: 'image/gif', extensao: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { tipo: 'imagem', mime: 'image/webp', extensao: 'webp' };
  if (ascii(0, 5) === '%PDF-') return { tipo: 'pdf', mime: 'application/pdf', extensao: 'pdf' };
  return null;
}

/** Byte nulo, ou caracteres de controle demais, no começo do arquivo. */
function pareceBinario(bytes: Buffer): boolean {
  const amostra = bytes.subarray(0, AMOSTRA_BINARIO);
  let controle = 0;
  for (const b of amostra) {
    if (b === 0) return true;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) controle++;
  }
  return controle / amostra.length > FRACAO_MAXIMA_DE_CONTROLE;
}

/**
 * Texto de um anexo. UTF-8 quando é válido; senão Windows-1252, que é como
 * bancos brasileiros ainda exportam OFX e CSV.
 */
export function decodificarTexto(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
