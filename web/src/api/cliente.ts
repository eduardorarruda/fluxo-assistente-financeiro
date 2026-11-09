/** Erro vindo da API, com a mensagem que o servidor já preparou para o usuário. */
export class ErroApi extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

/** Opções de escrita. `idempotencia`: a mesma chave em dois pedidos faz a escrita uma vez só (clique duplo). */
export interface OpcoesEscrita {
  idempotencia?: string;
}

async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown, opcoes: OpcoesEscrita = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, {
      method: metodo,
      // X-Fluxo: o servidor recusa escrita sem ele (obriga o preflight de CORS em qualquer outro site).
      headers: {
        'X-Fluxo': '1',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opcoes.idempotencia ? { 'Idempotency-Key': opcoes.idempotencia } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ErroApi(0, 'O Fluxo não está respondendo. Ele foi fechado?');
  }
  if (resposta.status === 204) return undefined as T;
  const dados = (await resposta.json().catch(() => ({}))) as { erro?: string };
  if (!resposta.ok) throw new ErroApi(resposta.status, dados.erro ?? `O Fluxo não conseguiu concluir isso (erro ${resposta.status}). Tente de novo; se continuar, feche e abra o Fluxo.`);
  return dados as T;
}

export const api = {
  get: <T>(caminho: string) => requisitar<T>('GET', caminho),
  post: <T>(caminho: string, corpo: unknown = {}, opcoes?: OpcoesEscrita) => requisitar<T>('POST', caminho, corpo, opcoes),
  put: <T>(caminho: string, corpo: unknown) => requisitar<T>('PUT', caminho, corpo),
  patch: <T>(caminho: string, corpo: unknown) => requisitar<T>('PATCH', caminho, corpo),
  delete: <T = void>(caminho: string) => requisitar<T>('DELETE', caminho),
};

/** Monta ?a=1&b=2 ignorando o que estiver vazio. */
export function consulta(parametros: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
