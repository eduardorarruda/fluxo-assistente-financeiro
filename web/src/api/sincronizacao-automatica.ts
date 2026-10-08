import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from './cliente';
import type { Conexao } from './tipos';

/**
 * Abriu o Fluxo (ou voltou para a janela) e a última sincronização tem mais de
 * 5 minutos: puxa da Pluggy na hora, em vez de esperar o ciclo de 30 minutos do
 * servidor. Só lê o que a Pluggy já tem — pedir ao banco é o botão Atualizar.
 */

export const ESPERA_MINIMA_MS = 5 * 60_000;

type ConexaoResumo = Pick<Conexao, 'id' | 'provedor' | 'ultimaSincronizacao' | 'sincronizando'>;

export function precisaSincronizar(c: ConexaoResumo, agora: number): boolean {
  if (c.provedor !== 'pluggy' || c.sincronizando) return false;
  if (!c.ultimaSincronizacao) return true;
  return agora - new Date(c.ultimaSincronizacao).getTime() > ESPERA_MINIMA_MS;
}

export function useSincronizarAoAbrir(conexoes: readonly ConexaoResumo[] | undefined): void {
  const cliente = useQueryClient();
  const atuais = useRef(conexoes);
  atuais.current = conexoes;
  const rodando = useRef(false);
  const verificouAoAbrir = useRef(false);

  useEffect(() => {
    const verificar = async () => {
      const lista = atuais.current;
      if (!lista || rodando.current) return;
      const pendentes = lista.filter((c) => precisaSincronizar(c, Date.now()));
      if (!pendentes.length) return;
      rodando.current = true;
      try {
        // O erro fica registrado na conexão (tela Conexões); aqui não interrompe nada.
        for (const c of pendentes) {
          await api.post(`/conexoes/${encodeURIComponent(c.id)}/sincronizar`, { pedirAoBanco: false }).catch(() => undefined);
        }
        await cliente.invalidateQueries();
      } finally {
        rodando.current = false;
      }
    };
    if (conexoes && !verificouAoAbrir.current) {
      verificouAoAbrir.current = true;
      void verificar();
    }
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void verificar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [conexoes, cliente]);
}
