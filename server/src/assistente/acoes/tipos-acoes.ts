import type { LinhaContaAPagar } from '../../dados/repositorio';
import type { Regra } from '../../domain/categorizacao';
import type { Meta } from '../../domain/metas';
import type { Ajuste } from '../../domain/movimentos';

/**
 * Ações do assistente: o que ele pode MUDAR nos dados, sempre com um jeito de
 * desfazer. Há dois modos:
 *
 * - `direta`: coisa pequena e pontual (um movimento, uma conta a pagar). Roda
 *   na hora, quando a pessoa pede, e aparece no chat com "Desfazer".
 * - `proposta`: mudança grande (regra que vale para o passado inteiro, vários
 *   movimentos, orçamento, metas, remover uma conta). Não muda nada: vira um
 *   cartão com Aprovar/Recusar, e só a pessoa aprova — pelo botão ou dizendo
 *   "sim" na mensagem seguinte (ver `guardas.ts`).
 */

export const TIPOS_ACAO = [
  'ajustar_movimento', 'recategorizar_movimentos', 'criar_regra', 'remover_regra', 'definir_orcamento',
  'criar_meta', 'editar_meta', 'remover_meta',
  'criar_conta_a_pagar', 'editar_conta_a_pagar', 'marcar_conta_paga', 'remover_conta_a_pagar',
] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];

export type ModoAcao = 'direta' | 'proposta';

/**
 * pendente → aprovada (feita) | recusada | expirada | falhou. Ação direta nasce
 * `aprovada`. Desfazer não muda a situação: preenche `desfeitaEm`.
 */
export type SituacaoAcao = 'pendente' | 'aprovada' | 'recusada' | 'expirada' | 'falhou';

/** Um exemplo do que muda (para a pessoa conferir antes de aprovar). Valor em centavos. */
export interface ExemploAcao {
  data: string;
  descricao: string;
  valor: number;
  de: string | null;
  para: string | null;
}

/** O que a tela recebe (`GET /api/assistente/conversas/:id/acoes`). */
export interface AcaoAssistente {
  id: string;
  conversaId: string;
  /** A resposta do assistente que fez ou propôs a ação (onde o cartão aparece). */
  mensagemId: string | null;
  tipo: TipoAcao;
  modo: ModoAcao;
  /** Curto, para o título do cartão: "Criar regra de categoria". */
  titulo: string;
  /** Exato, em português: o que muda. */
  descricao: string;
  /** O tamanho do efeito: "Muda 14 movimentos (R$ 1.234,56)". */
  efeito: string | null;
  exemplos: ExemploAcao[];
  situacao: SituacaoAcao;
  /** Por que falhou (ou por que não deu para desfazer tudo). */
  erro: string | null;
  /** Depois de desfeita: o que ficou como estava (ex.: "2 movimentos foram mudados depois e ficaram"). */
  aviso: string | null;
  criadaEm: string;
  decididaEm: string | null;
  desfeitaEm: string | null;
  podeDesfazer: boolean;
}

/** Como voltar atrás, guardado no momento em que a ação roda. `depois` é o que a ação deixou: se mudou de novo, não desfaz por cima. */
export type Inverso =
  | { tipo: 'ajustes'; itens: { transacaoId: string; antes: Ajuste | null; depois: Ajuste | null }[] }
  | { tipo: 'regra_criada'; regra: Regra }
  | { tipo: 'regra_removida'; regra: Regra }
  | { tipo: 'orcamento'; categoriaId: string; antes: number | null; depois: number | null }
  | { tipo: 'meta'; antes: Meta | null; depois: Meta | null }
  | { tipo: 'conta_a_pagar'; antes: LinhaContaAPagar | null; depois: LinhaContaAPagar | null };

/** O que fica gravado (a tela não vê `payload` nem `inverso`). */
export interface AcaoGravada extends Omit<AcaoAssistente, 'podeDesfazer'> {
  payload: Record<string, unknown>;
  inverso: Inverso | null;
}

/** Erro que vai para o modelo (ferramenta) ou para a tela (rota) com a mensagem como está. */
export class ErroDeAcao extends Error {}

export class AcaoNaoEncontrada extends Error {}

/** A ação já foi decidida de outro jeito (recusada, expirada…): aprovar/recusar de novo não faz nada. */
export class AcaoJaDecidida extends Error {}

export function paraTela(a: AcaoGravada): AcaoAssistente {
  const { payload: _p, inverso, ...resto } = a;
  return { ...resto, podeDesfazer: a.situacao === 'aprovada' && !a.desfeitaEm && inverso !== null };
}
