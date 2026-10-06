import { caixinhasNoFimDosMeses, saldoNoFimDosMeses, ultimoValorAte } from './evolucao';

describe('saldoNoFimDosMeses', () => {
  const ts = [
    { data: '2026-07-05', valor: 1000, sentido: 'ENTRADA' as const, pendente: false },
    { data: '2026-08-10', valor: 300, sentido: 'SAIDA' as const, pendente: false },
    { data: '2026-09-02', valor: 200, sentido: 'ENTRADA' as const, pendente: false },
    { data: '2026-09-30', valor: 999, sentido: 'SAIDA' as const, pendente: true },
  ];

  it('anda para trás a partir do saldo de hoje, ignorando pendentes', () => {
    expect(saldoNoFimDosMeses(5000, ts, ['2026-06', '2026-07', '2026-08', '2026-09'], '2026-09-10')).toEqual([
      { mes: '2026-06', valor: 5000 - 200 + 300 - 1000 },
      { mes: '2026-07', valor: 5000 - 200 + 300 },
      { mes: '2026-08', valor: 5000 - 200 },
      { mes: '2026-09', valor: 5000 },
    ]);
  });
});

describe('ultimoValorAte', () => {
  it('usa a última foto de cada mês e null antes da primeira', () => {
    const pontos = [{ dia: '2026-08-31', valor: 10 }, { dia: '2026-08-15', valor: 5 }, { dia: '2026-09-20', valor: 20 }];
    expect(ultimoValorAte(pontos, ['2026-07', '2026-08', '2026-09', '2026-10'])).toEqual([
      { mes: '2026-07', valor: null },
      { mes: '2026-08', valor: 10 },
      { mes: '2026-09', valor: 20 },
      { mes: '2026-10', valor: 20 },
    ]);
  });
});

describe('caixinhasNoFimDosMeses', () => {
  const meses = ['2026-06', '2026-07', '2026-08', '2026-09'];
  // Do ponto de vista da conta: SAIDA = aplicou na caixinha, ENTRADA = resgatou.
  const movs = [
    { data: '2026-07-10', valor: 2000, sentido: 'SAIDA' as const, pendente: false },
    { data: '2026-08-05', valor: 500, sentido: 'ENTRADA' as const, pendente: false },
    { data: '2026-09-03', valor: 1000, sentido: 'ENTRADA' as const, pendente: false },
    { data: '2026-09-20', valor: 7777, sentido: 'SAIDA' as const, pendente: true },
  ];

  it('antes da primeira foto, refaz o valor de trás para frente pelas aplicações e resgates', () => {
    const serie = caixinhasNoFimDosMeses([{ valorAtual: 5000, fotos: [{ dia: '2026-09-25', valor: 5000 }] }], movs, meses, '2026-09-27');
    expect(serie).toEqual([
      { mes: '2026-06', valor: 5000 + 1000 + 500 - 2000 },
      { mes: '2026-07', valor: 5000 + 1000 + 500 },
      { mes: '2026-08', valor: 5000 + 1000 },
      { mes: '2026-09', valor: 5000 },
    ]);
  });

  it('mês com foto de todas as caixinhas da conta usa as fotos', () => {
    const serie = caixinhasNoFimDosMeses(
      [
        { valorAtual: 3000, fotos: [{ dia: '2026-08-31', valor: 2500 }, { dia: '2026-09-25', valor: 3000 }] },
        { valorAtual: 2000, fotos: [{ dia: '2026-08-15', valor: 1800 }] },
      ],
      movs, ['2026-07', '2026-08'], '2026-09-27',
    );
    // Julho: falta foto → refeito a partir do total atual (5000).
    expect(serie).toEqual([{ mes: '2026-07', valor: 5000 + 1000 + 500 }, { mes: '2026-08', valor: 4300 }]);
  });

  it('nunca fica negativo', () => {
    const serie = caixinhasNoFimDosMeses([{ valorAtual: 100, fotos: [] }], movs, ['2026-06'], '2026-09-27');
    expect(serie).toEqual([{ mes: '2026-06', valor: 0 }]);
  });
});
