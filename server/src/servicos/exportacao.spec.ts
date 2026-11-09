import { describe, expect, it } from 'vitest';
import { abrirBanco } from '../db/conexao';
import { Exportador, TABELAS_EXPORTADAS } from './exportacao';

describe('Exportador', () => {
  it('leva todas as tabelas de dados, com os valores como estão (centavos inteiros)', () => {
    const banco = abrirBanco(':memory:');
    banco.$client.exec(`INSERT INTO regras (id, texto, categoria_id, prioridade, criada_em) VALUES ('r1', 'padaria', 'mercado', 1, '2026-11-09')`);
    const saida = new Exportador(banco).exportar(new Date('2026-11-09T12:00:00Z'));
    expect(Object.keys(saida.tabelas).sort()).toEqual([...TABELAS_EXPORTADAS].sort());
    expect(saida.tabelas.regras).toHaveLength(1);
    expect(saida.geradaEm).toBe('2026-11-09T12:00:00.000Z');
  });

  it('cobre toda tabela do banco, menos as derivadas (um esquecimento numa migração nova quebra este teste)', () => {
    const banco = abrirBanco(':memory:');
    const todas = (banco.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'trechos%'").all() as { name: string }[])
      .map((t) => t.name)
      .filter((n) => n !== 'sessoes_cli');
    expect(todas.sort()).toEqual([...TABELAS_EXPORTADAS].sort());
  });
});
