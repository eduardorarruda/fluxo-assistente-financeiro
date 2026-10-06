import { diaDoMes, diaNoMes, diasEntre, mesDe, somarMeses } from './datas';
import { mediana } from './dinheiro';
import { chaveDeDescricao, normalizar } from './texto';
import type { Centavos, Dia, Movimento } from './types';

export interface Recorrencia {
  chave: string;
  nome: string;
  categoriaId: string | null;
  valorTipico: Centavos;
  ultimoValor: Centavos;
  ultimaData: Dia;
  proximaData: Dia;
  meses: number;
  custoAnual: Centavos;
  ativa: boolean;
  aumento: { de: Centavos; para: Centavos } | null;
}

const JANELA_MESES = 7;
const MINIMO_OCORRENCIAS = 3;
const TOLERANCIA_VALOR = 0.2;

/**
 * Estabelecimentos que só intermediam: pela Google (Play) passam Crunchyroll,
 * Google One, Paramount e YouTube; pela Apple, PayPal, Mercado Pago e Amazon,
 * lojas e assinaturas diferentes. Agrupar por eles mistura tudo — aí vale a descrição.
 */
const INTERMEDIARIOS = /^(google|apple|paypal|mercado ?(pago|livre)|mercadopago|ebanx|pagseguro|pagbank|dlocal|amazon)\b/;

/**
 * Prefixo de subadquirente antes do "*" ("Dm*Spotify", "Ebn *Hostinger",
 * "Pg *99 Ride", "Mp *Loja"): o nome de verdade vem depois. Lista dos que
 * aparecem nas faturas do Nubank; um "Loja *Pedido123" qualquer não entra,
 * porque ali o que vem depois do "*" é código que muda a cada cobrança.
 */
const PREFIXO_SUBADQUIRENTE = /^\s*(dm|dl|ebn|ebanx|pg|mp|ec|ifd|nuv|pdv|bmb|vmt|med|zig|valori|frogpay|pagprim|asaas|cappta|paypal|pag|mercado|mercadopago|mercadolivre|amazonmktplc)\s*\*\s*/i;

function intermediario(estabelecimento: string | null): boolean {
  return Boolean(estabelecimento) && INTERMEDIARIOS.test(normalizar(estabelecimento));
}

/** Quem cobra: o estabelecimento, a não ser que ele seja só o intermediário. */
function quemCobra(m: Movimento): string {
  if (m.estabelecimento && !intermediario(m.estabelecimento)) return m.estabelecimento;
  const semPrefixo = m.descricao.replace(PREFIXO_SUBADQUIRENTE, '');
  return chaveDeDescricao(semPrefixo).length >= 3 ? semPrefixo : m.descricao;
}

/**
 * Entra na detecção: gasto que não é parcela, até hoje. Pendente do cartão
 * conta — é compra da fatura aberta, cobrança real; pendente da conta
 * (agendamento) ainda pode não acontecer.
 */
function entraNaDeteccao(m: Movimento, inicio: string, hoje: Dia): boolean {
  if (m.natureza !== 'DESPESA' || m.parcela) return false;
  if (m.pendente && m.tipoConta !== 'CARTAO') return false;
  return mesDe(m.data) >= inicio && m.data <= hoje;
}

/**
 * Enquanto o banco não tira o pendente, a mesma compra pode estar duas vezes
 * (pendente e efetivada): o pendente com o mesmo valor no mesmo mês sai.
 */
function semPendenteRepetido(lista: readonly Movimento[]): Movimento[] {
  const efetivadas = new Set(lista.filter((m) => !m.pendente).map((m) => `${mesDe(m.data)}:${m.valor}`));
  return lista.filter((m) => !m.pendente || !efetivadas.has(`${mesDe(m.data)}:${m.valor}`));
}

/**
 * Acha o que se repete todo mês: assinaturas, contas, mensalidades. Parcelas
 * ficam de fora — compra parcelada não é recorrência, é dívida com fim.
 *
 * Critérios: aparece em pelo menos 3 meses distintos da janela, uma vez por
 * mês (em 3/4 dos meses), com intervalo típico de ~1 mês, e 3/4 das
 * cobranças perto do valor típico.
 */
export function detectarRecorrencias(movimentos: readonly Movimento[], hoje: Dia): Recorrencia[] {
  const inicio = somarMeses(mesDe(hoje), -JANELA_MESES);
  const grupos = new Map<string, Movimento[]>();
  for (const m of movimentos) {
    if (!entraNaDeteccao(m, inicio, hoje)) continue;
    const chave = chaveDeDescricao(quemCobra(m));
    if (chave.length < 3) continue;
    const lista = grupos.get(chave) ?? [];
    lista.push(m);
    grupos.set(chave, lista);
  }

  const resultado: Recorrencia[] = [];
  for (const [chave, lista] of grupos) {
    // Assinatura cobra uma vez por mês. Mercado e posto aparecem várias vezes:
    // se em mais de 1/4 dos meses houve mais de uma cobrança, não é recorrência.
    const porMes = new Map<string, Movimento[]>();
    for (const m of semPendenteRepetido(lista)) porMes.set(mesDe(m.data), [...(porMes.get(mesDe(m.data)) ?? []), m]);
    const mesesComVarias = [...porMes.values()].filter((ms) => ms.length > 1).length;
    if (mesesComVarias / porMes.size > 0.25) continue;
    // No mês com cobrança extra (avulsa), fica a maior.
    const ocorrencias = [...porMes.values()]
      .map((ms) => ms.reduce((a, b) => (b.valor > a.valor ? b : a)))
      .sort((a, b) => a.data.localeCompare(b.data));
    if (ocorrencias.length < MINIMO_OCORRENCIAS) continue;

    const intervalos = ocorrencias.slice(1).map((m, i) => diasEntre(ocorrencias[i]!.data, m.data));
    const intervaloTipico = mediana(intervalos);
    if (intervaloTipico < 20 || intervaloTipico > 40) continue;

    const valores = ocorrencias.map((m) => m.valor);
    const tipico = mediana(valores);
    const perto = valores.filter((v) => Math.abs(v - tipico) <= tipico * TOLERANCIA_VALOR).length;
    if (perto / valores.length < 0.75) continue;

    const ultima = ocorrencias[ocorrencias.length - 1]!;
    const aumentou = ultima.valor > tipico * 1.05;
    resultado.push({
      chave,
      nome: quemCobra(ultima) === ultima.estabelecimento ? ultima.estabelecimento : ultima.descricao,
      categoriaId: ultima.categoriaId,
      valorTipico: tipico,
      ultimoValor: ultima.valor,
      ultimaData: ultima.data,
      // Cobrança mensal volta no mesmo dia do mês seguinte (31 → último dia).
      proximaData: diaNoMes(somarMeses(mesDe(ultima.data), 1), diaDoMes(ultima.data)),
      meses: ocorrencias.length,
      custoAnual: tipico * 12,
      ativa: diasEntre(ultima.data, hoje) <= 45,
      aumento: aumentou ? { de: tipico, para: ultima.valor } : null,
    });
  }
  return resultado.sort((a, b) => Number(b.ativa) - Number(a.ativa) || b.valorTipico - a.valorTipico);
}
