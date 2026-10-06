import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChavesDeApi, PASTA_CHAVES } from './chaves-de-api';

/** Chave de mentira: nunca uma de verdade. */
const CHAVE = 'sk-teste-chave-falsa-0123456789AbCd';

describe('ChavesDeApi', () => {
  let base: string;
  let chaves: ChavesDeApi;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'fluxo-chaves-'));
    chaves = new ChavesDeApi(base);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('grava cada chave em <pastaAssistente>/chaves/<contaId>, arquivo 0600 numa pasta 0700', () => {
    chaves.salvar('conta-1', `  ${CHAVE}\n`);
    const pasta = join(base, PASTA_CHAVES);
    expect(statSync(pasta).mode & 0o777).toBe(0o700);
    expect(statSync(join(pasta, 'conta-1')).mode & 0o777).toBe(0o600);
    expect(readdirSync(pasta)).toEqual(['conta-1']);
    expect(chaves.ler('conta-1')).toBe(CHAVE);
    expect(chaves.existe('conta-1')).toBe(true);
    expect(chaves.final('conta-1')).toBe('…AbCd');
  });

  it('sem chave: ler, existe e final dizem que não há', () => {
    expect(chaves.ler('nenhuma')).toBeNull();
    expect(chaves.existe('nenhuma')).toBe(false);
    expect(chaves.final('nenhuma')).toBeNull();
  });

  it('troca e remove (remover de novo não quebra)', () => {
    chaves.salvar('c', CHAVE);
    chaves.salvar('c', 'sk-outra-chave-de-teste-bem-comprida-WxYz');
    expect(chaves.final('c')).toBe('…WxYz');
    chaves.remover('c');
    expect(chaves.ler('c')).toBeNull();
    expect(() => chaves.remover('c')).not.toThrow();
  });

  it('recusa chave fora do formato sem gravar nada', () => {
    for (const ruim of ['curta', 'chave com espaço no meio 1234567890', `${'a'.repeat(301)}`, 'chave-com-acento-ção-1234567890']) {
      expect(() => chaves.salvar('c', ruim)).toThrow('Formato de chave inválido.');
    }
    expect(chaves.existe('c')).toBe(false);
  });

  it('id de conta que viraria caminho fora da pasta é recusado', () => {
    for (const ruim of ['../fora', 'a/b', '.', '..', '', 'x'.repeat(101)]) {
      expect(() => chaves.salvar(ruim, CHAVE)).toThrow();
      expect(chaves.ler(ruim)).toBeNull();
    }
  });

  it('arquivo adulterado conta como sem chave', () => {
    chaves.salvar('c', CHAVE);
    writeFileSync(join(base, PASTA_CHAVES, 'c'), 'isto não é chave');
    expect(chaves.ler('c')).toBeNull();
  });
});
