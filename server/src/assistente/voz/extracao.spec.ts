import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caminhoSeguro, extrairEmSegundoPlano, extrairTarBz2, PacoteInvalido } from './extracao';
import { ITENS_DE_VOZ, tarBz2 } from './testing/pacote-falso';
import { paraWav } from './wav';

describe('extração do pacote de voz', () => {
  let pasta: string;
  const RAIZ = 'vits-piper-pt_BR-teste-medium';

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-voz-extracao-'));
  });
  afterEach(() => rmSync(pasta, { recursive: true, force: true }));

  const gravar = async (itens: Parameters<typeof tarBz2>[0]) => {
    const arquivo = join(pasta, 'pacote.tar.bz2');
    writeFileSync(arquivo, await tarBz2(itens));
    return arquivo;
  };

  it('abre o pacote tirando a pasta-raiz', async () => {
    const arquivo = await gravar(ITENS_DE_VOZ(RAIZ));
    const destino = join(pasta, 'voz');
    await extrairTarBz2(arquivo, destino, RAIZ);
    expect(readFileSync(join(destino, 'tokens.txt'), 'utf8')).toBe('_ 0\n');
    expect(readFileSync(join(destino, 'espeak-ng-data', 'lang', 'roa', 'pt-BR'), 'utf8')).toBe('name brazil');
    expect(existsSync(join(destino, RAIZ))).toBe(false);
  });

  it('sem a worker compilada (testes), extrai no próprio processo', async () => {
    const arquivo = await gravar(ITENS_DE_VOZ(RAIZ));
    await extrairEmSegundoPlano(arquivo, join(pasta, 'voz'), RAIZ);
    expect(existsSync(join(pasta, 'voz', 'pt_BR-teste-medium.onnx'))).toBe(true);
  });

  it('recusa item que tenta sair da pasta (../) e não escreve nada fora', async () => {
    const arquivo = await gravar([...ITENS_DE_VOZ(RAIZ), { cabecalho: { name: `${RAIZ}/../../fora.txt` }, conteudo: 'x' }]);
    await expect(extrairTarBz2(arquivo, join(pasta, 'voz'), RAIZ)).rejects.toThrow();
    expect(existsSync(join(pasta, 'fora.txt'))).toBe(false);
  });

  it('recusa link simbólico e item fora da pasta-raiz', async () => {
    const comLink = await gravar([...ITENS_DE_VOZ(RAIZ), { cabecalho: { name: `${RAIZ}/atalho`, type: 'symlink', linkname: '/etc/passwd' } }]);
    await expect(extrairTarBz2(comLink, join(pasta, 'a'), RAIZ)).rejects.toThrow(/Tipo de item não permitido/);
    const forasteiro = await gravar([{ cabecalho: { name: 'outra-coisa/arquivo' }, conteudo: 'x' }]);
    await expect(extrairTarBz2(forasteiro, join(pasta, 'b'), RAIZ)).rejects.toThrow(/fora da pasta da voz/);
  });

  it('para no meio quando o pacote passa do teto de tamanho ou de itens', async () => {
    const arquivo = await gravar(ITENS_DE_VOZ(RAIZ));
    await expect(extrairTarBz2(arquivo, join(pasta, 'a'), RAIZ, { bytes: 5, itens: 100 })).rejects.toThrow(/maior do que o esperado/);
    await expect(extrairTarBz2(arquivo, join(pasta, 'b'), RAIZ, { bytes: 1e6, itens: 2 })).rejects.toThrow(/itens demais/);
  });

  it('arquivo que não é bzip2 vira erro (não trava)', async () => {
    const arquivo = join(pasta, 'lixo.tar.bz2');
    writeFileSync(arquivo, 'isto não é um pacote');
    await expect(extrairTarBz2(arquivo, join(pasta, 'x'), RAIZ)).rejects.toThrow();
  });

  it('caminhoSeguro: raiz, normal e tentativas de fuga', () => {
    expect(caminhoSeguro(`${RAIZ}/`, RAIZ)).toBeNull();
    expect(caminhoSeguro(`./${RAIZ}/a/b.txt`, RAIZ)).toBe(join('a', 'b.txt'));
    expect(() => caminhoSeguro(`${RAIZ}/a/../../x`, RAIZ)).toThrow(PacoteInvalido);
    expect(() => caminhoSeguro('/etc/passwd', RAIZ)).toThrow(PacoteInvalido);
    expect(() => caminhoSeguro(`${RAIZ}-irma/x`, RAIZ)).toThrow(PacoteInvalido);
  });
});

describe('WAV', () => {
  it('cabeçalho PCM 16 bits mono e amostras convertidas (com corte em ±1)', () => {
    const wav = paraWav(new Float32Array([0, 1, -1, 2, -0.5]), 22_050);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(22_050);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(10);
    expect(wav.length).toBe(44 + 10);
    expect([0, 1, 2, 3, 4].map((i) => wav.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32768, 32767, -16384]);
  });
});
