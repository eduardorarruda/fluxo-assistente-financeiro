import { diaDoMes, diasNoMes, mesDe, somarMeses } from './datas';
import { valorDeGasto } from './movimentos';
import { chaveDeDescricao } from './texto';
import type { Centavos, Dia, Mes, Movimento } from './types';

export interface VariacaoCategoria {
  categoriaId: string;
  atual: Centavos;
  anterior: Centavos;
  media3: Centavos;
  delta: Centavos; // atual − média dos 3 meses anteriores
}

export interface Estabelecimento {
  nome: string;
  categoriaId: string | null;
  total: Centavos;
  vezes: number;
}

export interface Insights {
  mes: Mes;
  variacoes: VariacaoCategoria[];
  maioresGastos: Pick<Movimento, 'id' | 'data' | 'descricao' | 'valor' | 'categoriaId' | 'tipoConta'>[];
  estabelecimentos: Estabelecimento[];
  /** Gasto acumulado dia a dia no mês e no anterior, para a curva de ritmo. */
  ritmo: { dia: number; atual: Centavos | null; anterior: Centavos }[];
  porDiaDaSemana: Centavos[]; // domingo = 0
  quantidade: number;
  ticketMedio: Centavos;
  mediaDiaria: Centavos;
}

function gastosDoMes(movimentos: readonly Movimento[], mes: Mes): Movimento[] {
  return movimentos.filter((m) => m.competencia === mes && (m.natureza === 'DESPESA' || m.natureza === 'ESTORNO'));
}

function totalPorCategoria(ms: readonly Movimento[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const m of ms) if (m.categoriaId) mapa.set(m.categoriaId, (mapa.get(m.categoriaId) ?? 0) + valorDeGasto(m));
  return mapa;
}

/**
 * Leituras do mês que a gente não faz de cabeça: o que subiu em relação ao
 * normal, onde o dinheiro mais vai, se o mês está correndo mais rápido que o
 * anterior. "Normal" = média dos 3 meses anteriores.
 */
export function gerarInsights(movimentos: readonly Movimento[], mes: Mes, hoje: Dia): Insights {
  const atuais = gastosDoMes(movimentos, mes);
  const anteriores = gastosDoMes(movimentos, somarMeses(mes, -1));
  const tres = [1, 2, 3].map((n) => totalPorCategoria(gastosDoMes(movimentos, somarMeses(mes, -n))));

  const porCatAtual = totalPorCategoria(atuais);
  const porCatAnterior = tres[0]!;
  const categorias = new Set([...porCatAtual.keys(), ...tres.flatMap((m) => [...m.keys()])]);
  const variacoes = [...categorias]
    .map((categoriaId) => {
      const atual = porCatAtual.get(categoriaId) ?? 0;
      const media3 = Math.round(tres.reduce((s, m) => s + (m.get(categoriaId) ?? 0), 0) / 3);
      return { categoriaId, atual, anterior: porCatAnterior.get(categoriaId) ?? 0, media3, delta: atual - media3 };
    })
    .filter((v) => v.atual !== 0 || v.media3 !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const despesas = atuais.filter((m) => m.natureza === 'DESPESA');
  const maioresGastos = [...despesas]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6)
    .map(({ id, data, descricao, valor, categoriaId, tipoConta }) => ({ id, data, descricao, valor, categoriaId, tipoConta }));

  const lojas = new Map<string, Estabelecimento>();
  for (const m of despesas) {
    const chave = chaveDeDescricao(m.estabelecimento || m.descricao) || m.descricao;
    const atual = lojas.get(chave) ?? { nome: m.estabelecimento || m.descricao, categoriaId: m.categoriaId, total: 0, vezes: 0 };
    atual.total += m.valor;
    atual.vezes += 1;
    lojas.set(chave, atual);
  }
  const estabelecimentos = [...lojas.values()].sort((a, b) => b.total - a.total).slice(0, 8);

  const ultimoDia = diasNoMes(mes);
  const diaDeHoje = mesDe(hoje) === mes ? diaDoMes(hoje) : mesDe(hoje) > mes ? ultimoDia : 0;
  const acumular = (ms: readonly Movimento[], dias: number) => {
    const porDia = new Array<number>(dias + 1).fill(0);
    for (const m of ms) {
      // Parcelas deslocadas para este mês contam no dia 1.
      const dia = mesDe(m.data) === m.competencia ? diaDoMes(m.data) : 1;
      porDia[Math.min(dia, dias)]! += valorDeGasto(m);
    }
    for (let d = 1; d <= dias; d++) porDia[d]! += porDia[d - 1]!;
    return porDia;
  };
  const acumAtual = acumular(atuais, ultimoDia);
  const acumAnterior = acumular(anteriores, ultimoDia);
  const ritmo = Array.from({ length: ultimoDia }, (_, i) => ({
    dia: i + 1,
    atual: i + 1 <= diaDeHoje ? acumAtual[i + 1]! : null,
    anterior: acumAnterior[i + 1]!,
  }));

  const porDiaDaSemana = new Array<number>(7).fill(0);
  for (const m of despesas) {
    const [a, mm, d] = m.data.split('-').map(Number) as [number, number, number];
    porDiaDaSemana[new Date(a, mm - 1, d).getDay()]! += m.valor;
  }

  const total = despesas.reduce((s, m) => s + m.valor, 0);
  return {
    mes,
    variacoes,
    maioresGastos,
    estabelecimentos,
    ritmo,
    porDiaDaSemana,
    quantidade: despesas.length,
    ticketMedio: despesas.length ? Math.round(total / despesas.length) : 0,
    mediaDiaria: diaDeHoje ? Math.round(total / diaDeHoje) : 0,
  };
}
