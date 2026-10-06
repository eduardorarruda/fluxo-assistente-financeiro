import { LIMITE_BYTES, tamanhoLegivel, triarArquivos } from './regras-anexos';

const arquivo = (nome: string, tipo: string, bytes = 10) => {
  const f = new File(['x'], nome, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};

describe('triarArquivos', () => {
  it('aceita imagem, PDF e texto — inclusive .ofx e .md sem tipo MIME', () => {
    const { aceitos, erros } = triarArquivos(
      [arquivo('a.png', 'image/png'), arquivo('b.pdf', 'application/pdf'), arquivo('extrato.ofx', ''), arquivo('notas.md', ''), arquivo('c.csv', 'text/csv')],
      0,
    );
    expect(aceitos.map((a) => a.name)).toEqual(['a.png', 'b.pdf', 'extrato.ofx', 'notas.md', 'c.csv']);
    expect(erros).toEqual([]);
  });

  it('recusa tipo não aceito, arquivo grande demais e vazio, com o motivo', () => {
    const { aceitos, erros } = triarArquivos(
      [arquivo('virus.exe', 'application/x-msdownload'), arquivo('grande.pdf', 'application/pdf', LIMITE_BYTES + 1), arquivo('vazio.txt', 'text/plain', 0)],
      0,
    );
    expect(aceitos).toEqual([]);
    expect(erros[0]).toMatch(/tipo não aceito/);
    expect(erros[1]).toMatch(/limite é 15 MB/);
    expect(erros[2]).toMatch(/vazio/);
  });

  it('respeita o limite de 20 anexos por conversa contando os que já estão lá', () => {
    const { aceitos, erros } = triarArquivos([arquivo('1.txt', 'text/plain'), arquivo('2.txt', 'text/plain')], 19);
    expect(aceitos.map((a) => a.name)).toEqual(['1.txt']);
    expect(erros[0]).toMatch(/até 20 anexos/);
  });
});

describe('tamanhoLegivel', () => {
  it('formata bytes, KB e MB', () => {
    expect(tamanhoLegivel(512)).toBe('512 B');
    expect(tamanhoLegivel(2048)).toBe('2 KB');
    expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
