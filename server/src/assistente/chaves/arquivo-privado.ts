import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chaves pagas (Nano Banana, contas por API) moram em arquivos próprios, fora
 * do banco e fora da pasta das conversas (que o modelo consegue ler): arquivo
 * 0600 numa pasta 0700. Daqui a chave só sai para o cabeçalho da chamada ao
 * provedor — nunca para a API do Fluxo, o log, a linha de comando ou o ambiente dos CLIs.
 */

const MODO_PASTA = 0o700;
const MODO_ARQUIVO = 0o600;
const DIGITOS_FINAIS = 4;

/** Grava num temporário 0600 e renomeia: nunca existe um arquivo pela metade nem com permissão aberta. */
export function gravarChavePrivada(pasta: string, arquivo: string, chave: string): void {
  mkdirSync(pasta, { recursive: true, mode: MODO_PASTA });
  chmodSync(pasta, MODO_PASTA); // se já existia com outra permissão
  const temporario = join(pasta, `.${arquivo}-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(temporario, chave, { mode: MODO_ARQUIVO });
    chmodSync(temporario, MODO_ARQUIVO);
    renameSync(temporario, join(pasta, arquivo));
  } finally {
    rmSync(temporario, { force: true });
  }
}

/**
 * A chave do arquivo, se ele existe e o conteúdo tem o formato esperado
 * (arquivo adulterado conta como sem chave). Erro de leitura que não é
 * "não existe" devolve o código (nunca o conteúdo) para quem chamou registrar.
 */
export function lerChavePrivada(caminho: string, formato: RegExp): { chave: string | null; erro: string | null } {
  try {
    const chave = readFileSync(caminho, 'utf8').trim();
    return { chave: formato.test(chave) ? chave : null, erro: null };
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    return { chave: null, erro: codigo === 'ENOENT' ? null : (codigo ?? 'erro') };
  }
}

export function removerChavePrivada(caminho: string): void {
  rmSync(caminho, { force: true });
}

/** "…AbCd": o bastante para a pessoa reconhecer qual chave está lá, sem revelar a chave. */
export function finalDaChave(chave: string | null): string | null {
  return chave ? `…${chave.slice(-DIGITOS_FINAIS)}` : null;
}
