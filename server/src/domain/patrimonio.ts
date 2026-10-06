import { normalizar } from './texto';
import type { Caixinha, Centavos, Conta, Investimento } from './types';

export interface Patrimonio {
  contas: Centavos;
  caixinhas: Centavos;
  investimentos: Centavos;
  faturaAberta: Centavos;
  total: Centavos;
  /** Investimentos que são a mesma coisa que uma caixinha e por isso não somaram. */
  duplicados: string[];
}

export interface OpcoesPatrimonio {
  /** Quando o banco já inclui as caixinhas no saldo da conta, elas não somam de novo. */
  caixinhasNoSaldo: boolean;
}

/**
 * O Open Finance pode trazer a mesma caixinha duas vezes: como saldo
 * reservado da conta e como investimento (RDB). Casa pelo nome para não
 * contar dinheiro que não existe.
 */
function ehCaixinha(inv: Investimento, nomesCaixinhas: ReadonlySet<string>): boolean {
  const nome = normalizar(inv.nome);
  return nomesCaixinhas.has(nome) || (nomesCaixinhas.size > 0 && nome.includes('caixinha'));
}

export function calcularPatrimonio(
  contas: readonly Conta[],
  caixinhas: readonly Caixinha[],
  investimentos: readonly Investimento[],
  opcoes: OpcoesPatrimonio,
): Patrimonio {
  const contasBancarias = contas.filter((c) => c.tipo !== 'CARTAO').reduce((s, c) => s + c.saldo, 0);
  const faturaAberta = contas.filter((c) => c.tipo === 'CARTAO').reduce((s, c) => s + Math.max(0, c.saldo), 0);
  const totalCaixinhas = caixinhas.reduce((s, c) => s + c.valor, 0);

  const nomes = new Set(caixinhas.map((c) => normalizar(c.nome)));
  const duplicados: string[] = [];
  let totalInvestimentos = 0;
  for (const inv of investimentos) {
    if (ehCaixinha(inv, nomes)) duplicados.push(inv.id);
    else totalInvestimentos += inv.saldo;
  }

  const somaCaixinhas = opcoes.caixinhasNoSaldo ? 0 : totalCaixinhas;
  return {
    contas: contasBancarias,
    caixinhas: totalCaixinhas,
    investimentos: totalInvestimentos,
    faturaAberta,
    total: contasBancarias + somaCaixinhas + totalInvestimentos - faturaAberta,
    duplicados,
  };
}
