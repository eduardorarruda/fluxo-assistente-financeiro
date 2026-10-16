import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, consulta } from './cliente';
import type {
  CandidatoAPagamento, ContaAPagar, VencimentoDeCartao,
  Caixinhas, Categoria, Estado, Fluxo, Insights, Meta, Movimento, Natureza, Orcamento, PaginaMovimentos, Recorrencia,
  Regra, SituacaoDosAlertas, Sincronizacao, VisaoCartao, VisaoGeral,
} from './tipos';

export const useEstado = () =>
  useQuery({ queryKey: ['estado'], queryFn: () => api.get<Estado>('/estado'), refetchInterval: (q) => (q.state.data?.conexoes.some((c) => c.sincronizando) ? 2000 : 60_000) });

export const useCategorias = () =>
  useQuery({ queryKey: ['categorias'], queryFn: () => api.get<Categoria[]>('/categorias'), staleTime: Infinity });

export const useVisaoGeral = (mes: string) =>
  useQuery({ queryKey: ['visao-geral', mes], queryFn: () => api.get<VisaoGeral>(`/visao-geral${consulta({ mes })}`), placeholderData: keepPreviousData });

export const useFluxo = (mes: string) =>
  useQuery({ queryKey: ['fluxo', mes], queryFn: () => api.get<Fluxo>(`/fluxo${consulta({ mes })}`), placeholderData: keepPreviousData });

export interface FiltroExtrato {
  mes?: string;
  por?: 'data' | 'competencia';
  contaId?: string;
  categoriaId?: string;
  natureza?: Natureza;
  busca?: string;
  editados?: boolean;
  pagina?: number;
}

export const useMovimentos = (f: FiltroExtrato) =>
  useQuery({
    queryKey: ['movimentos', f],
    queryFn: () => api.get<PaginaMovimentos>(`/movimentos${consulta({ ...f, editados: f.editados ? '1' : undefined, tamanho: 80 })}`),
    placeholderData: keepPreviousData,
  });

export const useCartoes = () => useQuery({ queryKey: ['cartoes'], queryFn: () => api.get<VisaoCartao[]>('/cartoes') });

export const useItensDaFatura = (contaId: string | undefined, mes: string | undefined) =>
  useQuery({
    queryKey: ['fatura', contaId, mes],
    queryFn: () => api.get<Movimento[]>(`/cartoes/${contaId}/faturas/${mes}`),
    enabled: Boolean(contaId && mes),
    placeholderData: keepPreviousData,
  });

export const useCaixinhas = () => useQuery({ queryKey: ['caixinhas'], queryFn: () => api.get<Caixinhas>('/caixinhas') });
export const useOrcamento = (mes: string) =>
  useQuery({ queryKey: ['orcamento', mes], queryFn: () => api.get<Orcamento>(`/orcamento${consulta({ mes })}`), placeholderData: keepPreviousData });
export const useMetas = () => useQuery({ queryKey: ['metas'], queryFn: () => api.get<Meta[]>('/metas') });
export const useRecorrencias = () =>
  useQuery({ queryKey: ['recorrencias'], queryFn: () => api.get<{ itens: Recorrencia[]; mensal: number; anual: number }>('/recorrencias') });
export const useInsights = (mes: string) =>
  useQuery({ queryKey: ['insights', mes], queryFn: () => api.get<Insights>(`/insights${consulta({ mes })}`), placeholderData: keepPreviousData });
export const useRegras = () => useQuery({ queryKey: ['regras'], queryFn: () => api.get<Regra[]>('/regras') });
export const useContasAPagar = () => useQuery({ queryKey: ['contas-a-pagar'], queryFn: () => api.get<ContaAPagar[]>('/contas-a-pagar') });
export const useFaturasAPagar = () =>
  useQuery({ queryKey: ['contas-a-pagar', 'faturas'], queryFn: () => api.get<VencimentoDeCartao[]>('/contas-a-pagar/faturas') });
export const useCandidatosAPagamento = (contaId: string | null) =>
  useQuery({
    queryKey: ['contas-a-pagar', 'candidatos', contaId],
    queryFn: () => api.get<CandidatoAPagamento[]>(`/contas-a-pagar/${contaId}/candidatos`),
    enabled: Boolean(contaId),
  });
export const useSincronizacoes = () => useQuery({ queryKey: ['sincronizacoes'], queryFn: () => api.get<Sincronizacao[]>('/sincronizacoes') });

/**
 * Qualquer escrita pode mudar qualquer número de qualquer tela (uma
 * recategorização mexe no orçamento, no Sankey e nos insights) — então toda
 * mutação invalida tudo. São poucas consultas e todas locais: é barato.
 */
export function useEscrita<TEntrada, TSaida = unknown>(fazer: (e: TEntrada) => Promise<TSaida>) {
  const cliente = useQueryClient();
  return useMutation({ mutationFn: fazer, onSettled: () => cliente.invalidateQueries() });
}

export type PedidoDeDispensa = { tipo: 'dispensar'; ids: string[] } | { tipo: 'dispensar-todos' } | { tipo: 'restaurar' };

/** Tira da visão geral os avisos dispensados (`null` = todos) e soma na contagem. */
function esconderAlertas(v: VisaoGeral, ids: ReadonlySet<string> | null): VisaoGeral {
  const ficam = ids ? v.alertas.filter((a) => !ids.has(a.id)) : [];
  return { ...v, alertas: ficam, alertasDispensados: (v.alertasDispensados ?? 0) + v.alertas.length - ficam.length };
}

/**
 * O "X" dos avisos, o "Marcar todos como vistos" e o "Mostrar dispensados".
 * Dispensar some com o aviso na hora em toda visão geral em cache (o sino e as
 * faixas leem dali); se o servidor recusar, tudo volta como estava. A resposta
 * do servidor é a palavra final, e a visão geral é recarregada em seguida.
 */
export function useDispensaDeAlertas() {
  const cliente = useQueryClient();
  const chave = { queryKey: ['visao-geral'] };
  return useMutation({
    mutationFn: (p: PedidoDeDispensa) =>
      api.post<SituacaoDosAlertas>(`/alertas/${p.tipo}`, p.tipo === 'dispensar' ? { ids: p.ids } : {}),
    onMutate: async (p) => {
      if (p.tipo === 'restaurar') return { antes: [] };
      await cliente.cancelQueries(chave);
      const antes = cliente.getQueriesData<VisaoGeral>(chave);
      const ids = p.tipo === 'dispensar' ? new Set(p.ids) : null;
      cliente.setQueriesData<VisaoGeral>(chave, (v) => v && esconderAlertas(v, ids));
      return { antes };
    },
    onError: (_erro, _p, contexto) => {
      for (const [k, dados] of contexto?.antes ?? []) cliente.setQueryData(k, dados);
    },
    onSuccess: (s) => {
      cliente.setQueriesData<VisaoGeral>(chave, (v) => v && { ...v, alertas: s.alertas, alertasDispensados: s.dispensados });
    },
    onSettled: () => cliente.invalidateQueries(chave),
  });
}
