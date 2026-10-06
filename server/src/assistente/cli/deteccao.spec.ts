import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectarCli, pastasCandidatas, validarCaminho } from './deteccao';

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'fluxo-deteccao-'));
});

afterEach(() => rmSync(raiz, { recursive: true, force: true }));

function executavel(caminho: string, conteudo = '#!/bin/sh\necho 1.2.3\n') {
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, conteudo);
  chmodSync(caminho, 0o755);
  return caminho;
}

const semVersao = async () => null;

describe('validarCaminho', () => {
  it('aceita executável com o nome certo', () => {
    expect(validarCaminho(executavel(join(raiz, 'bin', 'claude')), 'claude')).toBeNull();
  });

  it('recusa caminho relativo, inexistente, pasta, sem permissão de execução ou com outro nome', () => {
    expect(validarCaminho('bin/claude', 'claude')).toMatch(/absoluto/);
    expect(validarCaminho(join(raiz, 'nao-existe', 'claude'), 'claude')).toMatch(/não existe/);
    mkdirSync(join(raiz, 'claude'));
    expect(validarCaminho(join(raiz, 'claude'), 'claude')).toMatch(/não é um arquivo/);
    writeFileSync(join(raiz, 'gemini'), 'x');
    expect(validarCaminho(join(raiz, 'gemini'), 'gemini')).toMatch(/execu/);
    expect(validarCaminho(executavel(join(raiz, 'bin', 'bash')), 'claude')).toMatch(/claude/);
  });
});

describe('pastasCandidatas', () => {
  it('inclui o PATH e as pastas de instalação comuns (o menu do KDE não carrega o PATH do terminal)', () => {
    const pastas = pastasCandidatas({ PATH: '/usr/bin:/opt/x' }, '/home/ana');
    expect(pastas.slice(0, 2)).toEqual(['/usr/bin', '/opt/x']);
    expect(pastas).toEqual(expect.arrayContaining(['/home/ana/.local/bin', '/home/ana/.npm-global/bin', '/usr/local/bin', '/home/ana/.bun/bin']));
  });
});

describe('detectarCli', () => {
  it('usa o caminho configurado quando ele é válido', async () => {
    const caminho = executavel(join(raiz, 'meu', 'claude'));
    const r = await detectarCli('claude', caminho, { env: { PATH: '' }, home: raiz, versaoPorExecucao: async () => '9.9.9' });
    expect(r).toEqual({ encontrado: { caminho, versao: '9.9.9' }, erro: null });
  });

  it('caminho configurado inválido é erro (não cai para outro sozinho)', async () => {
    const r = await detectarCli('claude', join(raiz, 'x', 'claude'), { env: { PATH: '' }, home: raiz, versaoPorExecucao: semVersao });
    expect(r.encontrado).toBeNull();
    expect(r.erro).toMatch(/não existe/);
  });

  it('procura no PATH e nas pastas comuns', async () => {
    const caminho = executavel(join(raiz, '.local', 'bin', 'codex'));
    const r = await detectarCli('codex', null, { env: { PATH: '/nao/existe' }, home: raiz, versaoPorExecucao: semVersao });
    expect(r.encontrado?.caminho).toBe(caminho);
  });

  it('não encontrado não é erro, só ausência', async () => {
    expect(await detectarCli('gemini', null, { env: { PATH: '' }, home: raiz, versaoPorExecucao: semVersao })).toEqual({ encontrado: null, erro: null });
  });

  it('versão pelo nome da pasta do instalador nativo do Claude (sem executar nada)', async () => {
    const real = executavel(join(raiz, '.local', 'share', 'claude', 'versions', '2.1.268'));
    mkdirSync(join(raiz, '.local', 'bin'), { recursive: true });
    symlinkSync(real, join(raiz, '.local', 'bin', 'claude'));
    const executou = vi.fn(async () => 'x');
    const r = await detectarCli('claude', null, { env: { PATH: '' }, home: raiz, versaoPorExecucao: executou });
    expect(r.encontrado?.versao).toBe('2.1.268');
    expect(executou).not.toHaveBeenCalled();
  });

  it('versão pelo package.json do pacote npm (o gemini demora para responder --version)', async () => {
    const pacote = join(raiz, 'lib', 'node_modules', '@google', 'gemini-cli');
    mkdirSync(join(pacote, 'dist'), { recursive: true });
    writeFileSync(join(pacote, 'package.json'), JSON.stringify({ name: '@google/gemini-cli', version: '0.62.0' }));
    const js = executavel(join(pacote, 'dist', 'index.js'), '#!/usr/bin/env node\n');
    mkdirSync(join(raiz, 'bin'));
    symlinkSync(js, join(raiz, 'bin', 'gemini'));
    const r = await detectarCli('gemini', null, { env: { PATH: join(raiz, 'bin') }, home: raiz, versaoPorExecucao: semVersao });
    expect(r.encontrado?.versao).toBe('0.62.0');
  });
});
