import type { ModeloIA, ProvedorInfo } from '../../api/tipos-assistente';

/**
 * Os modelos que a tela oferece para um CLI. Um servidor de versão anterior
 * (ainda aberto depois de uma atualização) só manda `modelosSugeridos`: aí a
 * lista vira esses nomes, em vez de sumir ou quebrar a tela.
 */
export function catalogoDe(info: ProvedorInfo | undefined): readonly ModeloIA[] {
  if (!info) return [];
  if (Array.isArray(info.modelos) && info.modelos.length) return info.modelos;
  return (info.modelosSugeridos ?? []).map((id) => ({ id, nome: id, descricao: 'sugerido pelo Fluxo', principal: true }));
}

/** O catálogo fixo da API do provedor (o instantâneo, antes da lista ao vivo da conta chegar). */
export function catalogoApiDe(info: ProvedorInfo | undefined): readonly ModeloIA[] {
  return Array.isArray(info?.api?.modelos) ? info.api.modelos : [];
}

/** Modelos no formato das sugestões do campo de texto. */
export function sugestoesDe(modelos: readonly ModeloIA[]) {
  return modelos.map((m) => ({ valor: m.id, rotulo: m.nome, descricao: `${m.id} · ${m.descricao}` }));
}

export const sugestoesDeModelo = (info: ProvedorInfo | undefined) => sugestoesDe(catalogoDe(info));

/** O modelo que a API usa quando a conta não escolhe nenhum: o primeiro principal do catálogo (a regra do servidor). */
export function padraoDaApi(modelos: readonly ModeloIA[]): ModeloIA | undefined {
  return modelos.find((m) => m.principal) ?? modelos[0];
}

/** Texto do campo vazio de modelo numa conta de API: "Padrão: Sonnet 4.5". */
export const textoPadraoDaApi = (modelos: readonly ModeloIA[]) => {
  const padrao = padraoDaApi(modelos);
  return padrao ? `Padrão: ${padrao.nome}` : 'O padrão do Fluxo';
};
