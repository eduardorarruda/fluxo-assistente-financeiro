import { criarDivisorDeFrases, dividirEmFrases, limparLinha, limparParaFala } from './texto-fala';

describe('limparParaFala', () => {
  it('tira blocos de gráfico e de código, inteiros', () => {
    const md = 'Veja o gráfico:\n\n```grafico\n{"tipo":"barras","titulo":"Gastos"}\n```\n\nO maior gasto foi mercado.\n```ts\nconst x = 1;\n```';
    expect(limparParaFala(md)).toBe('Veja o gráfico: O maior gasto foi mercado.');
  });

  it('tira tabelas (com e sem barra no começo) e a linha separadora', () => {
    const md = 'Resumo:\n\n| Categoria | Valor |\n|---|---:|\n| Mercado | R$ 900,00 |\nCasa | R$ 1.200,00 | ok\n\nFim.';
    expect(limparParaFala(md)).toBe('Resumo: Fim.');
  });

  it('tira imagens (inclusive as geradas) e deixa o texto dos links', () => {
    const md = 'Aqui está: ![Infográfico do mês](anexo:123e4567) e o [extrato completo](https://fluxo.local/extrato). Mais em https://exemplo.com/x.';
    expect(limparParaFala(md)).toBe('Aqui está: e o extrato completo. Mais em.');
  });

  it('tira a sintaxe do markdown e os emojis, mas mantém números e reais', () => {
    const md = '## Setembro 📊\n\n- **Mercado**: R$ 1.234,56 (12,5% a mais)\n- _Lazer_: `R$ 300,00` 🎉\n> Dica: ~~não~~ guarde 10%.';
    expect(limparParaFala(md)).toBe('Setembro Mercado: R$ 1.234,56 (12,5% a mais) Lazer: R$ 300,00 Dica: não guarde 10%.');
  });

  it('não quebra o ponto de milhar nem o de decimal', () => {
    expect(dividirEmFrases('Você gastou R$ 1.234,56. Depois, 12.5 por cento.')).toEqual(['Você gastou R$ 1.234,56.', 'Depois, 12.5 por cento.']);
  });

  it('palavras com sublinhado no meio continuam inteiras', () => {
    expect(limparLinha('use resumo_do_mes e *itálico* aqui')).toBe('use resumo_do_mes e itálico aqui');
  });

  it('corta frase enorme sem pontuação perto de uma vírgula', () => {
    const longa = `${'palavra '.repeat(20)}, ${'outra '.repeat(30)}`.trim();
    const partes = dividirEmFrases(longa);
    expect(partes.length).toBeGreaterThan(1);
    partes.forEach((p) => expect(p.length).toBeLessThanOrEqual(220));
  });
});

describe('criarDivisorDeFrases (resposta chegando em pedaços)', () => {
  it('entrega cada frase assim que ela fecha, sem esperar o fim', () => {
    const d = criarDivisorDeFrases();
    expect(d.empurrar('Em setembro você gas')).toEqual([]);
    expect(d.empurrar('tou R$ 3.210,00. O maior')).toEqual(['Em setembro você gastou R$ 3.210,00.']);
    expect(d.empurrar(' gasto foi mercado! E')).toEqual(['O maior gasto foi mercado!']);
    expect(d.terminar()).toEqual(['E']);
  });

  it('não fala nada de um bloco de gráfico que chega aos poucos', () => {
    const d = criarDivisorDeFrases();
    const pedacos = ['Olha só. ', '\n```gra', 'fico\n{"tipo": "pizza", "titulo": "Isto. Não."', '}\n``', '`\nPronto.'];
    const ditas = pedacos.flatMap((p) => d.empurrar(p));
    expect([...ditas, ...d.terminar()]).toEqual(['Olha só.', 'Pronto.']);
  });

  it('espera o link fechar antes de entregar a frase', () => {
    const d = criarDivisorDeFrases();
    expect(d.empurrar('Abra o [extrato. Ele')).toEqual([]);
    expect(d.empurrar(' mostra](https://x.y/z). Tudo bem?')).toEqual(['Abra o extrato.', 'Ele mostra.']);
    expect(d.terminar()).toEqual(['Tudo bem?']);
  });

  it('item de lista numerado não vira "1." sozinho', () => {
    const d = criarDivisorDeFrases();
    expect(d.empurrar('1. Mercado subiu. ')).toEqual(['Mercado subiu.']);
    expect(d.empurrar('Lazer caiu\n2. Casa')).toEqual(['Lazer caiu']);
    expect(d.terminar()).toEqual(['Casa']);
  });

  it('linha de tabela pela metade espera a quebra de linha (e some)', () => {
    const d = criarDivisorDeFrases();
    expect(d.empurrar('| Mercado. | R$ 1,00. ')).toEqual([]);
    expect(d.empurrar('|\nFim.')).toEqual([]);
    expect(d.terminar()).toEqual(['Fim.']);
  });
});
