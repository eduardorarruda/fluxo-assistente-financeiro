import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import type { ConfigImagens, MudancaImagens } from './tipos-assistente';

/**
 * Ajustes das imagens (Nano Banana). A chave só VAI para o servidor: nenhuma
 * resposta a traz de volta, e nada aqui a guarda em cache.
 */

export const CHAVE_IMAGENS = ['assistente', 'imagens'] as const;
const CAMINHO = '/assistente/imagens/config';

export const useConfigImagens = () => useQuery({ queryKey: CHAVE_IMAGENS, queryFn: () => api.get<ConfigImagens>(CAMINHO) });

export function useMudarImagens() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (mudanca: MudancaImagens) => api.put<ConfigImagens>(CAMINHO, mudanca),
    onSuccess: (config) => cliente.setQueryData(CHAVE_IMAGENS, config),
  });
}

export function useRemoverChaveImagens() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<ConfigImagens>(CAMINHO),
    onSuccess: (config) => cliente.setQueryData(CHAVE_IMAGENS, config),
  });
}
