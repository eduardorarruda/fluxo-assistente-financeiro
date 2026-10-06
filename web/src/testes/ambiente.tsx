import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { Categoria, Movimento } from '../api/tipos';
import { ProvedorAvisos } from '../componentes/Avisos';
import { ProvedorPreferencias } from '../util/preferencias';

export const CATEGORIAS: Categoria[] = [
  { id: 'mercado', nome: 'Mercado', grupo: 'DESPESA', cor: '#34D399', icone: 'sacola' },
  { id: 'restaurantes', nome: 'Restaurantes', grupo: 'DESPESA', cor: '#FB923C', icone: 'talheres' },
  { id: 'salario', nome: 'Salário', grupo: 'RECEITA', cor: '#10B981', icone: 'maleta' },
];

export function movimento(p: Partial<Movimento> = {}): Movimento {
  return {
    id: 'm1', contaId: 'c', tipoConta: 'CARTAO', data: '2026-09-20', descricao: 'Padaria Real', descricaoOriginal: null,
    valor: 4023, sentido: 'SAIDA', pendente: false, categoriaProvedor: 'Eating out', estabelecimento: null, contraparteNome: null,
    meioPagamento: null, parcela: null, natureza: 'DESPESA', categoriaId: 'restaurantes', competencia: '2026-09', nota: null,
    editado: false, ignorado: false, conta: 'Nubank Ultravioleta', ...p,
  };
}

/** Renderiza com os provedores do app e um fetch falso que responde por rota. */
export function renderizar(ui: ReactNode, respostas: Record<string, unknown> = {}) {
  const chamadas: { metodo: string; url: string; corpo: unknown }[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const caminho = String(url);
    chamadas.push({ metodo: init?.method ?? 'GET', url: caminho, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const chave = Object.keys(respostas).find((k) => caminho.startsWith(k));
    const corpo = chave ? respostas[chave] : caminho === '/api/categorias' ? CATEGORIAS : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { ...montarComProvedores(ui), chamadas };
}

/** Os provedores do app em volta de `ui`, com o roteador começando em `rota`. */
export function montarComProvedores(ui: ReactNode, rota = '/') {
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={consultas}>
      <ProvedorPreferencias>
        <ProvedorAvisos>
          <MemoryRouter initialEntries={[rota]}>{ui}</MemoryRouter>
        </ProvedorAvisos>
      </ProvedorPreferencias>
    </QueryClientProvider>,
  );
}
