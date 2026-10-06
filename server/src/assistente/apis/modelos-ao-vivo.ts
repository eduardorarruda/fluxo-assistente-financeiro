import { Logger } from '@nestjs/common';
import { comoObjeto, cortar, lista, texto } from '../cli/comum';
import type { ModeloIA } from '../cli/modelos';
import type { ProvedorIA } from '../cli/tipos';
import { ENDERECOS_API } from './fabrica-de-modelos';
import { PROVEDORES_API } from './provedores-api';

/**
 * A lista de modelos que a chave da pessoa enxerga, direto da API do
 * provedor (GET /models), misturada ao catálogo: os do catálogo primeiro (com
 * nome e descrição em português), depois os outros que a API oferece. Falhou
 * (sem rede, chave recusada)? Volta o catálogo, com `aoVivo: false` — nunca lança.
 */

export interface ListaDeModelos {
  modelos: ModeloIA[];
  aoVivo: boolean;
}

export type BuscarHttp = (url: string, init: RequestInit) => Promise<Response>;

interface ModeloDaApi {
  id: string;
  nome: string | null;
}

const VALIDADE_MS = 10 * 60_000;
const TEMPO_MAXIMO_MS = 10_000;
const MAXIMO_DE_MODELOS = 300;
const TAMANHO_NOME = 80;
const VERSAO_ANTHROPIC = '2023-06-01';
/** Id de modelo que a API devolve só entra se puder ir na URL do provedor (ver `nomeDeModeloDeApi` em execucao/rodada-api.ts). */
const ID_VALIDO = /^(?!.*\.\.)[A-Za-z0-9][\w.:-]{0,99}$/;
const OPENAI_CONVERSA = /^(gpt-|chatgpt|o\d)/;
const OPENAI_FORA = /embedding|tts|whisper|dall-e|image|audio|realtime|moderation|transcribe|search/;
const GEMINI_FORA = /embedding|image|tts|audio|aqa|imagen|veo|lyria/;

export class ModelosAoVivo {
  private readonly log = new Logger('ModelosAoVivo');
  private readonly cache = new Map<string, { quando: number; lista: ListaDeModelos }>();

  constructor(
    private readonly buscar: BuscarHttp = (url, init) => fetch(url, init),
    private readonly agora: () => number = Date.now,
  ) {}

  async listar(contaId: string, provedor: ProvedorIA, chave: string | null): Promise<ListaDeModelos> {
    const catalogo = { modelos: [...PROVEDORES_API[provedor].modelos], aoVivo: false };
    if (!chave) return catalogo;
    const guardado = this.cache.get(contaId);
    if (guardado && this.agora() - guardado.quando < VALIDADE_MS) return guardado.lista;
    try {
      const daApi = await this.daApi(provedor, chave);
      // Resposta sem nenhum modelo de conversa é formato que não entendemos, não "a chave não tem modelos".
      if (!daApi.length) throw new Error('a lista veio sem modelos de conversa');
      const lista = { modelos: misturar(PROVEDORES_API[provedor].modelos, daApi), aoVivo: true };
      this.cache.set(contaId, { quando: this.agora(), lista });
      return lista;
    } catch (e) {
      // Só o motivo curto: a URL não leva a chave, mas a mensagem de erro pode vir de qualquer lugar.
      this.log.warn(`Não consegui listar os modelos da ${PROVEDORES_API[provedor].nome}: ${cortar(String((e as Error).message ?? e), 120)}`);
      return catalogo;
    }
  }

  /** Chave trocada ou conta removida: a próxima consulta busca de novo. */
  esquecer(contaId: string): void {
    this.cache.delete(contaId);
  }

  private async daApi(provedor: ProvedorIA, chave: string): Promise<ModeloDaApi[]> {
    const base = ENDERECOS_API[provedor];
    if (provedor === 'claude') {
      const corpo = await this.json(`${base}/models?limit=1000`, { 'x-api-key': chave, 'anthropic-version': VERSAO_ANTHROPIC });
      return lista(corpo.data).map(comoObjeto).flatMap((m) => modelo(texto(m?.id), texto(m?.display_name)));
    }
    if (provedor === 'gemini') {
      const corpo = await this.json(`${base}/models?pageSize=1000`, { 'x-goog-api-key': chave });
      return lista(corpo.models).map(comoObjeto)
        .filter((m) => lista(m?.supportedGenerationMethods).includes('generateContent'))
        .flatMap((m) => modelo(texto(m?.name)?.replace(/^models\//, ''), texto(m?.displayName)))
        .filter((m) => !GEMINI_FORA.test(m.id));
    }
    const corpo = await this.json(`${base}/models`, { Authorization: `Bearer ${chave}` });
    return lista(corpo.data).map(comoObjeto).flatMap((m) => modelo(texto(m?.id), null))
      .filter((m) => OPENAI_CONVERSA.test(m.id) && !OPENAI_FORA.test(m.id));
  }

  /** A chave vai só no cabeçalho de autenticação; a URL é fixa e não leva nada da pessoa. */
  private async json(url: string, cabecalhos: Record<string, string>): Promise<Record<string, unknown>> {
    const resposta = await this.buscar(url, { headers: { accept: 'application/json', ...cabecalhos }, signal: AbortSignal.timeout(TEMPO_MAXIMO_MS) });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return comoObjeto(await resposta.json()) ?? {};
  }
}

function modelo(id: string | null | undefined, nome: string | null): ModeloDaApi[] {
  return id && ID_VALIDO.test(id) ? [{ id, nome: nome ? cortar(nome.trim(), TAMANHO_NOME) || null : null }] : [];
}

/** Os do catálogo que a API tem (na ordem do catálogo), depois os outros da API, sem repetir. */
export function misturar(catalogo: readonly ModeloIA[], daApi: readonly ModeloDaApi[]): ModeloIA[] {
  const ids = new Set(daApi.map((m) => m.id));
  const conhecidos = catalogo.filter((m) => ids.has(m.id));
  const jaVistos = new Set(conhecidos.map((m) => m.id));
  const outros = daApi
    .filter((m) => !jaVistos.has(m.id) && jaVistos.add(m.id))
    .slice(0, MAXIMO_DE_MODELOS)
    .map((m): ModeloIA => ({ id: m.id, nome: m.nome ?? m.id, descricao: 'da API' }));
  return [...conhecidos.map((m) => ({ ...m })), ...outros];
}
