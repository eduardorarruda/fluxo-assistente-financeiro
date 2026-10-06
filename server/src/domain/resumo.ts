import { valorDeGasto } from './movimentos';
import type { Centavos, Mes, Movimento } from './types';

export interface TotalCategoria {
  categoriaId: string;
  valor: Centavos;
  quantidade: number;
}

export interface ResumoMes {
  mes: Mes;
  receitas: Centavos;
  despesas: Centavos;
  guardado: Centavos; // aplicado − resgatado nas caixinhas/investimentos
  resultado: Centavos; // receitas − despesas
  porCategoria: TotalCategoria[];
  receitasPorCategoria: TotalCategoria[];
}

function agrupar(movimentos: readonly Movimento[], valor: (m: Movimento) => number): TotalCategoria[] {
  const mapa = new Map<string, TotalCategoria>();
  for (const m of movimentos) {
    if (!m.categoriaId) continue;
    const atual = mapa.get(m.categoriaId) ?? { categoriaId: m.categoriaId, valor: 0, quantidade: 0 };
    atual.valor += valor(m);
    atual.quantidade += 1;
    mapa.set(m.categoriaId, atual);
  }
  return [...mapa.values()].filter((c) => c.valor !== 0).sort((a, b) => b.valor - a.valor);
}

/**
 * O mês pelo olhar da competência: quanto entrou de fora, quanto foi gasto
 * (cartão incluso, no mês da compra), e quanto foi guardado.
 */
export function resumoDoMes(todos: readonly Movimento[], mes: Mes): ResumoMes {
  const doMes = todos.filter((m) => m.competencia === mes);
  const gastos = doMes.filter((m) => m.natureza === 'DESPESA' || m.natureza === 'ESTORNO');
  const receitas = doMes.filter((m) => m.natureza === 'RECEITA');

  let guardado = 0;
  for (const m of doMes) {
    if (m.natureza !== 'INVESTIMENTO' || m.tipoConta === 'CARTAO') continue;
    guardado += m.sentido === 'SAIDA' ? m.valor : -m.valor;
  }

  const totalReceitas = receitas.reduce((s, m) => s + m.valor, 0);
  const totalDespesas = gastos.reduce((s, m) => s + valorDeGasto(m), 0);

  return {
    mes,
    receitas: totalReceitas,
    despesas: totalDespesas,
    guardado,
    resultado: totalReceitas - totalDespesas,
    porCategoria: agrupar(gastos, valorDeGasto),
    receitasPorCategoria: agrupar(receitas, (m) => m.valor),
  };
}

export interface FluxoCaixa {
  mes: Mes;
  entradas: { receitas: Centavos; resgates: Centavos; transferencias: Centavos; estornos: Centavos };
  saidas: { despesas: Centavos; faturas: Centavos; guardado: Centavos; transferencias: Centavos };
  variacao: Centavos;
}

/**
 * O mês pelo olhar do caixa: só a conta corrente/poupança, pela data em que o
 * dinheiro se moveu. É aqui que a fatura do cartão aparece — como uma saída só.
 */
export function fluxoDeCaixa(todos: readonly Movimento[], mes: Mes): FluxoCaixa {
  const f: FluxoCaixa = {
    mes,
    entradas: { receitas: 0, resgates: 0, transferencias: 0, estornos: 0 },
    saidas: { despesas: 0, faturas: 0, guardado: 0, transferencias: 0 },
    variacao: 0,
  };
  for (const m of todos) {
    if (m.tipoConta === 'CARTAO' || m.data.slice(0, 7) !== mes) continue;
    const entra = m.sentido === 'ENTRADA';
    switch (m.natureza) {
      case 'RECEITA':
        f.entradas.receitas += m.valor;
        break;
      case 'ESTORNO':
        f.entradas.estornos += m.valor;
        break;
      case 'DESPESA':
        f.saidas.despesas += m.valor;
        break;
      case 'PAGAMENTO_FATURA':
        if (entra) f.entradas.transferencias += m.valor;
        else f.saidas.faturas += m.valor;
        break;
      case 'INVESTIMENTO':
        if (entra) f.entradas.resgates += m.valor;
        else f.saidas.guardado += m.valor;
        break;
      case 'TRANSFERENCIA':
        if (entra) f.entradas.transferencias += m.valor;
        else f.saidas.transferencias += m.valor;
        break;
    }
  }
  const entrou = Object.values(f.entradas).reduce((a, b) => a + b, 0);
  const saiu = Object.values(f.saidas).reduce((a, b) => a + b, 0);
  f.variacao = entrou - saiu;
  return f;
}
