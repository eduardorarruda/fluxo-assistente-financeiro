import {
  diaNoMes, diasEntre, diferencaEmMeses, intervaloDeMeses, paraDia, somarDias, somarMeses,
} from './datas';
import { mediana, paraCentavos } from './dinheiro';

describe('datas', () => {
  it('não converte para UTC: 22h do dia 10 continua sendo dia 10', () => {
    expect(paraDia(new Date(2026, 6, 10, 22, 30))).toBe('2026-07-10');
  });

  it('aceita a data pura que o provedor serializa como meia-noite UTC', () => {
    expect(paraDia('2026-07-10T00:00:00.000Z')).toBe('2026-07-10');
    expect(paraDia('2026-07-10')).toBe('2026-07-10');
  });

  it('recusa data inválida', () => {
    expect(() => paraDia('amanhã')).toThrow('Data inválida');
  });

  it('soma meses atravessando o ano nos dois sentidos', () => {
    expect(somarMeses('2026-11', 3)).toBe('2027-02');
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(diferencaEmMeses('2025-12', '2026-03')).toBe(3);
  });

  it('dia 31 num mês curto cai no último dia', () => {
    expect(diaNoMes('2026-02', 31)).toBe('2026-02-28');
    expect(diaNoMes('2028-02', 31)).toBe('2028-02-29');
  });

  it('conta dias sem se perder no fim do mês', () => {
    expect(somarDias('2026-01-30', 3)).toBe('2026-02-02');
    expect(diasEntre('2026-02-25', '2026-03-05')).toBe(8);
  });

  it('lista os meses de um intervalo, inclusive', () => {
    expect(intervaloDeMeses('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('dinheiro', () => {
  it('arredonda em vez de truncar (19,99 não vira 1998 centavos)', () => {
    expect(paraCentavos(19.99)).toBe(1999);
    expect(paraCentavos(0.1 + 0.2)).toBe(30);
    expect(paraCentavos(null)).toBe(0);
  });

  it('mediana de quantidade par usa a média dos dois do meio', () => {
    expect(mediana([10, 40, 20, 30])).toBe(25);
    expect(mediana([])).toBe(0);
  });
});
