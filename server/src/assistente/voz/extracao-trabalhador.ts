import { parentPort, workerData } from 'node:worker_threads';
import { extrairTarBz2 } from './extracao';

/** Worker thread: abre o pacote de uma voz fora da thread do servidor (ver extracao.ts). */

const { arquivo, destino, raiz } = workerData as { arquivo: string; destino: string; raiz: string };

extrairTarBz2(arquivo, destino, raiz).then(
  () => parentPort?.postMessage({ ok: true }),
  (erro: unknown) => parentPort?.postMessage({ ok: false, erro: erro instanceof Error ? erro.message : String(erro) }),
);
