import type { ResumoMes } from './resumo';
import { montarSankey } from './sankey';

function resumo(p: Partial<ResumoMes>): ResumoMes {
  return { mes: '2026-07', receitas: 0, despesas: 0, guardado: 0, resultado: 0, porCategoria: [], receitasPorCategoria: [], ...p };
}

const soma = (xs: { valor: number }[]) => xs.reduce((s, x) => s + x.valor, 0);

describe('montarSankey', () => {
  it('sobra vira um destino e os dois lados fecham', () => {
    const s = montarSankey(resumo({
      receitasPorCategoria: [{ categoriaId: 'salario', valor: 500000, quantidade: 1 }],
      porCategoria: [{ categoriaId: 'mercado', valor: 100000, quantidade: 3 }],
      guardado: 150000,
    }));
    const origens = s.nos.filter((n) => n.lado === 'ORIGEM');
    const destinos = s.nos.filter((n) => n.lado === 'DESTINO');
    expect(soma(origens)).toBe(soma(destinos));
    expect(destinos.find((n) => n.id === 'out:sobra')?.valor).toBe(250000);
    expect(destinos.find((n) => n.id === 'out:guardado')?.valor).toBe(150000);
    expect(s.total).toBe(500000);
  });

  it('gasto maior que a receita puxa a diferença "do saldo"', () => {
    const s = montarSankey(resumo({
      receitasPorCategoria: [{ categoriaId: 'salario', valor: 100000, quantidade: 1 }],
      porCategoria: [{ categoriaId: 'viagem', valor: 300000, quantidade: 1 }],
    }));
    expect(s.nos.find((n) => n.id === 'in:saldo')?.valor).toBe(200000);
  });

  it('resgate de caixinha entra como origem', () => {
    const s = montarSankey(resumo({
      porCategoria: [{ categoriaId: 'viagem', valor: 50000, quantidade: 1 }],
      guardado: -50000,
    }));
    expect(s.nos.find((n) => n.id === 'in:resgate')?.valor).toBe(50000);
    expect(s.nos.some((n) => n.id === 'in:saldo')).toBe(false);
  });

  it('resgate só entra até cobrir o que faltou no mês; o excedente não vira "Sobrou"', () => {
    const s = montarSankey(resumo({
      receitasPorCategoria: [{ categoriaId: 'pix-recebido', valor: 721900, quantidade: 5 }],
      porCategoria: [{ categoriaId: 'compras', valor: 786475, quantidade: 40 }],
      guardado: -170008,
    }));
    const origens = s.nos.filter((n) => n.lado === 'ORIGEM');
    const destinos = s.nos.filter((n) => n.lado === 'DESTINO');
    expect(s.nos.find((n) => n.id === 'in:resgate')?.valor).toBe(64575);
    expect(s.nos.some((n) => n.id === 'out:sobra' || n.id === 'in:saldo')).toBe(false);
    expect(soma(origens)).toBe(soma(destinos));
    expect(s.total).toBe(786475);
    expect(s.resgateForaDoMes).toBe(170008 - 64575);
  });

  it('resgate num mês que fechou no azul não entra; a sobra é só a da receita', () => {
    const s = montarSankey(resumo({
      receitasPorCategoria: [{ categoriaId: 'salario', valor: 500000, quantidade: 1 }],
      porCategoria: [{ categoriaId: 'mercado', valor: 300000, quantidade: 3 }],
      guardado: -100000,
    }));
    expect(s.nos.some((n) => n.id === 'in:resgate')).toBe(false);
    expect(s.nos.find((n) => n.id === 'out:sobra')?.valor).toBe(200000);
    expect(s.resgateForaDoMes).toBe(100000);
  });

  it('resgate menor que o déficit entra inteiro e o resto vem "do saldo"', () => {
    const s = montarSankey(resumo({
      receitasPorCategoria: [{ categoriaId: 'salario', valor: 100000, quantidade: 1 }],
      porCategoria: [{ categoriaId: 'viagem', valor: 300000, quantidade: 1 }],
      guardado: -50000,
    }));
    expect(s.nos.find((n) => n.id === 'in:resgate')?.valor).toBe(50000);
    expect(s.nos.find((n) => n.id === 'in:saldo')?.valor).toBe(150000);
    expect(s.resgateForaDoMes).toBe(0);
  });

  it('agrupa as categorias além do limite', () => {
    const porCategoria = ['mercado', 'delivery', 'lazer', 'compras'].map((categoriaId, i) => ({
      categoriaId, valor: (4 - i) * 1000, quantidade: 1,
    }));
    const s = montarSankey(resumo({ porCategoria }), 2);
    expect(s.nos.filter((n) => n.lado === 'DESTINO').map((n) => n.id)).toEqual(['out:mercado', 'out:delivery', 'out:demais']);
    expect(s.nos.find((n) => n.id === 'out:demais')?.valor).toBe(3000);
  });

  it('categoria com estorno maior que o gasto vira origem "Estornos"', () => {
    const s = montarSankey(resumo({
      receitasPorCategoria: [{ categoriaId: 'salario', valor: 1000, quantidade: 1 }],
      porCategoria: [{ categoriaId: 'compras', valor: -500, quantidade: 1 }],
    }));
    expect(s.nos.find((n) => n.id === 'in:estornos')?.valor).toBe(500);
  });

  it('mês vazio devolve um Sankey vazio', () => {
    expect(montarSankey(resumo({}))).toEqual({ nos: [], ligacoes: [], total: 0, resgateForaDoMes: 0 });
  });
});
