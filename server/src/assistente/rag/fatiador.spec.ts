import { fatiar } from './fatiador';

const palavras = (s: string) => s.split(/\s+/).filter(Boolean);

describe('fatiar', () => {
  it('texto vazio ou só espaços não gera trecho', () => {
    expect(fatiar('')).toEqual([]);
    expect(fatiar('  \n\t \n')).toEqual([]);
  });

  it('texto curto vira um trecho só, sem espaços sobrando', () => {
    expect(fatiar('  Fatura de setembro: R$ 1.234,56  ')).toEqual(['Fatura de setembro: R$ 1.234,56']);
  });

  it('nenhum trecho passa do tamanho', () => {
    const texto = Array.from({ length: 400 }, (_, i) => `Frase número ${i} com algumas palavras.`).join(' ');
    const trechos = fatiar(texto, { tamanho: 300, sobreposicao: 50 });
    expect(trechos.length).toBeGreaterThan(5);
    for (const t of trechos) expect(t.length).toBeLessThanOrEqual(300);
  });

  it('não perde nenhuma palavra', () => {
    const texto = Array.from({ length: 300 }, (_, i) => `p${i}`).join(' ');
    const juntas = new Set(fatiar(texto, { tamanho: 120, sobreposicao: 20 }).flatMap(palavras));
    for (const p of palavras(texto)) expect(juntas.has(p)).toBe(true);
  });

  it('não corta palavra no meio', () => {
    const texto = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(' ');
    const originais = new Set(palavras(texto));
    for (const t of fatiar(texto, { tamanho: 100, sobreposicao: 20 })) {
      for (const p of palavras(t)) expect(originais.has(p)).toBe(true);
    }
  });

  it('prefere quebrar entre parágrafos', () => {
    const a = 'A'.repeat(10) + ' ' + 'primeiro parágrafo '.repeat(8).trim();
    const b = 'segundo parágrafo '.repeat(8).trim();
    const trechos = fatiar(`${a}\n\n${b}`, { tamanho: 200, sobreposicao: 0 });
    expect(trechos[0]).toBe(a);
    expect(trechos[1]).toBe(b);
  });

  it('prefere quebrar no fim de uma frase a quebrar no meio dela', () => {
    const texto = `${'Uma frase completa sobre gastos. '.repeat(5)}${'continua sem ponto '.repeat(10)}`;
    const [primeiro] = fatiar(texto, { tamanho: 200, sobreposicao: 0 });
    expect(primeiro?.endsWith('.')).toBe(true);
  });

  it('trechos vizinhos se sobrepõem um pouco (contexto na borda)', () => {
    const texto = Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ');
    const [a, b] = fatiar(texto, { tamanho: 100, sobreposicao: 30 });
    const fimDeA = palavras(a!).slice(-2);
    expect(palavras(b!).slice(0, 12)).toEqual(expect.arrayContaining(fimDeA));
  });

  it('palavra maior que o trecho é cortada à força em vez de travar', () => {
    const trechos = fatiar('x'.repeat(250), { tamanho: 100, sobreposicao: 10 });
    expect(trechos.join('').replace(/\s/g, '').length).toBeGreaterThanOrEqual(250);
    for (const t of trechos) expect(t.length).toBeLessThanOrEqual(100);
  });

  it('junta linhas em branco repetidas e espaços em excesso', () => {
    expect(fatiar('a   b\n\n\n\n\nc\t\td')).toEqual(['a b\n\nc d']);
  });

  it('recusa configuração impossível', () => {
    expect(() => fatiar('abc', { tamanho: 50, sobreposicao: 50 })).toThrow();
  });
});
