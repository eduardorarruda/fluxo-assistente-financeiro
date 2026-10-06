import { fundirPorRrf, montarConsultaFts, RRF_K } from './consulta';

describe('montarConsultaFts', () => {
  it('cita cada palavra como frase com prefixo, unidas por OR', () => {
    expect(montarConsultaFts('ifood pizza')).toBe('"ifood"* OR "pizza"*');
  });

  it('descarta pontuação e sintaxe do FTS5: só sobram letras e dígitos', () => {
    expect(montarConsultaFts('NEAR(uber, "taxi") -luz* col:valor ^x')).toBe(
      '"NEAR"* OR "uber"* OR "taxi"* OR "luz"* OR "col"* OR "valor"*',
    );
  });

  it('palavras-chave do FTS5 viram texto comum, entre aspas', () => {
    expect(montarConsultaFts('OR AND NOT')).toBe('"OR"* OR "AND"* OR "NOT"*');
  });

  it('mantém acentos (o tokenizador do índice os remove dos dois lados)', () => {
    expect(montarConsultaFts('Açaí')).toBe('"Açaí"*');
  });

  it('junta letras decompostas (NFD) antes de separar as palavras', () => {
    expect(montarConsultaFts('Açaí')).toBe('"Açaí"*');
  });

  it('ignora palavras de uma letra e repetidas', () => {
    expect(montarConsultaFts('a pizza e PIZZA de 50')).toBe('"pizza"* OR "de"* OR "50"*');
  });

  it('limita a quantidade de palavras', () => {
    const muitas = Array.from({ length: 30 }, (_, i) => `palavra${i}`).join(' ');
    expect(montarConsultaFts(muitas)?.split(' OR ')).toHaveLength(12);
  });

  it('devolve null quando não sobra palavra', () => {
    expect(montarConsultaFts('')).toBeNull();
    expect(montarConsultaFts('" * ( ) - : ^ +')).toBeNull();
    expect(montarConsultaFts('a b c')).toBeNull();
  });
});

describe('fundirPorRrf', () => {
  it('soma 1/(k + posição) de cada lista em que o item aparece', () => {
    const fundidos = fundirPorRrf([
      { origem: 'palavra', ids: [10, 20] },
      { origem: 'vetor', ids: [30, 20] },
    ]);
    expect(fundidos.map((f) => f.id)).toEqual([20, 10, 30]);
    expect(fundidos[0]).toEqual({ id: 20, pontuacao: 2 / (RRF_K + 2), origem: ['palavra', 'vetor'] });
    expect(fundidos[1]).toEqual({ id: 10, pontuacao: 1 / (RRF_K + 1), origem: ['palavra'] });
  });

  it('empate: o menor id vem antes (ordem estável)', () => {
    const fundidos = fundirPorRrf([
      { origem: 'palavra', ids: [7] },
      { origem: 'vetor', ids: [3] },
    ]);
    expect(fundidos.map((f) => f.id)).toEqual([3, 7]);
  });

  it('listas vazias dão resultado vazio', () => {
    expect(fundirPorRrf([{ origem: 'palavra', ids: [] }])).toEqual([]);
  });
});
