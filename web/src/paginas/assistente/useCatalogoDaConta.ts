import { useModelosDaConta } from '../../api/assistente';
import type { ContaIA, ModeloIA, ProvedorInfo } from '../../api/tipos-assistente';
import { catalogoApiDe, catalogoDe } from './catalogo';
import { ehApi } from './regras-contas';

export interface CatalogoDaConta {
  modelos: readonly ModeloIA[];
  /** A lista veio agora do provedor (e não do catálogo fixo do Fluxo). */
  aoVivo: boolean;
  carregando: boolean;
}

/**
 * Os modelos que uma conta oferece. CLI: o catálogo do CLI. API: a lista ao vivo
 * do provedor, com o catálogo fixo da API no lugar enquanto ela carrega, se falhar
 * ou se a conta ainda não tem chave (aí nem pergunta ao servidor).
 */
export function useCatalogoDaConta(conta: ContaIA | undefined, info: ProvedorInfo | undefined): CatalogoDaConta {
  const api = ehApi(conta);
  const vivo = useModelosDaConta(conta?.id, api && Boolean(conta?.instalado));
  if (!api) return { modelos: catalogoDe(info), aoVivo: false, carregando: false };
  const chegou = vivo.data?.modelos;
  if (Array.isArray(chegou) && chegou.length) return { modelos: chegou, aoVivo: Boolean(vivo.data?.aoVivo), carregando: vivo.isFetching };
  return { modelos: catalogoApiDe(info), aoVivo: false, carregando: vivo.isFetching };
}
