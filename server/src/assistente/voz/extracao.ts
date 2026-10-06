import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import { extract } from 'tar-stream';
import unbzip2 from 'unbzip2-stream';

/**
 * Abre o pacote .tar.bz2 de uma voz numa pasta. Só roda DEPOIS de o SHA-256 do
 * pacote bater com o catálogo; mesmo assim, desconfia: só arquivo e pasta
 * (nada de link), nada fora da pasta de destino, e um teto de tamanho e de
 * quantidade de itens (pacote que "explode" para no meio).
 *
 * O bzip2 é JavaScript puro (sem nada instalado no sistema) e pesado — ~20 s
 * para uma voz. Por isso roda numa worker thread: o servidor segue respondendo.
 */

export interface LimitesDeExtracao {
  bytes: number;
  itens: number;
}

/** Uma voz aberta tem ~85 MB e ~400 itens; folga larga, mas finita. */
export const LIMITES_PADRAO: LimitesDeExtracao = { bytes: 400 * 1024 * 1024, itens: 5_000 };

export class PacoteInvalido extends Error {}

/** Caminho do item, sem a pasta-raiz do pacote. null = é a própria raiz. Lança se escapar. */
export function caminhoSeguro(nome: string, raiz: string): string | null {
  const limpo = nome.replace(/\\/g, '/').replace(/^\.\//, '');
  if (limpo === raiz || limpo === `${raiz}/`) return null;
  if (!limpo.startsWith(`${raiz}/`)) throw new PacoteInvalido(`Item fora da pasta da voz: ${nome}`);
  const relativo = normalize(limpo.slice(raiz.length + 1));
  if (!relativo || relativo === '.' || isAbsolute(relativo) || relativo === '..' || relativo.startsWith(`..${sep}`) || relativo.includes(`${sep}..${sep}`)) {
    throw new PacoteInvalido(`Caminho inválido no pacote: ${nome}`);
  }
  return relativo.replace(/[/\\]+$/, '');
}

export async function extrairTarBz2(arquivo: string, destino: string, raiz: string, limites: LimitesDeExtracao = LIMITES_PADRAO): Promise<number> {
  mkdirSync(destino, { recursive: true });
  let bytes = 0;
  let itens = 0;
  const leitor = extract();
  leitor.on('entry', (cabecalho, conteudo: Readable, proximo) => {
    // Item abortado (pacote recusado) é destruído com o mesmo erro; quem informa é o `leitor`.
    conteudo.on('error', () => undefined);
    const falhar = (erro: unknown) => proximo(erro);
    try {
      itens += 1;
      if (itens > limites.itens) throw new PacoteInvalido('O pacote da voz tem itens demais.');
      const relativo = caminhoSeguro(cabecalho.name, raiz);
      const tipo = cabecalho.type ?? 'file';
      if (relativo === null || tipo === 'directory') {
        if (relativo) mkdirSync(join(destino, relativo), { recursive: true });
        conteudo.resume();
        conteudo.on('end', () => proximo());
        return;
      }
      if (tipo !== 'file') throw new PacoteInvalido(`Tipo de item não permitido no pacote (${tipo}).`);
      bytes += cabecalho.size ?? 0;
      if (bytes > limites.bytes) throw new PacoteInvalido('O pacote da voz é maior do que o esperado.');
      const alvo = join(destino, relativo);
      mkdirSync(join(alvo, '..'), { recursive: true });
      pipeline(conteudo, createWriteStream(alvo, { flags: 'wx', mode: 0o644 })).then(() => proximo(), falhar);
    } catch (erro) {
      falhar(erro);
    }
  });
  await new Promise<void>((resolve, reject) => {
    const entrada = createReadStream(arquivo);
    const descompressor = unbzip2();
    const parar = (erro: unknown) => {
      entrada.destroy();
      descompressor.destroy();
      leitor.destroy();
      reject(erro instanceof Error ? erro : new Error(String(erro)));
    };
    entrada.on('error', parar);
    descompressor.on('error', parar);
    leitor.on('error', parar);
    leitor.on('finish', () => resolve());
    entrada.pipe(descompressor).pipe(leitor);
  });
  return itens;
}

/** O arquivo compilado da worker fica ao lado deste (dist/assistente/voz/). */
const TRABALHADOR = join(__dirname, 'extracao-trabalhador.js');

/**
 * Extrai numa worker thread quando ela existe (o build); nos testes (fonte .ts),
 * no próprio processo. A mensagem de erro volta como texto.
 */
export function extrairEmSegundoPlano(arquivo: string, destino: string, raiz: string): Promise<void> {
  if (!existsSync(TRABALHADOR)) return extrairTarBz2(arquivo, destino, raiz).then(() => undefined);
  return new Promise((resolve, reject) => {
    const trabalhador = new Worker(TRABALHADOR, { workerData: { arquivo, destino, raiz } });
    let respondeu = false;
    trabalhador.once('message', (m: { ok: true } | { ok: false; erro: string }) => {
      respondeu = true;
      if (m.ok) resolve();
      else reject(new PacoteInvalido(m.erro));
    });
    trabalhador.once('error', (e) => {
      respondeu = true;
      reject(e);
    });
    trabalhador.once('exit', (codigo) => {
      if (!respondeu) reject(new Error(`A extração da voz parou sem resposta (código ${codigo}).`));
    });
  });
}
