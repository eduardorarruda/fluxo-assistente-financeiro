import { formatarEixo, formatarValor, lerGrafico, paraCsv, resumoAcessivel, type EspecGrafico } from './especGrafico';

const BASE = {
  tipo: 'barras',
  titulo: 'Receitas × despesas',
  unidade: 'reais',
  rotulos: ['jul/26', 'ago/26'],
  series: [{ nome: 'Receitas', valores: [8200, 8450.5], cor: 'entrada' }, { nome: 'Despesas', valores: [6120.4, 7033.1] }],
};
const ler = (o: unknown) => lerGrafico(JSON.stringify(o));

describe('lerGrafico', () => {
  it('aceita a especificação válida (unidade padrão: reais)', () => {
    const r = ler({ ...BASE, unidade: undefined });
    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') expect(r.espec.unidade).toBe('reais');
  });

  it('JSON pela metade é "json" (o bloco ainda está chegando)', () => {
    expect(lerGrafico('{"tipo":"barras","titulo":"Rece').tipo).toBe('json');
  });

  it('recusa o que não dá para desenhar, dizendo o motivo', () => {
    const casos: [unknown, RegExp][] = [
      [{ ...BASE, tipo: 'radar' }, /tipo/],
      [{ ...BASE, series: [{ nome: 'A', valores: [1] }] }, /1 valores para 2 rótulos/],
      [{ ...BASE, rotulos: Array.from({ length: 61 }, (_, i) => `r${i}`) }, /rotulos/],
      [{ ...BASE, series: Array.from({ length: 9 }, (_, i) => ({ nome: `s${i}`, valores: [1, 2] })) }, /series/],
      [{ ...BASE, series: [{ nome: 'A', valores: [1, 'dois'] }] }, /series/],
      [{ ...BASE, tipo: 'pizza' }, /uma série só/],
      [{ ...BASE, tipo: 'pizza', series: [{ nome: 'A', valores: [-1, 2] }] }, /negativos/],
      [{ ...BASE, series: [{ nome: 'A', valores: [1, 2], cor: '#ff0000' }] }, /cor/],
    ];
    for (const [espec, motivo] of casos) {
      const r = ler(espec);
      expect(r.tipo).toBe('invalido');
      if (r.tipo === 'invalido') expect(r.motivo).toMatch(motivo);
    }
  });

  it('bloco gigante é recusado sem tentar ler', () => {
    expect(lerGrafico(`{"titulo":"${'x'.repeat(60_000)}"}`)).toEqual({ tipo: 'invalido', motivo: 'o bloco é grande demais' });
  });
});

describe('formatos', () => {
  it('reais, número e percentual em pt-BR', () => {
    expect(formatarValor(1234.5, 'reais')).toMatch(/R\$\s1\.234,50/);
    expect(formatarValor(-10, 'reais')).toMatch(/− R\$\s10,00/);
    expect(formatarValor(1234.567, 'numero')).toBe('1.234,57');
    expect(formatarValor(12.5, 'percentual')).toBe('12,5%');
    expect(formatarEixo(25000, 'reais')).toMatch(/R\$/);
  });

  it('CSV com ponto e vírgula, vírgula decimal e sem fórmulas de planilha', () => {
    const g = { ...BASE, rotulos: ['=HYPERLINK("x")', 'a;b'] } as EspecGrafico;
    expect(paraCsv(g).split('\n')).toEqual(['Rótulo;Receitas;Despesas', `"'=HYPERLINK(""x"")";8200;6120,4`, '"a;b";8450,5;7033,1']);
  });

  it('resumo para leitor de tela', () => {
    const r = ler(BASE);
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(resumoAcessivel(r.espec)).toBe('Receitas × despesas. Gráfico de barras com 2 itens (jul/26 a ago/26) e as séries Receitas, Despesas. A tabela com os dados está logo abaixo.');
  });
});
