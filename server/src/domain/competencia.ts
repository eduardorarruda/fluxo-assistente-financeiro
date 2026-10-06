import { diaDoMes, diferencaEmMeses, mesDe, somarMeses } from './datas';
import type { Conta, Dia, Mes, Transacao } from './types';

/**
 * Quantos meses deslocar uma parcela. A parcela k pertence ao mês da compra
 * + (k-1). Se o provedor já datou a parcela alguns meses adiante, desconta-se
 * o que ele já andou — assim tanto "todas com a data da compra" quanto "cada
 * uma no seu mês" dão o mesmo resultado, e um dia de diferença por fuso
 * horário entre as duas datas não muda nada.
 */
function deslocamentoDaParcela(t: Transacao): number {
  const p = t.parcela;
  if (!p || p.numero <= 1 || !p.dataCompra) return 0;
  return Math.max(0, p.numero - 1 - diferencaEmMeses(mesDe(p.dataCompra), mesDe(t.data)));
}

/** Mês a que o gasto/ganho pertence (o "quando eu gastei"). */
export function competencia(t: Transacao): Mes {
  return somarMeses(mesDe(t.data), deslocamentoDaParcela(t));
}

/** Ciclo padrão quando nem a conta nem as faturas dizem nada: fecha dia 8, vence dia 15. */
const FECHAMENTO_PADRAO = 8;
const VENCIMENTO_PADRAO = 15;

/**
 * Mês de vencimento da fatura em que uma compra do cartão é cobrada (o
 * "quando o dinheiro sai"). Prefere o que o provedor sabe; só calcula pelo
 * ciclo do cartão quando ele não diz.
 */
export function mesDaFatura(
  t: Transacao,
  cartao: Pick<Conta, 'fechamento' | 'vencimento'>,
  faturas: ReadonlyMap<string, DatasDaFatura>,
): Mes {
  const fatura = t.faturaId ? faturas.get(t.faturaId) : undefined;
  if (fatura) return mesDe(fatura.vencimento);
  if (t.faturaPrevista) return t.faturaPrevista;

  return somarMeses(faturaDeUmaCompraEm(t.data, cicloDoCartao(cartao, faturas.values())), deslocamentoDaParcela(t));
}

type DatasDaFatura = { vencimento: Dia; fechamento?: Dia | null };

/**
 * Fechamento e vencimento que valem para o ciclo do cartão. A Pluggy pode
 * mandar a conta sem fechamento e com o vencimento de uma fatura já passada;
 * aí a fatura mais recente do banco sabe mais. Vale o mais novo dos dois.
 */
export function cicloDoCartao(
  cartao: Pick<Conta, 'fechamento' | 'vencimento'>,
  faturas: Iterable<DatasDaFatura>,
): Pick<Conta, 'fechamento' | 'vencimento'> {
  let ultima: DatasDaFatura | null = null;
  for (const f of faturas) if (f.fechamento && (!ultima || f.fechamento > ultima.fechamento!)) ultima = f;
  if (!ultima || (cartao.fechamento && cartao.fechamento >= ultima.fechamento!)) return { fechamento: cartao.fechamento, vencimento: cartao.vencimento };
  const vencimento = cartao.vencimento && cartao.vencimento >= ultima.vencimento ? cartao.vencimento : ultima.vencimento;
  return { fechamento: ultima.fechamento!, vencimento };
}

/** Mês de vencimento da fatura que recebe uma compra feita em `dia`, pelo ciclo do cartão. */
export function faturaDeUmaCompraEm(dia: Dia, cartao: Pick<Conta, 'fechamento' | 'vencimento'>): Mes {
  const fechaNoDia = cartao.fechamento ? diaDoMes(cartao.fechamento) : FECHAMENTO_PADRAO;
  const venceNoDia = cartao.vencimento ? diaDoMes(cartao.vencimento) : VENCIMENTO_PADRAO;
  const mesFechamento = diaDoMes(dia) < fechaNoDia ? mesDe(dia) : somarMeses(mesDe(dia), 1);
  return venceNoDia > fechaNoDia ? mesFechamento : somarMeses(mesFechamento, 1);
}
