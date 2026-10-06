import { resumo } from '../../testes/fixtures/assistente';
import { agruparConversas } from './agrupar';

// Horário local fixo: 1º/out/2026, 10h.
const AGORA = new Date(2026, 9, 1, 10, 0, 0);
const dia = (ano: number, mes: number, d: number, h = 12) => new Date(ano, mes - 1, d, h).toISOString();

describe('agruparConversas', () => {
  it('separa em fixadas, hoje, ontem, 7 dias, 30 dias e mais antigas, nessa ordem', () => {
    const grupos = agruparConversas(
      [
        resumo({ id: 'antiga', atualizadaEm: dia(2026, 6, 1) }),
        resumo({ id: 'mes', atualizadaEm: dia(2026, 9, 10) }),
        resumo({ id: 'semana', atualizadaEm: dia(2026, 9, 26) }),
        resumo({ id: 'ontem', atualizadaEm: dia(2026, 9, 30, 23) }),
        resumo({ id: 'hoje', atualizadaEm: dia(2026, 10, 1, 0) }),
        resumo({ id: 'fixa', fixada: true, atualizadaEm: dia(2025, 1, 1) }),
      ],
      AGORA,
    );
    expect(grupos.map((g) => [g.nome, g.conversas.map((c) => c.id)])).toEqual([
      ['Fixadas', ['fixa']],
      ['Hoje', ['hoje']],
      ['Ontem', ['ontem']],
      ['Últimos 7 dias', ['semana']],
      ['Últimos 30 dias', ['mes']],
      ['Mais antigas', ['antiga']],
    ]);
  });

  it('ordena cada grupo da mais recente para a mais antiga e omite grupos vazios', () => {
    const grupos = agruparConversas(
      [resumo({ id: 'manha', atualizadaEm: dia(2026, 10, 1, 8) }), resumo({ id: 'agora', atualizadaEm: dia(2026, 10, 1, 9) })],
      AGORA,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.conversas.map((c) => c.id)).toEqual(['agora', 'manha']);
  });

  it('data inválida ou no futuro não quebra: futuro conta como hoje, inválida como antiga', () => {
    const grupos = agruparConversas([resumo({ id: 'futuro', atualizadaEm: dia(2026, 10, 3) }), resumo({ id: 'lixo', atualizadaEm: 'ontem' })], AGORA);
    expect(grupos.map((g) => g.nome)).toEqual(['Hoje', 'Mais antigas']);
  });
});
