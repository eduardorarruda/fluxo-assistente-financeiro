import type { ApiAgenda } from './agenda-api';
import type { MapaDeEventos } from './cofre-google';
import type { EventoDesejado } from './eventos';

export interface ResultadoDaSincronia {
  criados: number;
  atualizados: number;
  apagados: number;
  iguais: number;
}

type Api = Pick<ApiAgenda, 'listarEventos' | 'inserirEvento' | 'atualizarEvento' | 'apagarEvento'>;

/**
 * Refaz o mapa a partir do que está no Google: só eventos marcados pelo
 * Fluxo. Chave repetida (sobra de uma sincronização interrompida) fica com o
 * primeiro e apaga o resto.
 */
export async function reconciliar(api: Api, agendaId: string): Promise<{ mapa: MapaDeEventos; apagados: number }> {
  const mapa: MapaDeEventos = {};
  let apagados = 0;
  for (const e of await api.listarEventos(agendaId)) {
    if (mapa[e.chave]) {
      await api.apagarEvento(agendaId, e.id);
      apagados++;
      continue;
    }
    mapa[e.chave] = { id: e.id, hash: e.hash ?? '' };
  }
  return { mapa, apagados };
}

/**
 * Deixa a agenda igual aos eventos desejados, mandando só a diferença:
 * novo → cria; hash diferente → substitui; sumiu daqui → apaga; igual → nada.
 * Uma chamada por vez. `salvar` recebe o mapa a cada mudança — se a rede cair
 * no meio, o que já foi feito não é refeito (nem duplicado) na próxima vez.
 */
export async function aplicarNaAgenda(
  api: Api,
  agendaId: string,
  desejados: readonly EventoDesejado[],
  mapaInicial: MapaDeEventos,
  salvar: (mapa: MapaDeEventos) => void,
): Promise<ResultadoDaSincronia> {
  let mapa: MapaDeEventos = { ...mapaInicial };
  const mudar = (novo: MapaDeEventos) => {
    mapa = novo;
    salvar(mapa);
  };
  const resultado: ResultadoDaSincronia = { criados: 0, atualizados: 0, apagados: 0, iguais: 0 };
  const queremos = new Set(desejados.map((d) => d.chave));

  for (const d of desejados) {
    const atual = mapa[d.chave];
    if (atual && atual.hash === d.hash) {
      resultado.iguais++;
      continue;
    }
    // O hash também vai no próprio evento: a reconciliação sabe o que já está lá sem baixar o conteúdo.
    const corpo = { ...d.corpo, extendedProperties: { private: { ...d.corpo.extendedProperties.private, fluxoHash: d.hash } } };
    if (atual && (await api.atualizarEvento(agendaId, atual.id, corpo))) {
      mudar({ ...mapa, [d.chave]: { id: atual.id, hash: d.hash } });
      resultado.atualizados++;
      continue;
    }
    const id = await api.inserirEvento(agendaId, corpo);
    mudar({ ...mapa, [d.chave]: { id, hash: d.hash } });
    resultado.criados++;
  }

  for (const [chave, { id }] of Object.entries(mapa)) {
    if (queremos.has(chave)) continue;
    await api.apagarEvento(agendaId, id);
    const { [chave]: _removido, ...resto } = mapa;
    mudar(resto);
    resultado.apagados++;
  }
  return resultado;
}
