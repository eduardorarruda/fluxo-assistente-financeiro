import { diaNoMes, diasNoMes } from './datas';
import type { Centavos, Dia, Mes, Transacao } from './types';

/**
 * Saldo da conta no fim de cada mês, andando para trás a partir do saldo de
 * hoje: saldo(fim de M) = saldo atual − tudo que entrou/saiu depois de M.
 * Funciona para qualquer banco, mesmo sem histórico salvo, desde que as
 * transações do período tenham chegado.
 */
export function saldoNoFimDosMeses(
  saldoAtual: Centavos,
  transacoesDaConta: readonly Pick<Transacao, 'data' | 'valor' | 'sentido' | 'pendente'>[],
  meses: readonly Mes[],
  hoje: Dia,
): { mes: Mes; valor: Centavos }[] {
  const efetivas = transacoesDaConta.filter((t) => !t.pendente && t.data <= hoje);
  return meses.map((mes) => {
    const fim = diaNoMes(mes, diasNoMes(mes));
    if (fim >= hoje) return { mes, valor: saldoAtual };
    let depois = 0;
    for (const t of efetivas) if (t.data > fim) depois += t.sentido === 'ENTRADA' ? t.valor : -t.valor;
    return { mes, valor: saldoAtual - depois };
  });
}

/**
 * Valor de uma série de fotos (histórico) no fim de cada mês: vale a última
 * foto tirada até lá. Antes da primeira foto, o valor é desconhecido (null).
 */
export function ultimoValorAte(
  pontos: readonly { dia: Dia; valor: Centavos }[],
  meses: readonly Mes[],
): { mes: Mes; valor: Centavos | null }[] {
  const ordenados = [...pontos].sort((a, b) => a.dia.localeCompare(b.dia));
  return meses.map((mes) => {
    const fim = diaNoMes(mes, diasNoMes(mes));
    let valor: Centavos | null = null;
    for (const p of ordenados) {
      if (p.dia > fim) break;
      valor = p.valor;
    }
    return { mes, valor };
  });
}

type Movimentacao = Pick<Transacao, 'data' | 'valor' | 'sentido' | 'pendente'>;

/**
 * Valor das caixinhas de UMA conta no fim de cada mês. Onde todas têm foto no
 * histórico, vale a soma das fotos. Onde falta foto (o histórico só começa na
 * primeira sincronização), o valor é refeito de trás para frente, do mesmo
 * jeito que o saldo da conta: valor atual − (aplicado − resgatado) depois do
 * fim do mês. `movimentacoes` são as de natureza INVESTIMENTO da conta, do
 * ponto de vista dela: SAIDA = aplicou, ENTRADA = resgatou.
 *
 * Margem de erro: o rendimento ganho depois do mês não sai da conta, então
 * fica somado nos meses antigos (poucas centenas de reais num ano). E a
 * aplicação num investimento que não é caixinha, pela mesma conta, seria
 * atribuída às caixinhas. Nunca devolve negativo.
 */
export function caixinhasNoFimDosMeses(
  caixinhas: readonly { valorAtual: Centavos; fotos: readonly { dia: Dia; valor: Centavos }[] }[],
  movimentacoes: readonly Movimentacao[],
  meses: readonly Mes[],
  hoje: Dia,
): { mes: Mes; valor: Centavos }[] {
  const porFoto = caixinhas.map((c) => ultimoValorAte(c.fotos, meses));
  const valorAtual = caixinhas.reduce((s, c) => s + c.valorAtual, 0);
  // Aplicar tira da conta e põe na caixinha: é o saldo da conta com o sinal trocado.
  const invertidas = movimentacoes.map((m) => ({ ...m, sentido: m.sentido === 'SAIDA' ? 'ENTRADA' as const : 'SAIDA' as const }));
  const refeito = saldoNoFimDosMeses(valorAtual, invertidas, meses, hoje);
  return meses.map((mes, i) => {
    const fotos = porFoto.map((serie) => serie[i]!.valor);
    if (fotos.length > 0 && fotos.every((v) => v !== null)) return { mes, valor: fotos.reduce((s: number, v) => s + v!, 0) };
    return { mes, valor: Math.max(0, refeito[i]!.valor) };
  });
}
