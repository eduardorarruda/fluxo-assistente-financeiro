import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, consulta, ErroApi } from './cliente';
import type {
  Anexo, ConfigAssistente, Conversa, EstadoRag, Mensagem, ModelosDaConta, MudancaConfig, MudancaConta, MudancaConversa, NovaConta, NovaConversa,
  NovaMensagem, RespostaEnvio, RespostaRepetir, ResultadoTeste, ResumoConversa,
} from './tipos-assistente';

/**
 * Chaves do Assistente. Nada aqui usa o `useEscrita` global (que invalida tudo):
 * conversar não muda nenhum número das outras telas, então só as chaves
 * ['assistente', …] são tocadas.
 */
export const CHAVES = {
  tudo: ['assistente'] as const,
  config: ['assistente', 'config'] as const,
  listas: ['assistente', 'conversas'] as const,
  todasConversas: ['assistente', 'conversa'] as const,
  conversas: (busca: string) => ['assistente', 'conversas', busca] as const,
  conversa: (id: string) => ['assistente', 'conversa', id] as const,
  modelos: (contaId: string) => ['assistente', 'modelos', contaId] as const,
};

const POLL_RAG_MS = 1500;
/** A lista de modelos do provedor muda pouco: relê a cada 10 minutos, no máximo. */
const VALIDADE_MODELOS_MS = 10 * 60_000;
const POLL_LISTA_GERANDO_MS = 5000;
const BASE = '/assistente';
const id = (s: string) => encodeURIComponent(s);

// ---------- consultas

export const useConfigAssistente = () =>
  useQuery({
    queryKey: CHAVES.config,
    queryFn: () => api.get<ConfigAssistente>(`${BASE}/config`),
    refetchInterval: (q) => (q.state.data?.rag.preparando ? POLL_RAG_MS : false),
  });

export const useConversas = (busca: string) =>
  useQuery({
    queryKey: CHAVES.conversas(busca),
    queryFn: () => api.get<ResumoConversa[]>(`${BASE}/conversas${consulta({ busca: busca.trim() || undefined })}`),
    placeholderData: (anterior) => anterior,
    refetchInterval: (q) => (q.state.data?.some((c) => c.gerando) ? POLL_LISTA_GERANDO_MS : false),
  });

/**
 * Enquanto há execução, o que vale é o que chega pelo SSE: recarregar a conversa
 * no meio trocaria o texto parcial por um retrato do servidor e bagunçaria os pedaços.
 */
export const useConversa = (conversaId: string | undefined) =>
  useQuery({
    queryKey: CHAVES.conversa(conversaId ?? ''),
    queryFn: () => api.get<Conversa>(`${BASE}/conversas/${id(conversaId ?? '')}`),
    enabled: Boolean(conversaId),
    refetchOnWindowFocus: (q) => !q.state.data?.execucaoAtiva,
    staleTime: 60_000,
  });

/**
 * Modelos de uma conta de API, lidos ao vivo do provedor. Só para contas de API
 * (`habilitado`); quem usa mostra o catálogo fixo enquanto carrega ou se falhar.
 */
export const useModelosDaConta = (contaId: string | undefined, habilitado: boolean) =>
  useQuery({
    queryKey: CHAVES.modelos(contaId ?? ''),
    queryFn: () => api.get<ModelosDaConta>(`${BASE}/contas/${id(contaId ?? '')}/modelos`),
    enabled: habilitado && Boolean(contaId),
    staleTime: VALIDADE_MODELOS_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

// ---------- ajudantes de cache (sempre cópias novas)

export function mudarConversaNoCache(cliente: QueryClient, conversaId: string, mudar: (c: Conversa) => Conversa): void {
  cliente.setQueryData<Conversa>(CHAVES.conversa(conversaId), (atual) => (atual ? mudar(atual) : atual));
}

const invalidarListas = (cliente: QueryClient) => cliente.invalidateQueries({ queryKey: CHAVES.listas });

function trocarMensagem(mensagens: Mensagem[], antigaId: string, nova: Mensagem): Mensagem[] {
  const semDuplicata = mensagens.filter((m) => m.id !== nova.id || m.id === antigaId);
  const idx = semDuplicata.findIndex((m) => m.id === antigaId);
  if (idx === -1) return [...semDuplicata, nova];
  return semDuplicata.map((m, i) => (i === idx ? nova : m));
}

// ---------- conversas

export function useCriarConversa() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovaConversa) => api.post<ResumoConversa>(`${BASE}/conversas`, corpo),
    onSuccess: (resumo) => {
      cliente.setQueryData<Conversa>(CHAVES.conversa(resumo.id), { ...resumo, mensagens: [], execucaoAtiva: null });
      void invalidarListas(cliente);
    },
  });
}

export function useMudarConversa() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ conversaId, ...mudanca }: MudancaConversa & { conversaId: string }) =>
      api.patch<ResumoConversa>(`${BASE}/conversas/${id(conversaId)}`, mudanca),
    onSuccess: (resumo) => {
      mudarConversaNoCache(cliente, resumo.id, (c) => ({ ...c, ...resumo, gerando: c.gerando }));
      void invalidarListas(cliente);
    },
  });
}

export function useApagarConversa() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (conversaId: string) => api.delete(`${BASE}/conversas/${id(conversaId)}`),
    onSuccess: (_r, conversaId) => {
      cliente.removeQueries({ queryKey: CHAVES.conversa(conversaId) });
      void invalidarListas(cliente);
    },
  });
}

// ---------- mensagens e execuções

export function useEnviarMensagem() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ conversaId, ...corpo }: NovaMensagem & { conversaId: string }) =>
      api.post<RespostaEnvio>(`${BASE}/conversas/${id(conversaId)}/mensagens`, corpo),
    onSuccess: (r, { conversaId }) => {
      const existe = cliente.getQueryData<Conversa>(CHAVES.conversa(conversaId));
      if (!existe) {
        void cliente.invalidateQueries({ queryKey: CHAVES.conversa(conversaId) });
      } else {
        mudarConversaNoCache(cliente, conversaId, (c) => ({
          ...c,
          gerando: true,
          execucaoAtiva: r.execucaoId,
          mensagens: [...c.mensagens.filter((m) => m.id !== r.usuario.id && m.id !== r.assistente.id), r.usuario, r.assistente],
        }));
      }
      void invalidarListas(cliente);
    },
  });
}

export function useRepetirMensagem() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ mensagemId }: { conversaId: string; mensagemId: string }) =>
      api.post<RespostaRepetir>(`${BASE}/mensagens/${id(mensagemId)}/repetir`),
    onSuccess: (r, { conversaId, mensagemId }) => {
      mudarConversaNoCache(cliente, conversaId, (c) => ({
        ...c,
        gerando: true,
        execucaoAtiva: r.execucaoId,
        mensagens: trocarMensagem(c.mensagens, mensagemId, r.assistente),
      }));
      void invalidarListas(cliente);
    },
  });
}

/** O SSE entrega o `fim` com a mensagem cancelada; aqui não se recarrega nada para não brigar com ele. */
export function useCancelarExecucao() {
  return useMutation({
    mutationFn: (execucaoId: string) => api.post<void>(`${BASE}/execucoes/${id(execucaoId)}/cancelar`),
  });
}

export const apagarAnexo = (anexoId: string) => api.delete(`${BASE}/anexos/${id(anexoId)}`);

// ---------- ajustes

/**
 * Toda escrita de conta devolve a configuração inteira: vai direto para o cache.
 * `gcTime: 0`: o corpo pode levar uma chave de API, e a mutação guarda o corpo
 * (`variables`) — assim ele some do cache assim que ninguém mais olha (`reset()`).
 */
function useEscritaConfig<T>(mutationFn: (entrada: T) => Promise<ConfigAssistente>, aoTerminar?: (cliente: QueryClient, entrada: T) => void) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn,
    gcTime: 0,
    onSuccess: (config, entrada) => {
      cliente.setQueryData(CHAVES.config, config);
      aoTerminar?.(cliente, entrada);
    },
  });
}

export const useMudarConfig = () => useEscritaConfig((mudanca: MudancaConfig) => api.put<ConfigAssistente>(`${BASE}/config`, mudanca));

export const useCriarConta = () => useEscritaConfig((corpo: NovaConta) => api.post<ConfigAssistente>(`${BASE}/contas`, corpo));

/** Chave nova: a lista de modelos ao vivo daquela conta é relida com ela. */
export const useMudarConta = () =>
  useEscritaConfig(
    ({ contaId, ...mudanca }: MudancaConta & { contaId: string }) => api.patch<ConfigAssistente>(`${BASE}/contas/${id(contaId)}`, mudanca),
    (cliente, { contaId, chave }) => {
      if (chave !== undefined) void cliente.invalidateQueries({ queryKey: CHAVES.modelos(contaId) });
    },
  );

/** As conversas da conta removida passam para a padrão: as listas e conversas abertas são relidas. */
export const useRemoverConta = () =>
  useEscritaConfig(
    (contaId: string) => api.delete<ConfigAssistente>(`${BASE}/contas/${id(contaId)}`),
    (cliente) => {
      void invalidarListas(cliente);
      void cliente.invalidateQueries({ queryKey: CHAVES.todasConversas });
    },
  );

export function useTestarConta() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (contaId: string) => api.post<ResultadoTeste>(`${BASE}/contas/${id(contaId)}/testar`),
    onSettled: () => cliente.invalidateQueries({ queryKey: CHAVES.config }),
  });
}

export function useAcaoRag() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (acao: 'ativar' | 'reindexar') => api.post<EstadoRag>(`${BASE}/rag/${acao}`),
    onSuccess: (rag) => cliente.setQueryData<ConfigAssistente>(CHAVES.config, (c) => (c ? { ...c, rag } : c)),
  });
}

// ---------- anexos (XHR: o fetch não informa o progresso do envio)

export interface EnvioAnexo {
  conversaId: string;
  arquivo: File;
  aoProgresso?: (fracao: number) => void;
  sinal?: AbortSignal;
}

function erroDoXhr(xhr: XMLHttpRequest): ErroApi {
  let mensagem = `Erro ${xhr.status}`;
  try {
    const dados = JSON.parse(xhr.responseText) as { erro?: unknown };
    if (typeof dados.erro === 'string') mensagem = dados.erro;
  } catch {
    /* resposta sem JSON: fica o status */
  }
  return new ErroApi(xhr.status, mensagem);
}

export function enviarAnexo({ conversaId, arquivo, aoProgresso, sinal }: EnvioAnexo): Promise<Anexo> {
  return new Promise<Anexo>((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${BASE}/conversas/${id(conversaId)}/anexos?nome=${encodeURIComponent(arquivo.name)}`);
    // Mesma origem: o cookie da sessão vai sozinho. X-Fluxo: o servidor recusa escrita sem ele.
    xhr.setRequestHeader('X-Fluxo', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) aoProgresso?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return rejeitar(erroDoXhr(xhr));
      try {
        resolver(JSON.parse(xhr.responseText) as Anexo);
      } catch {
        rejeitar(new ErroApi(xhr.status, 'Resposta inesperada do servidor.'));
      }
    };
    xhr.onerror = () => rejeitar(new ErroApi(0, 'O Fluxo não está respondendo. Ele foi fechado?'));
    xhr.onabort = () => rejeitar(new DOMException('Envio cancelado', 'AbortError'));
    if (sinal?.aborted) return rejeitar(new DOMException('Envio cancelado', 'AbortError'));
    sinal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(arquivo);
  });
}
