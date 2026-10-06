import { Logger } from '@nestjs/common';
import { abrirBanco, type Banco } from '../../db/conexao';
import { Indexador, type MovimentoParaIndice } from './indexador';
import { IndiceDeTrechos } from './indice';
import { pdfDeTeste } from './testing/pdf';
import { DIMENSAO_FALSA, VetorizadorFalso } from './testing/vetorizador-falso';

function movimento(id: string, descricao: string, extra: Partial<MovimentoParaIndice> = {}): MovimentoParaIndice {
  return {
    id, data: '2026-09-15', descricao, estabelecimento: null, contraparteNome: null, categoria: 'Alimentação',
    natureza: 'DESPESA', valor: 4590, sentido: 'SAIDA', conta: 'Nubank', parcela: null, nota: null, ...extra,
  };
}

const MOVIMENTOS = [
  movimento('m1', 'IFD*IFOOD pizza', { estabelecimento: 'iFood' }),
  movimento('m2', 'Uber viagem', { categoria: 'Transporte' }),
  movimento('m3', 'Conta de energia elétrica', { categoria: 'Moradia' }),
  movimento('m4', 'Supermercado Pão de Açúcar', { categoria: 'Mercado' }),
  movimento('m5', 'Restaurante almoço', { categoria: 'Alimentação' }),
];

describe('Indexador', () => {
  let banco: Banco;
  let indice: IndiceDeTrechos;
  let vetorizador: VetorizadorFalso;
  let indexador: Indexador;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    banco = abrirBanco(':memory:');
    indice = new IndiceDeTrechos(banco);
    vetorizador = new VetorizadorFalso();
    indexador = new Indexador(indice, vetorizador, { tamanhoDoLote: 2 });
  });

  afterEach(async () => {
    await indexador.ocioso();
    banco.$client.close();
  });

  describe('textoDoMovimento', () => {
    it('junta data, descrição, loja, contraparte, categoria, natureza, valor em reais, conta, parcela e nota', () => {
      const texto = Indexador.textoDoMovimento(movimento('x', 'COMPRA CARTAO', {
        estabelecimento: 'Magazine Luiza', contraparteNome: 'Fulano de Tal', valor: 123456,
        parcela: { numero: 3, total: 10 }, nota: 'presente da mãe', categoria: 'Compras', conta: 'Cartão Nubank',
      }));
      expect(texto).toBe(
        '2026-09-15 · COMPRA CARTAO · Loja: Magazine Luiza · Contraparte: Fulano de Tal · Categoria: Compras · '
        + 'Natureza: DESPESA · Saída de R$ 1.234,56 · Conta: Cartão Nubank · Parcela 3/10 · Nota: presente da mãe',
      );
    });

    it('omite o que é nulo e mostra entrada', () => {
      const texto = Indexador.textoDoMovimento(movimento('x', 'Salário', {
        natureza: 'RECEITA', sentido: 'ENTRADA', valor: 500000, categoria: 'Salário',
      }));
      expect(texto).toBe('2026-09-15 · Salário · Categoria: Salário · Natureza: RECEITA · Entrada de R$ 5.000,00 · Conta: Nubank');
    });

    it('valor negativo em centavos sai sem sinal (o sentido já diz)', () => {
      expect(Indexador.textoDoMovimento(movimento('x', 'a', { valor: -5 }))).toContain('Saída de R$ 0,05');
    });
  });

  describe('estado e ativação', () => {
    it('começa inativo, com os contadores do índice', () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      expect(indexador.estado()).toEqual({
        ativo: false, preparando: false, progresso: null, etapa: null, erro: null, modelo: 'teste/falso',
        movimentosIndexados: 0, movimentosTotal: 5, trechosDeAnexos: 0,
      });
    });

    it('iniciar sem o modelo baixado não faz nada', async () => {
      indexador.iniciar();
      await indexador.ocioso();
      expect(indexador.estado().ativo).toBe(false);
      expect(vetorizador.chamadasPreparar).toBe(0);
    });

    it('iniciar com o modelo baixado ativa e vetoriza o que estiver pendente', async () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      vetorizador.estaBaixado = true;
      indexador.iniciar();
      expect(indexador.estado().ativo).toBe(true);
      await indexador.ocioso();
      expect(indexador.estado()).toMatchObject({ ativo: true, preparando: false, movimentosIndexados: 5, erro: null });
      expect(vetorizador.chamadasVetorizar.every((c) => c.tipo === 'documento')).toBe(true);
    });

    it('iniciar quando a extensão não carrega deixa o erro no estado', async () => {
      const semExtensao = new IndiceDeTrechos(banco, () => {
        throw new Error('sem vec0');
      });
      const ix = new Indexador(semExtensao, vetorizador);
      vetorizador.estaBaixado = true;
      ix.iniciar();
      expect(ix.estado()).toMatchObject({ ativo: false, erro: expect.stringContaining('sem vec0') });
    });

    it('ativar baixa o modelo mostrando o progresso e depois indexa tudo', async () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      const durante: ReturnType<Indexador['estado']>[] = [];
      vetorizador.durantePreparar = async (aoProgredir) => {
        aoProgredir?.({ carregado: 45 * 1024 * 1024, total: 118 * 1024 * 1024, arquivo: 'onnx/model_quantized.onnx' });
        durante.push(indexador.estado());
      };
      vetorizador.duranteVetorizar = () => {
        durante.push(indexador.estado());
      };
      await indexador.ativar();

      expect(durante[0]).toMatchObject({ preparando: true, etapa: 'Baixando o modelo (45 MB de 118 MB)', ativo: false });
      expect(durante[0]!.progresso).toBeCloseTo(45 / 118, 5);
      expect(durante[1]).toMatchObject({ preparando: true, etapa: 'Indexando (0 de 5)', progresso: 0, ativo: true });
      expect(durante[2]).toMatchObject({ etapa: 'Indexando (2 de 5)' });
      expect(indexador.estado()).toMatchObject({
        ativo: true, preparando: false, progresso: null, etapa: null, erro: null, movimentosIndexados: 5, movimentosTotal: 5,
      });
      expect(vetorizador.chamadasVetorizar.map((c) => c.textos.length)).toEqual([2, 2, 1]);
    });

    it('formata milhares no texto da etapa', { timeout: 30_000 }, async () => {
      const muitos = Array.from({ length: 1201 }, (_, i) => movimento(`m${i}`, `compra ${i}`));
      indexador = new Indexador(indice, vetorizador, { tamanhoDoLote: 1200 });
      indexador.indexarMovimentos(muitos);
      const etapas: (string | null)[] = [];
      vetorizador.duranteVetorizar = () => etapas.push(indexador.estado().etapa);
      await indexador.ativar();
      expect(etapas).toEqual(['Indexando (0 de 1.201)', 'Indexando (1.200 de 1.201)']);
    });

    it('ativar duas vezes ao mesmo tempo baixa uma vez só', async () => {
      await Promise.all([indexador.ativar(), indexador.ativar()]);
      expect(vetorizador.chamadasPreparar).toBe(1);
    });

    it('falha no download fica em estado().erro, sem lançar', async () => {
      vetorizador.falharPreparar = new Error('sem internet');
      await expect(indexador.ativar()).resolves.toBeUndefined();
      expect(indexador.estado()).toMatchObject({
        ativo: false, preparando: false, progresso: null, etapa: null, erro: expect.stringContaining('sem internet'),
      });
    });

    it('nova tentativa depois de uma falha limpa o erro', async () => {
      vetorizador.falharPreparar = new Error('sem internet');
      await indexador.ativar();
      vetorizador.falharPreparar = null;
      await indexador.ativar();
      expect(indexador.estado()).toMatchObject({ ativo: true, erro: null });
    });

    it('falha ao ativar os vetores no índice fica no erro', async () => {
      const ix = new Indexador(new IndiceDeTrechos(banco, () => {
        throw new Error('sem vec0');
      }), vetorizador);
      await ix.ativar();
      expect(ix.estado()).toMatchObject({ ativo: false, erro: expect.stringContaining('sem vec0') });
    });
  });

  describe('vetorização em segundo plano', () => {
    beforeEach(async () => {
      await indexador.ativar();
    });

    it('indexarMovimentos não bloqueia e vetoriza os novos depois', async () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      expect(indexador.estado().movimentosIndexados).toBe(0);
      await indexador.ocioso();
      expect(indexador.estado().movimentosIndexados).toBe(5);
    });

    it('um trabalhador só, mesmo com várias chamadas seguidas', async () => {
      indexador.indexarMovimentos(MOVIMENTOS.slice(0, 2));
      indexador.indexarMovimentos(MOVIMENTOS.slice(0, 4));
      indexador.indexarMovimentos(MOVIMENTOS);
      await indexador.ocioso();
      expect(vetorizador.maximoEmParalelo).toBe(1);
      expect(indexador.estado().movimentosIndexados).toBe(5);
      const vetorizados = vetorizador.chamadasVetorizar.flatMap((c) => c.textos);
      expect(new Set(vetorizados).size).toBe(vetorizados.length);
    });

    it('cede a vez ao event loop entre um lote e outro', async () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      let tiques = 0;
      const contar = () => {
        tiques++;
        if (vetorizador.chamadasVetorizar.length < 3) setImmediate(contar);
      };
      setImmediate(contar);
      await indexador.ocioso();
      expect(tiques).toBeGreaterThanOrEqual(3);
    });

    it('movimento que chega no meio da vetorização também é vetorizado', async () => {
      indexador.indexarMovimentos(MOVIMENTOS.slice(0, 2));
      vetorizador.duranteVetorizar = () => {
        vetorizador.duranteVetorizar = null;
        indexador.indexarMovimentos(MOVIMENTOS);
      };
      await indexador.ocioso();
      expect(indexador.estado()).toMatchObject({ movimentosIndexados: 5, movimentosTotal: 5 });
    });

    it('erro na vetorização vai para o estado e para o laço', async () => {
      vetorizador.falharVetorizar = new Error('memória insuficiente');
      indexador.indexarMovimentos(MOVIMENTOS);
      await indexador.ocioso();
      expect(indexador.estado()).toMatchObject({ erro: expect.stringContaining('memória insuficiente'), preparando: false });
      expect(vetorizador.chamadasVetorizar).toHaveLength(1);

      vetorizador.falharVetorizar = null;
      indexador.indexarMovimentos(MOVIMENTOS);
      await indexador.ocioso();
      expect(indexador.estado()).toMatchObject({ erro: null, movimentosIndexados: 5 });
    });

    it('reindexar refaz os vetores de tudo', async () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      await indexador.ocioso();
      const antes = vetorizador.chamadasVetorizar.length;
      await indexador.reindexar();
      expect(vetorizador.chamadasVetorizar.slice(antes).flatMap((c) => c.textos)).toHaveLength(5);
      expect(indexador.estado()).toMatchObject({ movimentosIndexados: 5, preparando: false });
    });
  });

  it('reindexar no meio da vetorização espera o lote e refaz tudo, sem trabalhador duplicado', async () => {
    await indexador.ativar();
    indexador.indexarMovimentos(MOVIMENTOS);
    let reindexacao: Promise<void> | null = null;
    vetorizador.duranteVetorizar = () => {
      vetorizador.duranteVetorizar = null;
      reindexacao = indexador.reindexar();
    };
    await indexador.ocioso();
    await reindexacao;
    expect(reindexacao).not.toBeNull();
    expect(vetorizador.maximoEmParalelo).toBe(1);
    expect(indice.estatisticas()).toMatchObject({ movimentosVetorizados: 5, pendentes: 0 });
    expect(indexador.estado()).toMatchObject({ preparando: false, erro: null });
  });

  it('erro ao reindexar diz que foi a reindexação', async () => {
    await indexador.ativar();
    vetorizador.falharVetorizar = new Error('falhou');
    indexador.indexarMovimentos(MOVIMENTOS);
    await indexador.ocioso();
    const reiniciar = vi.spyOn(indice, 'reiniciarVetores').mockImplementation(() => {
      throw new Error('disco cheio');
    });
    await indexador.reindexar();
    expect(indexador.estado().erro).toBe('Não foi possível reindexar a busca por significado: disco cheio');
    reiniciar.mockRestore();
  });

  it('reindexar sem estar ativo ativa', async () => {
    await indexador.reindexar();
    expect(indexador.estado().ativo).toBe(true);
    expect(vetorizador.chamadasPreparar).toBe(1);
  });

  describe('anexos', () => {
    it('extrai, fatia e indexa um PDF', async () => {
      const r = await indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'pdf' }, pdfDeTeste(['Contrato de aluguel', 'Multa de dez por cento']));
      expect(r).toEqual({ situacao: 'pronto', texto: '[Página 1]\nContrato de aluguel\n\n[Página 2]\nMulta de dez por cento', paginas: 2 });
      expect(indexador.estado().trechosDeAnexos).toBe(1);
      const achados = await indexador.buscar('multa', { escopos: ['conversa:c1'], limite: 5 });
      expect(achados[0]).toMatchObject({ fonte: 'anexo', refId: 'a1' });
    });

    it('texto longo vira vários trechos', async () => {
      const paragrafo = 'Cláusula com bastante texto sobre o reajuste anual do aluguel. '.repeat(40);
      await indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'texto' }, Buffer.from(paragrafo));
      expect(indexador.estado().trechosDeAnexos).toBeGreaterThan(1);
    });

    it('PDF sem texto fica sem_texto e não deixa trecho', async () => {
      await indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'texto' }, Buffer.from('antigo'));
      const r = await indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'pdf' }, pdfDeTeste(['']));
      expect(r).toEqual({ situacao: 'sem_texto', texto: '', paginas: 1 });
      expect(indexador.estado().trechosDeAnexos).toBe(0);
    });

    it('PDF corrompido rejeita com a mensagem amigável', async () => {
      await expect(indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'pdf' }, Buffer.from('%PDF-lixo')))
        .rejects.toThrow(/PDF/);
    });

    it('com vetores ativos, os trechos do anexo são vetorizados', async () => {
      await indexador.ativar();
      await indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'texto' }, Buffer.from('Contrato de aluguel'));
      await indexador.ocioso();
      expect(indice.estatisticas().pendentes).toBe(0);
    });

    it('remove por anexo e por conversa', async () => {
      await indexador.indexarAnexo({ id: 'a1', conversaId: 'c1', tipo: 'texto' }, Buffer.from('um'));
      await indexador.indexarAnexo({ id: 'a2', conversaId: 'c1', tipo: 'texto' }, Buffer.from('dois'));
      await indexador.indexarAnexo({ id: 'a3', conversaId: 'c2', tipo: 'texto' }, Buffer.from('tres'));
      indexador.removerAnexo('a1');
      expect(indexador.estado().trechosDeAnexos).toBe(2);
      indexador.removerConversa('c1');
      expect(indexador.estado().trechosDeAnexos).toBe(1);
    });
  });

  describe('buscar', () => {
    it('sem vetores, busca só por palavra e não chama o vetorizador', async () => {
      indexador.indexarMovimentos(MOVIMENTOS);
      const r = await indexador.buscar('ifood', { escopos: ['movimentos'], limite: 5 });
      expect(r.map((x) => [x.refId, x.origem])).toEqual([['m1', ['palavra']]]);
      expect(vetorizador.chamadasVetorizar).toHaveLength(0);
    });

    it('com vetores, vetoriza a consulta como "consulta" e funde as duas buscas', async () => {
      await indexador.ativar();
      indexador.indexarMovimentos(MOVIMENTOS);
      await indexador.ocioso();
      const r = await indexador.buscar('uber viagem', { escopos: ['movimentos'], limite: 3 });
      expect(r[0]).toMatchObject({ refId: 'm2', origem: ['palavra', 'vetor'] });
      expect(r).toHaveLength(3);
      expect(vetorizador.chamadasVetorizar.at(-1)).toEqual({ textos: ['uber viagem'], tipo: 'consulta' });
    });

    it('se vetorizar a consulta falhar, cai na busca por palavra', async () => {
      await indexador.ativar();
      indexador.indexarMovimentos(MOVIMENTOS);
      await indexador.ocioso();
      vetorizador.falharVetorizar = new Error('modelo caiu');
      const r = await indexador.buscar('uber', { escopos: ['movimentos'], limite: 5 });
      expect(r.map((x) => [x.refId, x.origem])).toEqual([['m2', ['palavra']]]);
    });

    it('consulta vazia não vetoriza e não acha nada', async () => {
      await indexador.ativar();
      expect(await indexador.buscar('   ', { escopos: ['movimentos'], limite: 5 })).toEqual([]);
      expect(vetorizador.chamadasVetorizar).toHaveLength(0);
    });
  });

  it('usa a dimensão do vetorizador no índice', async () => {
    await indexador.ativar();
    const sql = (banco.$client.prepare("select sql from sqlite_master where name = 'trechos_vec'").get() as { sql: string }).sql;
    expect(sql).toContain(`float[${DIMENSAO_FALSA}]`);
  });
});
