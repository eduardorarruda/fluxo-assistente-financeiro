import { pareceConfirmacao, pareceDesfazer, temNegacao } from './guardas';

describe('pareceConfirmacao', () => {
  it('reconhece o "sim" falado ou escrito, com ou sem acento', () => {
    for (const t of [
      'sim', 'Sim!', 'pode', 'Pode fazer', 'pode sim', 'confirmo', 'Confirmado.', 'aprovado', 'aprovo', 'manda', 'manda ver', 'isso',
      'Isso mesmo', 'ok', 'Ok, pode criar', 'beleza', 'fechado', 'claro', 'com certeza', 'Sim, coloca todos os Baratão em Combustível',
      'tá bom', 'Tá certo, faz', 'faça', 'faz isso', 'bora', 'por favor, pode', 'Pode criar a regra',
    ]) {
      expect(pareceConfirmacao(t), t).toBe(true);
    }
  });

  it('negação, dúvida ou pergunta não confirmam', () => {
    for (const t of [
      'não', 'Não, pode deixar', 'nao precisa', 'espera', 'Espera um pouco', 'cancela', 'cancelar isso', 'sim, mas espera',
      'pode me mostrar os movimentos antes?', 'isso vai mudar quanto?', 'para', 'nem pensar', 'recuso', 'deixa pra lá', 'melhor não',
      'agora não', 'quanto eu gastei com mercado', '', '   ',
    ]) {
      expect(pareceConfirmacao(t), t).toBe(false);
    }
  });

  it('texto longo demais não é um "sim" (cola de outra coisa)', () => {
    expect(pareceConfirmacao(`sim ${'e mais um detalhe '.repeat(20)}`)).toBe(false);
    expect(pareceConfirmacao(null)).toBe(false);
  });
});

describe('pareceDesfazer', () => {
  it('reconhece pedidos para desfazer', () => {
    for (const t of ['desfaz', 'Desfaça isso', 'desfazer', 'pode desfazer?', 'volta como estava', 'voltar atrás', 'reverte', 'anula a regra', 'desfaz a última']) {
      expect(pareceDesfazer(t), t).toBe(true);
    }
  });

  it('negação ou outra coisa não desfazem', () => {
    for (const t of ['não desfaz', 'nao precisa desfazer', 'quanto voltou de reembolso?', 'sim', 'pode', '', null]) {
      expect(pareceDesfazer(t), String(t)).toBe(false);
    }
  });
});

describe('temNegacao', () => {
  it('acha a negação em qualquer lugar, sem acento', () => {
    expect(temNegacao('Acho que NÃO')).toBe(true);
    expect(temNegacao('espera aí')).toBe(true);
    expect(temNegacao('pode cancelar')).toBe(true);
    expect(temNegacao('pode sim')).toBe(false);
  });
});
