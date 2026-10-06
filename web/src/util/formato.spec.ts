import { comSinal, diaAmigavel, emQuantosDias, lerReais, mesCurto, nomeDoMes, reais, somarMeses } from './formato';

// Intl usa espaço não separável entre R$ e o número.
const sem = (s: string) => s.replace(/ /g, ' ');

describe('formato', () => {
  it('dinheiro em pt-BR, com sinal de menos tipográfico', () => {
    expect(sem(reais(123456))).toBe('R$ 1.234,56');
    expect(sem(reais(-5000))).toBe('− R$ 50,00');
    expect(sem(comSinal(1000))).toBe('+ R$ 10,00');
    expect(sem(comSinal(-1000))).toBe('− R$ 10,00');
  });

  it('lê valores digitados do jeito que as pessoas digitam', () => {
    expect(lerReais('1.234,56')).toBe(123456);
    expect(lerReais('R$ 30.000,00')).toBe(3000000);
    expect(lerReais('1234.5')).toBe(123450);
    expect(lerReais('12')).toBe(1200);
    expect(lerReais('')).toBeNull();
    expect(lerReais('abc')).toBeNull();
    expect(lerReais('-5')).toBeNull();
  });

  it('meses', () => {
    expect(nomeDoMes('2026-09')).toBe('setembro de 2026');
    expect(mesCurto('2027-01')).toBe('jan/27');
    expect(somarMeses('2026-12', 1)).toBe('2027-01');
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
  });

  it('dias relativos', () => {
    expect(diaAmigavel('2026-09-24', '2026-09-24')).toBe('Hoje');
    expect(diaAmigavel('2026-09-23', '2026-09-24')).toBe('Ontem');
    expect(diaAmigavel('2026-09-20', '2026-09-24')).toBe('Domingo, 20 set');
    expect(emQuantosDias('2026-09-24', '2026-09-25')).toBe('amanhã');
    expect(emQuantosDias('2026-09-24', '2026-10-04')).toBe('em 10 dias');
    expect(emQuantosDias('2026-09-24', '2026-09-22')).toBe('há 2 dias');
  });
});
