import type { ContaAPagar } from '../../api/tipos';
import { agruparContas, quandoVence } from './agrupar';

const HOJE = '2026-10-02';
const conta = (p: Partial<ContaAPagar>): ContaAPagar => ({
  id: p.descricao ?? 'c', descricao: 'Conta', valor: 1000, vencimento: '2026-10-10', repete: 'nao', categoriaId: null,
  textoNoExtrato: null, situacao: 'aberta', pagaEm: null, movimentoId: null, origem: 'pessoa', nota: null,
  criadaEm: '', atualizadaEm: '', movimento: null, ...p,
});

describe('agruparContas', () => {
  it('separa atrasadas, semana, mês, próximas (por mês) e pagas recentes, nessa ordem', () => {
    const secoes = agruparContas([
      conta({ descricao: 'Dezembro', vencimento: '2026-12-01' }),
      conta({ descricao: 'Novembro', vencimento: '2026-11-05' }),
      conta({ descricao: 'Mês', vencimento: '2026-10-20' }),
      conta({ descricao: 'Semana', vencimento: '2026-10-08' }),
      conta({ descricao: 'Atrasada', vencimento: '2026-09-30', situacao: 'atrasada' }),
      conta({ descricao: 'Paga', vencimento: '2026-09-25', situacao: 'paga', pagaEm: '2026-09-24' }),
      conta({ descricao: 'Paga antiga', vencimento: '2026-06-10', situacao: 'paga', pagaEm: '2026-06-10' }),
    ], HOJE);
    expect(secoes.map((s) => [s.titulo, s.grupos.map((g) => [g.titulo, g.contas.map((c) => c.descricao)])])).toEqual([
      ['Atrasadas', [[null, ['Atrasada']]]],
      ['Esta semana', [[null, ['Semana']]]],
      ['Este mês', [[null, ['Mês']]]],
      ['Próximas', [['Novembro de 2026', ['Novembro']], ['Dezembro de 2026', ['Dezembro']]]],
      ['Pagas recentemente', [[null, ['Paga']]]],
    ]);
  });

  it('sem contas, sem seções', () => {
    expect(agruparContas([], HOJE)).toEqual([]);
  });
});

describe('quandoVence', () => {
  it('fala como gente', () => {
    expect(quandoVence({ vencimento: HOJE, situacao: 'aberta' }, HOJE)).toBe('Vence hoje');
    expect(quandoVence({ vencimento: '2026-10-03', situacao: 'aberta' }, HOJE)).toBe('Vence amanhã · 3 out');
    expect(quandoVence({ vencimento: '2026-10-05', situacao: 'aberta' }, HOJE)).toBe('Vence em 3 dias · 5 out');
    expect(quandoVence({ vencimento: '2026-09-30', situacao: 'atrasada' }, HOJE)).toBe('Venceu há 2 dias · 30 set');
  });
});
