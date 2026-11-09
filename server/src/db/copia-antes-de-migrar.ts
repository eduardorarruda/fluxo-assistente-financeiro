import type Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Quantas cópias de antes-de-migrar ficam guardadas (as mais antigas saem). */
export const COPIAS_GUARDADAS = 5;
const PREFIXO = 'fluxo-antes-de-migrar-';

interface Diario {
  entries: { when: number; tag: string }[];
}

/** Migrações do diário que o banco ainda não aplicou (o Drizzle compara pelo instante `when`). */
export function migracoesPendentes(cliente: Database.Database, pastaMigracoes: string): string[] {
  const diario = JSON.parse(readFileSync(join(pastaMigracoes, 'meta', '_journal.json'), 'utf8')) as Diario;
  const tabela = cliente.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!tabela) return diario.entries.map((e) => e.tag);
  const ultima = cliente.prepare('SELECT max(created_at) AS quando FROM __drizzle_migrations').get() as { quando: number | null };
  return diario.entries.filter((e) => e.when > (ultima.quando ?? 0)).map((e) => e.tag);
}

/**
 * Antes de mudar o formato do banco, guarda uma cópia íntegra dele (VACUUM INTO,
 * consistente mesmo com WAL) em `<pasta do banco>/copias/`, só para o dono (0600).
 * Banco novo (sem tabelas) não precisa de cópia. Devolve o caminho da cópia, ou null.
 */
export function copiarAntesDeMigrar(cliente: Database.Database, caminho: string, pastaMigracoes: string, agora = new Date()): string | null {
  if (caminho === ':memory:') return null;
  const temDados = cliente.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
  if (!temDados || migracoesPendentes(cliente, pastaMigracoes).length === 0) return null;
  const pasta = join(dirname(caminho), 'copias');
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  chmodSync(pasta, 0o700);
  const destino = join(pasta, `${PREFIXO}${agora.toISOString().replace(/[:.]/g, '-')}.db`);
  cliente.prepare('VACUUM INTO ?').run(destino);
  chmodSync(destino, 0o600);
  const antigas = readdirSync(pasta).filter((f) => f.startsWith(PREFIXO)).sort().slice(0, -COPIAS_GUARDADAS);
  for (const f of antigas) rmSync(join(pasta, f), { force: true });
  return destino;
}
