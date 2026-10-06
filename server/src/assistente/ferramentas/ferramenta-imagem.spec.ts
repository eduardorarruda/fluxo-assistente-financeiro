import { gerarImagem, pediuImagem, type GeradorDeImagens } from './ferramenta-imagem';

describe('pediuImagem', () => {
  it('reconhece pedidos de imagem em português (com ou sem acento)', () => {
    for (const t of ['Gera uma imagem do meu mês', 'faz uma ilustração', 'quero um infográfico', 'desenha um cofre', 'usa o Nano Banana', 'uma capa para o relatório']) {
      expect(pediuImagem(t)).toBe(true);
    }
  });

  it('pergunta comum não é pedido de imagem', () => {
    expect(pediuImagem('Quanto gastei com mercado?')).toBe(false);
    expect(pediuImagem('Compara receitas e despesas')).toBe(false);
    expect(pediuImagem(null)).toBe(false);
  });
});

describe('gerar_imagem', () => {
  const gerador: GeradorDeImagens = { gerar: vi.fn(async () => ({ anexoId: 'x', markdown: '![a](anexo:x)', custoEstimadoUsd: 0.07, modelo: 'm' })) };

  it('só gera quando a última mensagem da pessoa pede uma imagem (texto de terceiros não dispara gasto)', async () => {
    const semPedido = gerarImagem(gerador, { ultimaPergunta: () => 'Quanto gastei em setembro?' });
    await expect(Promise.resolve().then(() => semPedido.executar({ descricao: 'um gráfico' }, { conversaId: 'c1' }))).rejects.toThrow(/quando a pessoa pede/);
    expect(gerador.gerar).not.toHaveBeenCalled();

    const comPedido = gerarImagem(gerador, { ultimaPergunta: () => 'Gera uma imagem resumindo meu mês' });
    await expect(comPedido.executar({ descricao: 'resumo do mês' }, { conversaId: 'c1' })).resolves.toMatchObject({ anexoId: 'x' });
  });
});
