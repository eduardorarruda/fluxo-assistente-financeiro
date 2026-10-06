import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';

/**
 * Ações do assistente (docs/ASSISTENTE.md, "Ações"): o que ele fez direto
 * (com Desfazer) e o que propôs (Aprovar/Recusar). Espelha
 * server/src/assistente/acoes/tipos-acoes.ts.
 */

export type TipoAcao =
  | 'ajustar_movimento' | 'recategorizar_movimentos' | 'criar_regra' | 'remover_regra' | 'definir_orcamento'
  | 'criar_meta' | 'editar_meta' | 'remover_meta'
  | 'criar_conta_a_pagar' | 'editar_conta_a_pagar' | 'marcar_conta_paga' | 'remover_conta_a_pagar';

export type SituacaoAcao = 'pendente' | 'aprovada' | 'recusada' | 'expirada' | 'falhou';

export interface ExemploAcao {
  data: string;
  descricao: string;
  /** Centavos. */
  valor: number;
  de: string | null;
  para: string | null;
}

export interface AcaoAssistente {
  id: string;
  conversaId: string;
  mensagemId: string | null;
  tipo: TipoAcao;
  modo: 'direta' | 'proposta';
  titulo: string;
  descricao: string;
  efeito: string | null;
  exemplos: ExemploAcao[];
  situacao: SituacaoAcao;
  erro: string | null;
  aviso: string | null;
  criadaEm: string;
  decididaEm: string | null;
  desfeitaEm: string | null;
  podeDesfazer: boolean;
}

/** Ferramentas cujo passo terminado pode ter mudado dados (ou criado um cartão): relê as ações e as telas. */
export const FERRAMENTAS_DE_ACAO: ReadonlySet<string> = new Set([
  'ajustar_movimento', 'recategorizar_movimentos', 'criar_regra_de_categoria', 'remover_regra', 'definir_orcamento',
  'criar_meta', 'editar_meta', 'remover_meta', 'criar_conta_a_pagar', 'editar_conta_a_pagar', 'marcar_conta_paga',
  'remover_conta_a_pagar', 'confirmar_proposta', 'recusar_proposta', 'desfazer_acao',
]);

export const chaveDasAcoes = (conversaId: string) => ['assistente', 'acoes', conversaId] as const;

const id = (s: string) => encodeURIComponent(s);

export const useAcoesDaConversa = (conversaId: string | undefined) =>
  useQuery({
    queryKey: chaveDasAcoes(conversaId ?? ''),
    queryFn: () => api.get<AcaoAssistente[]>(`/assistente/conversas/${id(conversaId ?? '')}/acoes`),
    enabled: Boolean(conversaId),
    staleTime: 30_000,
  });

/**
 * Uma ação mudou dados de verdade: as telas (extrato, orçamento, metas, contas)
 * precisam reler. As chaves do assistente ficam de fora (a conversa vem pelo SSE).
 */
export function dadosMudaram(cliente: QueryClient): void {
  void cliente.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'assistente' });
}

/** Depois de um passo de ação (ou do fim da resposta): relê os cartões e, se algo pode ter mudado, as telas. */
export function releAcoes(cliente: QueryClient, conversaId: string, mudouDados: boolean): void {
  void cliente.invalidateQueries({ queryKey: chaveDasAcoes(conversaId) });
  if (mudouDados) dadosMudaram(cliente);
}

function trocar(lista: AcaoAssistente[] | undefined, nova: AcaoAssistente): AcaoAssistente[] | undefined {
  return lista?.map((a) => (a.id === nova.id ? nova : a));
}

function useDecisao(caminho: (acaoId: string) => string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (acao: Pick<AcaoAssistente, 'id' | 'conversaId'>) => api.post<AcaoAssistente>(caminho(acao.id)),
    onSuccess: (nova) => {
      cliente.setQueryData<AcaoAssistente[]>(chaveDasAcoes(nova.conversaId), (lista) => trocar(lista, nova));
      dadosMudaram(cliente);
    },
    // Recusada em outra aba, expirada…: o servidor sabe; relê para o cartão mostrar o estado certo.
    onError: (_e, acao) => void cliente.invalidateQueries({ queryKey: chaveDasAcoes(acao.conversaId) }),
  });
}

export const useAprovarProposta = () => useDecisao((acaoId) => `/assistente/propostas/${id(acaoId)}/aprovar`);
export const useRecusarProposta = () => useDecisao((acaoId) => `/assistente/propostas/${id(acaoId)}/recusar`);
export const useDesfazerAcao = () => useDecisao((acaoId) => `/assistente/acoes/${id(acaoId)}/desfazer`);

/** Os cartões de cada resposta, na ordem em que as ações aconteceram. */
export function acoesPorMensagem(acoes: readonly AcaoAssistente[] | undefined): ReadonlyMap<string, AcaoAssistente[]> {
  const mapa = new Map<string, AcaoAssistente[]>();
  for (const a of acoes ?? []) {
    if (!a.mensagemId) continue;
    mapa.set(a.mensagemId, [...(mapa.get(a.mensagemId) ?? []), a]);
  }
  return mapa;
}
