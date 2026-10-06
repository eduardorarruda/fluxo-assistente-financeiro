import { useEffect, useSyncExternalStore } from 'react';
import { api, ErroApi } from './cliente';

/**
 * A voz natural (Piper), que roda no servidor do Fluxo — nesta máquina. Um
 * estado só para a tela inteira (Ajustes, modo conversação, "Ouvir exemplo"),
 * fora do React Query de propósito: o motor de fala também o lê, e ele vive
 * fora da árvore de componentes. Enquanto uma voz baixa, o estado se atualiza
 * sozinho.
 */

export type GeneroVozNatural = 'feminina' | 'masculina';

export interface VozNatural {
  id: string;
  nome: string;
  genero: GeneroVozNatural;
  qualidade: 'média' | 'alta';
  descricao: string;
  tamanhoMb: number;
  licenca: string;
  credito: string;
  naoComercial: boolean;
  instalada: boolean;
}

export interface EstadoVozNatural {
  instalada: boolean;
  baixando: boolean;
  vozBaixando: string | null;
  etapa: 'baixando' | 'instalando' | null;
  progresso: number | null;
  vozes: VozNatural[];
  vozPadrao: string;
  erro: string | null;
}

const BASE = '/assistente/voz';
const POLL_MS = 800;

let estado: EstadoVozNatural | null = null;
let carregando = false;
let falhou: string | null = null;
let pedido: Promise<void> | null = null;
let relogio: ReturnType<typeof setTimeout> | null = null;
const ouvintes = new Set<() => void>();

const avisar = () => ouvintes.forEach((o) => o());

/** Servidor antigo (ou resposta estranha): sem lista de vozes, a voz natural fica indisponível. */
const ehEstado = (x: unknown): x is EstadoVozNatural =>
  typeof x === 'object' && x !== null && Array.isArray((x as EstadoVozNatural).vozes) && typeof (x as EstadoVozNatural).instalada === 'boolean';

function definir(novo: unknown) {
  if (!ehEstado(novo)) throw new ErroApi(0, 'Esta versão do Fluxo não respondeu sobre as vozes naturais.');
  estado = novo;
  falhou = null;
  avisar();
  agendar();
}

/** Enquanto baixa, relê o estado; quando acaba, para. */
function agendar() {
  if (relogio) clearTimeout(relogio);
  relogio = null;
  if (estado?.baixando && ouvintes.size > 0) relogio = setTimeout(() => void atualizarVozNatural(), POLL_MS);
}

/** Relê do servidor. Erro (servidor antigo, sem rede) não quebra nada: a voz natural fica indisponível. */
export function atualizarVozNatural(): Promise<void> {
  pedido ??= (async () => {
    carregando = true;
    avisar();
    try {
      definir(await api.get<unknown>(BASE));
    } catch (e) {
      falhou = e instanceof ErroApi ? e.message : 'Não foi possível ler as vozes naturais.';
    } finally {
      carregando = false;
      pedido = null;
      avisar();
    }
  })();
  return pedido;
}

export async function baixarVozNatural(voz: string): Promise<void> {
  definir(await api.post<EstadoVozNatural>(`${BASE}/baixar`, { voz }));
}

export async function removerVozNatural(voz: string): Promise<void> {
  definir(await api.delete<EstadoVozNatural>(`${BASE}/${encodeURIComponent(voz)}`));
}

/** Pede ao servidor para carregar o modelo agora (abrir o modo conversação), para a primeira frase sair rápido. */
export function prepararVozNatural(voz: string | null): void {
  void api.post(`${BASE}/preparar`, voz ? { voz } : {}).catch(() => undefined);
}

export interface PedidoDeSintese {
  texto: string;
  voz: string | null;
  velocidade: number;
}

/** Uma frase → bytes de WAV. `sinal` cancela (parar de falar). */
export type Sintetizar = (pedido: PedidoDeSintese, sinal: AbortSignal) => Promise<ArrayBuffer>;

export const sintetizarNoServidor: Sintetizar = async ({ texto, voz, velocidade }, sinal) => {
  const resposta = await fetch(`/api${BASE}/falar`, {
    method: 'POST',
    headers: { 'X-Fluxo': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto, velocidade, ...(voz ? { voz } : {}) }),
    credentials: 'same-origin',
    signal: sinal,
  });
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { erro?: string };
    throw new ErroApi(resposta.status, corpo.erro ?? `Erro ${resposta.status}`);
  }
  return resposta.arrayBuffer();
};

// ---------- leitura (React)

export interface LeituraVozNatural {
  estado: EstadoVozNatural | null;
  carregando: boolean;
  erro: string | null;
}

let instantaneo: LeituraVozNatural = { estado, carregando, erro: falhou };
function obter(): LeituraVozNatural {
  if (instantaneo.estado !== estado || instantaneo.carregando !== carregando || instantaneo.erro !== falhou) {
    instantaneo = { estado, carregando, erro: falhou };
  }
  return instantaneo;
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  agendar();
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0 && relogio) {
      clearTimeout(relogio);
      relogio = null;
    }
  };
}

/** O estado da voz natural; a primeira tela que pede busca no servidor. */
export function useVozNatural(): LeituraVozNatural {
  const leitura = useSyncExternalStore(assinar, obter, obter);
  useEffect(() => {
    if (!estado && !pedido) void atualizarVozNatural();
  }, []);
  return leitura;
}

/** O estado atual, sem React (o motor de fala). */
export const estadoVozNatural = (): EstadoVozNatural | null => estado;

/** Só para os testes. */
export function definirEstadoVozNatural(novo: EstadoVozNatural | null): void {
  if (relogio) clearTimeout(relogio);
  relogio = null;
  estado = novo;
  falhou = null;
  pedido = null;
  avisar();
}
