import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ESPERA_MINIMA_MS, precisaSincronizar, useSincronizarAoAbrir } from './sincronizacao-automatica';

const AGORA = new Date('2026-10-08T20:00:00.000Z').getTime();
const ha = (ms: number) => new Date(AGORA - ms).toISOString();
const conexao = (p: Partial<Parameters<typeof precisaSincronizar>[0]> = {}) =>
  ({ id: 'c1', provedor: 'pluggy' as const, ultimaSincronizacao: ha(ESPERA_MINIMA_MS + 1000), sincronizando: false, ...p });

describe('precisaSincronizar', () => {
  it('conexão real parada há mais de 5 minutos, ou que nunca sincronizou: sim', () => {
    expect(precisaSincronizar(conexao(), AGORA)).toBe(true);
    expect(precisaSincronizar(conexao({ ultimaSincronizacao: null }), AGORA)).toBe(true);
  });

  it('sincronizou há pouco, já está sincronizando ou é a demonstração: não', () => {
    expect(precisaSincronizar(conexao({ ultimaSincronizacao: ha(60_000) }), AGORA)).toBe(false);
    expect(precisaSincronizar(conexao({ sincronizando: true }), AGORA)).toBe(false);
    expect(precisaSincronizar(conexao({ provedor: 'demo' }), AGORA)).toBe(false);
  });
});

describe('useSincronizarAoAbrir', () => {
  const chamadas: string[] = [];
  beforeEach(() => {
    chamadas.length = 0;
    vi.spyOn(Date, 'now').mockReturnValue(AGORA);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`);
      return new Response(JSON.stringify({ novas: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const montar = (conexoes: ReturnType<typeof conexao>[] | undefined) => {
    const cliente = new QueryClient();
    const envolver = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
    return renderHook(({ c }) => useSincronizarAoAbrir(c), { initialProps: { c: conexoes }, wrapper: envolver });
  };

  it('ao abrir, puxa da Pluggy (só leitura) as conexões paradas', async () => {
    montar([conexao(), conexao({ id: 'c2', ultimaSincronizacao: ha(60_000) })]);
    await act(async () => {});
    expect(chamadas).toEqual(['POST /api/conexoes/c1/sincronizar {"pedirAoBanco":false}']);
  });

  it('espera o estado carregar e verifica só uma vez ao abrir', async () => {
    const { rerender } = montar(undefined);
    await act(async () => {});
    expect(chamadas).toEqual([]);
    rerender({ c: [conexao()] });
    await act(async () => {});
    rerender({ c: [conexao()] });
    await act(async () => {});
    expect(chamadas).toHaveLength(1);
  });

  it('ao voltar para a janela, verifica de novo', async () => {
    montar([conexao({ ultimaSincronizacao: ha(60_000) })]);
    await act(async () => {});
    expect(chamadas).toEqual([]);
    vi.spyOn(Date, 'now').mockReturnValue(AGORA + ESPERA_MINIMA_MS);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(chamadas).toHaveLength(1);
  });
});
