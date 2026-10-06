import { creditoNoCartao } from './classificacao';
import { cicloDoCartao, faturaDeUmaCompraEm, mesDaFatura } from './competencia';
import { diaDoMes, diaNoMes, hoje as hojeDe, mesDe, somarDias, somarMeses } from './datas';
import { chavesDasCompras } from './movimentos';
import type { Centavos, Conta, Dia, Fatura, Mes, Movimento } from './types';

export type SituacaoFatura = 'PAGA' | 'FECHADA' | 'ABERTA' | 'FUTURA';

/**
 * Como uma fatura fechada deixou de estar a pagar: paga de fato, coberta por
 * um parcelamento da fatura, ou com o saldo levado para a fatura seguinte
 * (no Nubank o que não se paga rola — e quem cobra é a seguinte).
 */
export type Quitacao = 'PAGAMENTO' | 'PARCELAMENTO' | 'PROXIMA_FATURA';

export interface FaturaMes {
  contaId: string;
  mes: Mes;
  vencimento: Dia;
  total: Centavos; // o que o banco informou para faturas fechadas; senão a soma dos itens
  somaItens: Centavos;
  pago: Centavos;
  quantidade: number;
  situacao: SituacaoFatura;
  quitacao: Quitacao | null; // só nas PAGA
  porCategoria: { categoriaId: string; valor: Centavos }[];
}

export interface Parcelamento {
  chave: string;
  descricao: string;
  categoriaId: string | null;
  valorParcela: Centavos;
  parcelaAtual: number;
  totalParcelas: number;
  restante: Centavos; // parcelas que ainda vão cair em fatura
  valorTotal: Centavos;
  ultimaFatura: Mes;
}

export interface VisaoCartao {
  contaId: string;
  nome: string;
  limite: Centavos | null;
  disponivel: Centavos | null;
  usado: Centavos | null;
  faturaAtual: Mes;
  faturas: FaturaMes[];
  parcelamentos: Parcelamento[];
  compromissoFuturo: Centavos;
}

/** Dias depois do vencimento em que um pagamento (ou parcelamento) ainda é daquela fatura. */
const FOLGA_APOS_VENCIMENTO = 10;

/**
 * A fatura é o que o cartão cobra, não o que conta como gasto: Pix no crédito
 * e parcela do parcelamento da fatura não são despesa, mas são cobrados.
 * Pagamento e "crédito de parcelamento" (que só zera o saldo antigo) não entram.
 * Nunca pela natureza do movimento: o usuário pode mudá-la ou "ignorar" um
 * estorno, e isso não muda o que o banco cobra.
 */
function valorNaFatura(m: Movimento): number {
  if (m.sentido === 'SAIDA') return m.valor;
  return creditoNoCartao(m) === 'ESTORNO' ? -m.valor : 0;
}

/** O mesmo critério de `visaoDoCartao`, para quem lista os lançamentos de uma fatura. */
export function entraNaFatura(m: Movimento): boolean {
  return valorNaFatura(m) !== 0;
}

function ehCreditoDeParcelamento(m: Movimento): boolean {
  return m.sentido === 'ENTRADA' && creditoNoCartao(m) === 'TRANSFERENCIA';
}

/**
 * Tudo sobre um cartão: faturas passadas, a aberta e as futuras (formadas
 * pelas parcelas que ainda vão cair), e os parcelamentos em andamento.
 */
export function visaoDoCartao(
  cartao: Conta,
  movimentos: readonly Movimento[],
  faturasDoBanco: readonly Fatura[],
  hoje: Dia = hojeDe(),
): VisaoCartao {
  const doCartao = movimentos.filter((m) => m.contaId === cartao.id);
  const ciclo = { ...cartao, ...cicloDoCartao(cartao, faturasDoBanco) };
  const faturasPorId = new Map(faturasDoBanco.map((f) => [f.id, f]));
  const faturaPorMes = new Map(faturasDoBanco.map((f) => [mesDe(f.vencimento), f]));
  // Fatura "atual" = a que recebe uma compra feita hoje.
  const faturaAtual = faturaDeUmaCompraEm(hoje, ciclo);
  const venceNoDia = ciclo.vencimento ? diaDoMes(ciclo.vencimento) : 15;

  const porMes = new Map<Mes, Movimento[]>();
  for (const m of doCartao) {
    if (!entraNaFatura(m)) continue;
    const mes = mesDaFatura(m, ciclo, faturasPorId);
    porMes.set(mes, [...(porMes.get(mes) ?? []), m]);
  }
  for (const f of faturasDoBanco) if (!porMes.has(mesDe(f.vencimento))) porMes.set(mesDe(f.vencimento), []);
  const meses = [...porMes.keys()].sort();
  // Só a fatura fechada mais recente pode estar a pagar: o saldo das anteriores já rolou para ela.
  const ultimaFechada = meses.filter((m) => m < faturaAtual).at(-1);

  const faturas: FaturaMes[] = meses.map((mes) => {
    const itens = porMes.get(mes)!;
    const banco = faturaPorMes.get(mes);
    const vencimento = banco?.vencimento ?? diaNoMes(mes, venceNoDia);
    const somaItens = itens.reduce((s, m) => s + valorNaFatura(m), 0);
    const categorias = new Map<string, number>();
    for (const m of itens) {
      const id = m.categoriaId ?? 'outros';
      categorias.set(id, (categorias.get(id) ?? 0) + valorNaFatura(m));
    }
    const total = banco && mes < faturaAtual ? banco.total : somaItens;
    const janela = { inicio: banco?.fechamento ?? somarDias(vencimento, -10), fim: somarDias(vencimento, FOLGA_APOS_VENCIMENTO) };
    // O pago do banco vem da lista de pagamentos da própria fatura; os "pagamentos recebidos" do
    // cartão vêm ligados à fatura seguinte, então só servem (pela data) quando o banco não diz nada.
    const pago = banco && banco.pago > 0 ? banco.pago : somaNaJanela(doCartao, janela, ehPagamento);
    const quitacao =
      mes >= faturaAtual ? null
      : total <= 0 || pago >= total ? 'PAGAMENTO'
      : pago + somaNaJanela(doCartao, janela, ehCreditoDeParcelamento) >= total ? 'PARCELAMENTO'
      // Rolou para a seguinte: só dá para afirmar com a seguinte vinda do banco (o total dela traz o saldo).
      : mes !== ultimaFechada && faturaPorMes.has(somarMeses(mes, 1)) ? 'PROXIMA_FATURA'
      : null;
    const situacao: SituacaoFatura =
      mes > faturaAtual ? 'FUTURA' : mes === faturaAtual ? 'ABERTA' : quitacao ? 'PAGA' : 'FECHADA';
    return {
      contaId: cartao.id,
      mes,
      vencimento,
      total,
      somaItens,
      pago,
      quantidade: itens.length,
      situacao,
      quitacao,
      porCategoria: [...categorias.entries()]
        .map(([categoriaId, valor]) => ({ categoriaId, valor }))
        .filter((c) => c.valor > 0)
        .sort((a, b) => b.valor - a.valor),
    };
  });

  const parcelamentos = montarParcelamentos(doCartao, ciclo, faturasPorId, faturaAtual);

  return {
    contaId: cartao.id,
    nome: cartao.nome,
    limite: cartao.limite,
    disponivel: cartao.limiteDisponivel,
    usado: cartao.limite !== null && cartao.limiteDisponivel !== null ? cartao.limite - cartao.limiteDisponivel : null,
    faturaAtual,
    faturas,
    parcelamentos,
    compromissoFuturo: faturas.filter((f) => f.situacao === 'FUTURA').reduce((s, f) => s + f.total, 0),
  };
}

// Pelo que o banco escreveu, como o total da fatura: a natureza editada não paga fatura.
function ehPagamento(m: Movimento): boolean {
  return m.sentido === 'ENTRADA' && creditoNoCartao(m) === 'PAGAMENTO_FATURA';
}

/**
 * Soma o que entrou no cartão entre o fechamento e alguns dias depois do
 * vencimento de uma fatura. Nunca pelo id da fatura: o Nubank liga o
 * pagamento à fatura seguinte.
 */
function somaNaJanela(doCartao: readonly Movimento[], janela: { inicio: Dia; fim: Dia }, filtro: (m: Movimento) => boolean): Centavos {
  return doCartao
    .filter((m) => filtro(m) && m.data >= janela.inicio && m.data <= janela.fim)
    .reduce((s, m) => s + m.valor, 0);
}

/** Uma parcela por número; se vier repetida (pendente e lançada), fica a lançada. */
function umaPorNumero(parcelas: readonly Movimento[]): Movimento[] {
  const porNumero = new Map<number, Movimento>();
  for (const m of parcelas) {
    const atual = porNumero.get(m.parcela!.numero);
    if (!atual || (atual.pendente && !m.pendente)) porNumero.set(m.parcela!.numero, m);
  }
  return [...porNumero.values()].sort((a, b) => a.parcela!.numero - b.parcela!.numero);
}

const SUFIXO_PARCELA = /\s*\d{1,2}\/\d{1,2}$/;

function montarParcelamentos(
  doCartao: readonly Movimento[],
  ciclo: Pick<Conta, 'fechamento' | 'vencimento'>,
  faturasPorId: ReadonlyMap<string, Fatura>,
  faturaAtual: Mes,
): Parcelamento[] {
  const grupos = new Map<string, Movimento[]>();
  // Pelo que o cartão cobra (não pela natureza): Pix parcelado no crédito também compromete as faturas.
  const parceladas = doCartao.filter((m) => valorNaFatura(m) > 0 && m.parcela && m.parcela.total > 1);
  const chaves = chavesDasCompras(parceladas);
  for (const m of parceladas) {
    const chave = chaves.get(m.id)!;
    grupos.set(chave, [...(grupos.get(chave) ?? []), m]);
  }

  const resultado: Parcelamento[] = [];
  for (const [chave, grupo] of grupos) {
    const ordenadas = umaPorNumero(grupo);
    const exemplo = ordenadas.at(-1)!;
    const total = exemplo.parcela!.total;
    const meses = ordenadas.map((m) => ({ numero: m.parcela!.numero, valor: m.valor, mes: mesDaFatura(m, ciclo, faturasPorId) }));
    // Parcela "atual" = a da fatura aberta; se já passou, a última conhecida.
    const atual = meses.filter((p) => p.mes <= faturaAtual).at(-1)?.numero ?? 0;
    const valorParcela = exemplo.valor;
    // Parcelas futuras conhecidas (pelo valor de cada uma) + as que o banco ainda não mandou.
    const futuras = meses.filter((p) => p.mes > faturaAtual);
    const naoInformadas = Math.max(0, total - exemplo.parcela!.numero);
    if (futuras.length + naoInformadas === 0 && meses.at(-1)!.mes < faturaAtual) continue; // já terminou
    const ultimaConhecida = meses.at(-1)!;
    resultado.push({
      chave,
      descricao: exemplo.descricao.replace(SUFIXO_PARCELA, '') || exemplo.descricao,
      categoriaId: exemplo.categoriaId,
      valorParcela,
      parcelaAtual: atual,
      totalParcelas: total,
      restante: futuras.reduce((s, p) => s + p.valor, 0) + naoInformadas * valorParcela,
      valorTotal: exemplo.parcela!.valorTotal ?? meses.reduce((s, p) => s + p.valor, 0) + (total - meses.length) * valorParcela,
      ultimaFatura: somarMeses(ultimaConhecida.mes, total - ultimaConhecida.numero),
    });
  }
  return resultado.sort((a, b) => b.restante - a.restante);
}
