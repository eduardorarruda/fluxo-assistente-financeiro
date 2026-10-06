import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { VozDoCatalogo } from './catalogo';
import { arquivosDaVoz } from './sintetizador';

/**
 * Baixa e instala uma voz do catálogo:
 *
 * 1. baixa o pacote para um arquivo temporário, somando o SHA-256 e contando
 *    os bytes (passou do tamanho do catálogo, para na hora);
 * 2. confere tamanho e SHA-256 — só um pacote idêntico ao do catálogo é aberto;
 * 3. extrai numa pasta temporária e confere que tem modelo, tokens e espeak;
 * 4. troca de nome para `<pasta>/<id>` (atômico: ou a voz inteira, ou nada).
 *
 * A URL é sempre a do catálogo — nada da tela chega aqui.
 */

export type FetchDeVoz = (url: string, init: { signal: AbortSignal; redirect: 'follow' }) => Promise<Response>;
export type ExtratorDeVoz = (arquivo: string, destino: string, raiz: string) => Promise<void>;

export interface ProgressoDeVoz {
  etapa: 'baixando' | 'instalando';
  carregado: number;
  total: number;
}

/** Download de ~67 MB: 15 minutos cobrem até uma conexão bem ruim. */
const TEMPO_MAXIMO_MS = 15 * 60_000;
const PREFIXO_TEMPORARIO = '.temp-';

export class FalhaNoDownload extends Error {}

const sufixo = () => randomBytes(6).toString('hex');

/** Restos de um download interrompido (o servidor caiu no meio): podem ir embora. */
export function limparTemporarios(pasta: string, id: string): void {
  if (!existsSync(pasta)) return;
  for (const nome of readdirSync(pasta)) {
    if (nome.startsWith(`${PREFIXO_TEMPORARIO}${id}-`)) rmSync(join(pasta, nome), { recursive: true, force: true });
  }
}

export async function baixarVoz(
  voz: VozDoCatalogo,
  pasta: string,
  dependencias: { fetch: FetchDeVoz; extrair: ExtratorDeVoz; aoProgredir?: (p: ProgressoDeVoz) => void },
): Promise<void> {
  mkdirSync(pasta, { recursive: true, mode: 0o755 });
  limparTemporarios(pasta, voz.id);
  const marca = `${PREFIXO_TEMPORARIO}${voz.id}-${sufixo()}`;
  const pacote = join(pasta, `${marca}.tar.bz2`);
  const extraida = join(pasta, marca);
  try {
    await baixarConferindo(voz, pacote, dependencias);
    dependencias.aoProgredir?.({ etapa: 'instalando', carregado: voz.bytes, total: voz.bytes });
    await dependencias.extrair(pacote, extraida, voz.raiz);
    if (!arquivosDaVoz(extraida)) throw new FalhaNoDownload('O pacote da voz veio sem o modelo, os tokens ou a fonética.');
    const final = join(pasta, voz.id);
    rmSync(final, { recursive: true, force: true });
    renameSync(extraida, final);
  } finally {
    rmSync(pacote, { force: true });
    rmSync(extraida, { recursive: true, force: true });
  }
}

async function baixarConferindo(
  voz: VozDoCatalogo,
  destino: string,
  { fetch, aoProgredir }: { fetch: FetchDeVoz; aoProgredir?: (p: ProgressoDeVoz) => void },
): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(voz.url, { signal: AbortSignal.timeout(TEMPO_MAXIMO_MS), redirect: 'follow' });
  } catch {
    throw new FalhaNoDownload('Não foi possível baixar a voz: sem conexão com o GitHub.');
  }
  if (!resposta.ok || !resposta.body) throw new FalhaNoDownload(`Não foi possível baixar a voz (o GitHub respondeu ${resposta.status}).`);
  const anunciado = Number(resposta.headers.get('content-length') ?? 0);
  if (anunciado && anunciado !== voz.bytes) throw new FalhaNoDownload('O pacote da voz não tem o tamanho esperado; nada foi instalado.');

  const hash = createHash('sha256');
  let carregado = 0;
  let ultimoAviso = 0;
  const conferir = new Transform({
    transform(pedaco: Buffer, _codificacao, pronto) {
      carregado += pedaco.length;
      if (carregado > voz.bytes) return pronto(new FalhaNoDownload('O pacote da voz é maior do que o esperado; nada foi instalado.'));
      hash.update(pedaco);
      // Avisa a cada ~1% (não a cada pedaço de 64 KB).
      if (carregado - ultimoAviso >= voz.bytes / 100 || carregado === voz.bytes) {
        ultimoAviso = carregado;
        aoProgredir?.({ etapa: 'baixando', carregado, total: voz.bytes });
      }
      pronto(null, pedaco);
    },
  });
  try {
    await pipeline(Readable.fromWeb(resposta.body as never), conferir, createWriteStream(destino, { mode: 0o600 }));
  } catch (erro) {
    if (erro instanceof FalhaNoDownload) throw erro;
    throw new FalhaNoDownload('O download da voz foi interrompido. Tente de novo.');
  }
  if (carregado !== voz.bytes) throw new FalhaNoDownload('O download da voz veio incompleto. Tente de novo.');
  if (hash.digest('hex') !== voz.sha256) throw new FalhaNoDownload('O pacote da voz não confere com a assinatura (SHA-256); nada foi instalado.');
}
