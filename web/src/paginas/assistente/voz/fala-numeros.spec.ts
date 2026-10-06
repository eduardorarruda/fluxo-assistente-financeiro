import { normalizarParaFala, porExtenso, reaisPorExtenso } from './fala-numeros';

describe('porExtenso', () => {
  it.each([
    [0, 'zero'], [1, 'um'], [16, 'dezesseis'], [21, 'vinte e um'], [100, 'cem'], [101, 'cento e um'], [110, 'cento e dez'],
    [150, 'cento e cinquenta'], [999, 'novecentos e noventa e nove'], [1000, 'mil'], [1001, 'mil e um'], [1020, 'mil e vinte'],
    [1230, 'mil duzentos e trinta'], [1234, 'mil duzentos e trinta e quatro'], [1500, 'mil e quinhentos'], [2000, 'dois mil'],
    [2026, 'dois mil e vinte e seis'], [10_500, 'dez mil e quinhentos'], [100_000, 'cem mil'], [123_456, 'cento e vinte e três mil quatrocentos e cinquenta e seis'],
    [1_000_000, 'um milhão'], [1_200_000, 'um milhão e duzentos mil'], [2_500_000, 'dois milhões e quinhentos mil'],
    [1_234_567, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete'], [3_000_000_000, 'três bilhões'],
  ])('%d → %s', (n, esperado) => {
    expect(porExtenso(n)).toBe(esperado);
  });

  it('feminino: uma, duas, duzentas (mas "dois milhões" continua masculino)', () => {
    expect(porExtenso(1, 'f')).toBe('uma');
    expect(porExtenso(2, 'f')).toBe('duas');
    expect(porExtenso(22, 'f')).toBe('vinte e duas');
    expect(porExtenso(200, 'f')).toBe('duzentas');
    expect(porExtenso(2_000, 'f')).toBe('duas mil');
    expect(porExtenso(2_000_000, 'f')).toBe('dois milhões');
  });

  it('o que não é inteiro não-negativo volta como está', () => {
    expect(porExtenso(-1)).toBe('-1');
    expect(porExtenso(1.5)).toBe('1.5');
  });
});

describe('reaisPorExtenso', () => {
  it.each([
    [1, 0, 'um real'], [0, 50, 'cinquenta centavos'], [0, 1, 'um centavo'], [0, 0, 'zero reais'], [2, 1, 'dois reais e um centavo'],
    [1_000_000, 0, 'um milhão de reais'], [1_500_000, 0, 'um milhão e quinhentos mil reais'],
  ])('%d,%d → %s', (inteiro, centavos, esperado) => {
    expect(reaisPorExtenso(inteiro, centavos)).toBe(esperado);
  });
});

describe('normalizarParaFala', () => {
  it.each([
    // dinheiro
    ['Você gastou R$ 1.234,56 no cartão.', 'Você gastou mil duzentos e trinta e quatro reais e cinquenta e seis centavos no cartão.'],
    ['Foram R$ 150 de mercado.', 'Foram cento e cinquenta reais de mercado.'],
    ['Sobrou R$1,00.', 'Sobrou um real.'],
    ['Custa R$ 0,50.', 'Custa cinquenta centavos.'],
    ['Saldo de -R$ 20,00.', 'Saldo de menos vinte reais.'],
    ['Saldo de R$ -20,5.', 'Saldo de menos vinte reais e cinquenta centavos.'],
    ['Juntou R$ 2 mil.', 'Juntou dois mil reais.'],
    ['Juntou R$ 1,5 mil.', 'Juntou mil e quinhentos reais.'],
    ['Patrimônio de R$ 1,2 milhão.', 'Patrimônio de um milhão e duzentos mil reais.'],
    ['Um total de R$ 10.000,00.', 'Um total de dez mil reais.'],
    // porcentagem
    ['Uns 8% a menos.', 'Uns oito por cento a menos.'],
    ['Subiu 12,5%.', 'Subiu doze vírgula cinco por cento.'],
    ['Caiu -3%.', 'Caiu menos três por cento.'],
    // datas
    ['Vence em 05/09.', 'Vence em cinco de setembro.'],
    ['Vence em 01/10.', 'Vence em primeiro de outubro.'],
    ['Pago em 05/09/2026.', 'Pago em cinco de setembro de dois mil e vinte e seis.'],
    ['Desde 2026-09-15.', 'Desde quinze de setembro de dois mil e vinte e seis.'],
    ['Fatura de 09/2026.', 'Fatura de setembro de dois mil e vinte e seis.'],
    ['Em set/2026 e ago/26.', 'Em setembro de dois mil e vinte e seis e agosto de dois mil e vinte e seis.'],
    // parcelas, vezes, horas, ordinais
    ['É a parcela 3/10.', 'É a parcela três de dez.'],
    ['Parcela 2 de 12.', 'Parcela duas de doze.'],
    ['Comprou em 10x.', 'Comprou em dez vezes.'],
    ['Paga 1x por mês.', 'Paga uma vez por mês.'],
    ['Às 14h30 e às 9h.', 'Às catorze horas e trinta e às nove horas.'],
    ['O 1º lugar e a 2ª compra.', 'O primeiro lugar e a segunda compra.'],
    ['No 21º dia.', 'No vigésimo primeiro dia.'],
    // números soltos e gênero
    ['Foram 2 compras e 2 boletos.', 'Foram duas compras e dois boletos.'],
    ['Tem 1 fatura aberta.', 'Tem uma fatura aberta.'],
    ['Foram 1.234 transações.', 'Foram mil duzentas e trinta e quatro transações.'],
    ['Nota 3,05 de média.', 'Nota três vírgula zero cinco de média.'],
    ['Entre 3 4 e 5.', 'Entre três quatro e cinco.'],
  ])('%s', (entrada, esperado) => {
    expect(normalizarParaFala(entrada)).toBe(esperado);
  });

  it('não mexe em números colados a letras (4G, MP3), em códigos longos nem em texto sem número', () => {
    expect(normalizarParaFala('Plano 4G e arquivo MP3.')).toBe('Plano 4G e arquivo MP3.');
    expect(normalizarParaFala('Código 12345678901234.')).toBe('Código 12345678901234.');
    expect(normalizarParaFala('O maior gasto foi mercado.')).toBe('O maior gasto foi mercado.');
  });

  it('data impossível fica como número', () => {
    expect(normalizarParaFala('Em 45/13.')).not.toContain('de');
  });
});
