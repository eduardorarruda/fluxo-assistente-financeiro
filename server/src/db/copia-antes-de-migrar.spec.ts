import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirBanco, PASTA_MIGRACOES } from './conexao';
import { COPIAS_GUARDADAS, copiarAntesDeMigrar, migracoesPendentes } from './copia-antes-de-migrar';

const pastas: string[] = [];
const pastaTemporaria = () => {
  const p = mkdtempSync(join(tmpdir(), 'fluxo-copia-'));
  pastas.push(p);
  return p;
};
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe('copiarAntesDeMigrar', () => {
  it('banco novo, sem tabelas: não copia nada', () => {
    const caminho = join(pastaTemporaria(), 'fluxo.db');
    const cliente = new Database(caminho);
    expect(copiarAntesDeMigrar(cliente, caminho, PASTA_MIGRACOES)).toBeNull();
    cliente.close();
  });

  it('banco em dia: nenhuma migração pendente, nenhuma cópia', () => {
    const caminho = join(pastaTemporaria(), 'fluxo.db');
    const banco = abrirBanco(caminho);
    expect(migracoesPendentes(banco.$client, PASTA_MIGRACOES)).toEqual([]);
    expect(copiarAntesDeMigrar(banco.$client, caminho, PASTA_MIGRACOES)).toBeNull();
    banco.$client.close();
  });

  it('com migração pendente: copia o banco inteiro, só para o dono, e guarda no máximo as últimas cópias', () => {
    const pasta = pastaTemporaria();
    const caminho = join(pasta, 'fluxo.db');
    const banco = abrirBanco(caminho);
    banco.$client.exec("CREATE TABLE marca (x TEXT); INSERT INTO marca VALUES ('antes');");
    // Simula uma versão nova do Fluxo: a última migração aplicada some do registro.
    banco.$client.exec('DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)');
    expect(migracoesPendentes(banco.$client, PASTA_MIGRACOES)).toHaveLength(1);

    let ultima = '';
    for (let i = 0; i < COPIAS_GUARDADAS + 2; i++) ultima = copiarAntesDeMigrar(banco.$client, caminho, PASTA_MIGRACOES, new Date(Date.UTC(2026, 10, 9, 12, i)))!;
    banco.$client.close();

    expect(statSync(ultima).mode & 0o777).toBe(0o600);
    expect(statSync(join(pasta, 'copias')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(pasta, 'copias'))).toHaveLength(COPIAS_GUARDADAS);
    const copia = new Database(ultima, { readonly: true });
    expect(copia.prepare('SELECT x FROM marca').get()).toEqual({ x: 'antes' });
    copia.close();
  });
});
