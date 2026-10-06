import { progressoDaMeta, type Meta } from './metas';

const meta = (p: Partial<Meta>): Meta => ({
  id: 'm', nome: 'Viagem', alvo: 1200000, prazo: null, caixinhaId: null, valorManual: 0, icone: 'aviao', cor: '#22D3EE', ...p,
});

describe('progressoDaMeta', () => {
  it('meta ligada à caixinha usa o saldo dela e o ritmo do histórico', () => {
    const p = progressoDaMeta(meta({ caixinhaId: 'cx', prazo: '2027-01' }), 600000, [
      { mes: '2026-04', valor: 300000 },
      { mes: '2026-05', valor: 400000 },
      { mes: '2026-06', valor: 500000 },
      { mes: '2026-07', valor: 600000 },
    ], '2026-07-15');
    expect(p).toMatchObject({ atual: 600000, falta: 600000, percentual: 0.5, ritmoMensal: 100000, previsao: '2027-01', noRitmo: true });
    expect(p.porMes).toBe(100000);
  });

  it('fora do ritmo quando a previsão passa do prazo', () => {
    const p = progressoDaMeta(meta({ caixinhaId: 'cx', prazo: '2026-10' }), 600000, [
      { mes: '2026-06', valor: 500000 },
      { mes: '2026-07', valor: 600000 },
    ], '2026-07-15');
    expect(p.noRitmo).toBe(false);
    expect(p.porMes).toBe(200000);
  });

  it('meta manual sem prazo e sem histórico', () => {
    const p = progressoDaMeta(meta({ valorManual: 300000 }), null, [], '2026-07-15');
    expect(p).toMatchObject({ atual: 300000, porMes: null, ritmoMensal: null, previsao: null, noRitmo: null });
  });

  it('meta concluída', () => {
    const p = progressoDaMeta(meta({ valorManual: 1500000, prazo: '2026-12' }), null, [], '2026-07-15');
    expect(p).toMatchObject({ concluida: true, falta: 0, percentual: 1, porMes: 0, previsao: '2026-07', noRitmo: true });
  });

  it('ritmo negativo (andou resgatando) não gera previsão', () => {
    const p = progressoDaMeta(meta({ caixinhaId: 'cx' }), 100000, [
      { mes: '2026-06', valor: 200000 }, { mes: '2026-07', valor: 100000 },
    ], '2026-07-15');
    expect(p.previsao).toBeNull();
  });
});
