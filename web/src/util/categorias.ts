import { useMemo } from 'react';
import { useCategorias } from '../api/consultas';
import type { Categoria } from '../api/tipos';

const DESCONHECIDA: Categoria = { id: '?', nome: 'Sem categoria', grupo: 'DESPESA', cor: '#64748B', icone: 'pontos' };

export const NATUREZAS: Record<string, { nome: string; icone: string; cor: string }> = {
  PAGAMENTO_FATURA: { nome: 'Pagamento de fatura', icone: 'cartao', cor: '#A78BFA' },
  TRANSFERENCIA: { nome: 'Entre suas contas', icone: 'setas', cor: '#94A3B8' },
  INVESTIMENTO: { nome: 'Caixinha', icone: 'caixinha', cor: '#F5B83D' },
};

export function useCategoriaPorId(): (id: string | null | undefined) => Categoria {
  const { data } = useCategorias();
  return useMemo(() => {
    const mapa = new Map((data ?? []).map((c) => [c.id, c]));
    return (id) => (id ? (mapa.get(id) ?? DESCONHECIDA) : DESCONHECIDA);
  }, [data]);
}
