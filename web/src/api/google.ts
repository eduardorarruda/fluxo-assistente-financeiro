import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';

/**
 * Google Agenda. O client secret só VAI para o servidor: nenhuma resposta o
 * traz de volta (nem o refresh token), e nada aqui o guarda em cache.
 */

export interface PreferenciasGoogle {
  cartao: boolean;
  contas: boolean;
  atrasos: boolean;
  hora: number;
  antecedencias: number[];
}

export interface EstadoGoogle {
  configurado: boolean;
  clienteId: string | null;
  conectado: boolean;
  email: string | null;
  agendaId: string | null;
  ultimaSincronizacao: string | null;
  sincronizando: boolean;
  erro: string | null;
  precisaReconectar: boolean;
  eventos: number;
  enderecoDeRetorno: string;
  preferencias: PreferenciasGoogle;
  contasDisponiveis: boolean;
}

export const CHAVE_GOOGLE = ['google'] as const;

/** Enquanto a pessoa está no Google (ou sincronizando), o estado é consultado a cada 1,5 s. */
export function useEstadoGoogle(aguardando = false) {
  return useQuery({
    queryKey: CHAVE_GOOGLE,
    queryFn: () => api.get<EstadoGoogle>('/google/estado'),
    refetchInterval: (q) => (aguardando || q.state.data?.sincronizando ? 1500 : false),
  });
}

function useEscritaGoogle<E, R extends EstadoGoogle = EstadoGoogle>(fazer: (entrada: E) => Promise<R>) {
  const cliente = useQueryClient();
  return useMutation({ mutationFn: fazer, onSuccess: (estado) => cliente.setQueryData(CHAVE_GOOGLE, estado) });
}

export const useSalvarCredenciaisGoogle = () =>
  useEscritaGoogle((c: { clientId: string; clientSecret: string }) => api.put<EstadoGoogle>('/google/cliente', c));

export const useRemoverCredenciaisGoogle = () => useEscritaGoogle(() => api.delete<EstadoGoogle>('/google/cliente'));

export const usePreferenciasGoogle = () =>
  useEscritaGoogle((p: Partial<PreferenciasGoogle>) => api.put<EstadoGoogle>('/google/preferencias', p));

export const useSincronizarGoogle = () => useEscritaGoogle(() => api.post<EstadoGoogle>('/google/sincronizar'));

export const useDesconectarGoogle = () =>
  useEscritaGoogle((apagarAgenda: boolean) => api.post<EstadoGoogle & { aviso: string | null }>('/google/desconectar', { apagarAgenda }));

export const iniciarConexaoGoogle = () => api.post<{ url: string }>('/google/conectar');
