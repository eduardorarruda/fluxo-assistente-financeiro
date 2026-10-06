import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARQUIVO_CHAVE_GEMINI, CofreChaveGemini } from './chave-gemini';

const CHAVE = 'AIzaSyTESTE-chave_falsa-0123456789AbCd';

describe('CofreChaveGemini', () => {
  let base: string;
  let pasta: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'fluxo-cofre-'));
    pasta = join(base, 'assistente');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('grava a chave num arquivo 0600, numa pasta 0700, na raiz da pasta do assistente (fora de conversas/)', () => {
    const cofre = new CofreChaveGemini(pasta);
    cofre.salvar(`  ${CHAVE}\n`);
    const arquivo = join(pasta, ARQUIVO_CHAVE_GEMINI);
    expect(statSync(arquivo).mode & 0o777).toBe(0o600);
    expect(statSync(pasta).mode & 0o777).toBe(0o700);
    expect(arquivo).not.toContain('conversas');
    expect(readdirSync(pasta)).toEqual([ARQUIVO_CHAVE_GEMINI]);
    expect(cofre.ler()).toBe(CHAVE);
  });

  it('mostra só os 4 últimos caracteres', () => {
    const cofre = new CofreChaveGemini(pasta);
    expect(cofre.configurada()).toBe(false);
    expect(cofre.final()).toBeNull();
    cofre.salvar(CHAVE);
    expect(cofre.configurada()).toBe(true);
    expect(cofre.final()).toBe('…AbCd');
  });

  it('troca e remove a chave', () => {
    const cofre = new CofreChaveGemini(pasta);
    cofre.salvar(CHAVE);
    cofre.salvar('AIzaOutraChaveDeTesteBemComprida-WxYz');
    expect(cofre.final()).toBe('…WxYz');
    cofre.remover();
    expect(cofre.ler()).toBeNull();
    expect(() => cofre.remover()).not.toThrow();
  });

  it('recusa formato que não é de chave (espaços, aspas, curta demais) sem gravar nada', () => {
    const cofre = new CofreChaveGemini(pasta);
    for (const ruim of ['curta', 'chave com espaço no meio 1234567890', '"AIzaSyTESTE-chave_falsa-0123456789"', 'a'.repeat(201)]) {
      expect(() => cofre.salvar(ruim)).toThrow('Formato de chave inválido.');
    }
    expect(cofre.configurada()).toBe(false);
  });

  it('arquivo adulterado com conteúdo que não é chave conta como sem chave', () => {
    const cofre = new CofreChaveGemini(pasta);
    cofre.salvar(CHAVE);
    writeFileSync(join(pasta, ARQUIVO_CHAVE_GEMINI), 'isto não é uma chave');
    expect(cofre.ler()).toBeNull();
  });
});
