import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

export type Banco = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** src/db e dist/db estão à mesma profundidade: dois níveis acima fica server/. */
export const PASTA_MIGRACOES = resolve(__dirname, '..', '..', 'drizzle');

/**
 * Abre (ou cria) o banco e aplica as migrações pendentes. `:memory:` nos testes.
 *
 * WAL: leituras não esperam a gravação da sincronização terminar.
 * foreign_keys: o SQLite vem com elas DESLIGADAS por padrão — sem isto o
 * ON DELETE CASCADE do schema seria só enfeite.
 */
export function abrirBanco(caminho: string): Banco {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 });
  const cliente = new Database(caminho);
  if (caminho !== ':memory:') {
    // Extrato bancário: só o dono lê. Vale também para bancos criados antes desta regra.
    chmodSync(dirname(caminho), 0o700);
    for (const f of [caminho, `${caminho}-wal`, `${caminho}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
  }
  cliente.pragma('journal_mode = WAL');
  cliente.pragma('foreign_keys = ON');
  cliente.pragma('busy_timeout = 5000');
  const banco = drizzle({ client: cliente, schema });
  migrate(banco, { migrationsFolder: PASTA_MIGRACOES });
  return banco;
}
