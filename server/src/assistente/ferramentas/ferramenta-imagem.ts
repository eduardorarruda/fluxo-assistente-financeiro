import { z } from 'zod';
import { PROPORCOES, QUALIDADES, type ProporcaoImagem, type QualidadeImagem } from '../imagens/modelos-imagem';
import { definir, ErroDeFerramenta, type Definicao } from './definicao';

export const TAMANHO_MAXIMO_DESCRICAO = 2000;

export interface EntradaGerarImagem {
  descricao: string;
  proporcao?: ProporcaoImagem;
  qualidade?: QualidadeImagem;
}

export interface ImagemCriada {
  anexoId: string;
  /** Pronto para colar na resposta: `![descrição](anexo:<id>)`. */
  markdown: string;
  custoEstimadoUsd: number;
  modelo: string;
}

/** Quem gera de fato (o `ServicoDeImagens`); fica atrás desta interface para o catálogo não depender do Nest. */
export interface GeradorDeImagens {
  gerar(conversaId: string, entrada: EntradaGerarImagem): Promise<ImagemCriada>;
}

const ROTULO = 60;

/** De onde vem o pedido: a última mensagem que a pessoa escreveu nesta conversa. */
export interface PedidosDaPessoa {
  ultimaPergunta(conversaId: string): string | null;
}

/**
 * A pessoa pediu uma imagem? Só a mensagem dela conta — nunca texto de terceiros (descrição de
 * Pix, anexo), que poderia induzir o modelo a gastar a chave dela.
 */
const PEDIDO_DE_IMAGEM = /imag|ilustr|infograf|desenh|\barte\b|foto|\bcapa\b|figura|banner|banana|\blogo|poster|cartaz|wallpaper|image|picture/;

export function pediuImagem(texto: string | null): boolean {
  if (!texto) return false;
  return PEDIDO_DE_IMAGEM.test(texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
}

/**
 * A exceção ao "só leitura": cria uma imagem com o Nano Banana (Gemini, chave
 * paga da pessoa) e a guarda como anexo DESTA conversa. Não mexe em nenhum
 * dado financeiro. Custa dinheiro: tem limite por dia e só deve ser usada
 * quando a pessoa pede uma imagem.
 */
export function gerarImagem(gerador: GeradorDeImagens | undefined, pedidos?: PedidosDaPessoa): Definicao {
  return definir({
    nome: 'gerar_imagem',
    efeito: 'escrita',
    descricao:
      'Gera uma IMAGEM (ilustração, infográfico, capa, arte) com o Nano Banana do Gemini e a anexa a esta conversa. Use SÓ quando a ' +
      'pessoa pedir uma imagem/ilustração/infográfico — para gráficos de números use o bloco ```grafico. Cada imagem custa dinheiro ' +
      'à pessoa (≈ US$ 0,03 a 0,13) e há um limite por dia. Escreva a `descricao` completa e concreta (assunto, estilo, cores, textos ' +
      'que devem aparecer, com os números já conferidos nas outras ferramentas). Devolve `markdown` (`![…](anexo:<id>)`): coloque-o ' +
      'na resposta exatamente como veio para a imagem aparecer.',
    entrada: z.object({
      descricao: z.string().trim().min(3).max(TAMANHO_MAXIMO_DESCRICAO).describe('O que desenhar, em detalhes.'),
      proporcao: z.enum(PROPORCOES).optional().describe('Formato da imagem. Padrão 1:1.'),
      qualidade: z.enum(QUALIDADES).optional().describe('rapida (mais barata), padrao, pro (texto e detalhes melhores, mais cara). Padrão: o modelo dos Ajustes.'),
    }),
    rotulo: (e) => `Imagem: “${e.descricao.length > ROTULO ? `${e.descricao.slice(0, ROTULO - 1)}…` : e.descricao}”`,
    executar: (e, ctx) => {
      if (!gerador) throw new ErroDeFerramenta('A geração de imagens não está disponível neste Fluxo.');
      if (pedidos && !pediuImagem(pedidos.ultimaPergunta(ctx.conversaId))) {
        throw new ErroDeFerramenta('Só gero imagem quando a pessoa pede uma na mensagem dela. Para números, use o bloco ```grafico.');
      }
      return gerador.gerar(ctx.conversaId, e);
    },
  });
}
