import type { Account, CreditCardBills, Investment, Transaction } from 'pluggy-sdk';
import { paraCentavos } from '../domain/dinheiro';
import type { Caixinha, Centavos, Conta, Dia, Fatura, Investimento, Sentido, TipoConta, Transacao } from '../domain/types';
import { normalizar } from '../domain/texto';

/**
 * Data que vem do provedor. Datas "de calendário" chegam como meia-noite UTC —
 * convertê-las para o fuso local jogaria tudo para o dia anterior no Brasil.
 * Instantes de verdade (com hora) viram o dia local.
 */
export function diaDoProvedor(valor: Date | string | null | undefined): Dia | null {
  if (valor === null || valor === undefined) return null;
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(data.getTime())) return null;
  const meiaNoiteUtc =
    data.getUTCHours() === 0 && data.getUTCMinutes() === 0 && data.getUTCSeconds() === 0 && data.getUTCMilliseconds() === 0;
  const [a, m, d] = meiaNoiteUtc
    ? [data.getUTCFullYear(), data.getUTCMonth() + 1, data.getUTCDate()]
    : [data.getFullYear(), data.getMonth() + 1, data.getDate()];
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Instante com hora, como veio (ISO). Serve de identidade, não de data: não passa pelo fuso. */
function instanteDoProvedor(valor: Date | string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function tipoDaConta(a: Pick<Account, 'type' | 'subtype'>): TipoConta {
  if (a.type === 'CREDIT' || a.subtype === 'CREDIT_CARD') return 'CARTAO';
  if (a.subtype === 'SAVINGS_ACCOUNT') return 'POUPANCA';
  return 'CONTA';
}

export function normalizarConta(a: Account, conexaoId: string, instituicao: string): Conta {
  const tipo = tipoDaConta(a);
  const credito = tipo === 'CARTAO' ? a.creditData : null;
  return {
    id: a.id,
    conexaoId,
    tipo,
    nome: a.marketingName || a.name,
    numero: a.number || null,
    instituicao,
    saldo: paraCentavos(a.balance),
    titular: a.owner,
    documentoTitular: a.taxNumber,
    limite: credito?.creditLimit != null ? paraCentavos(credito.creditLimit) : null,
    limiteDisponivel: credito?.availableCreditLimit != null ? paraCentavos(credito.availableCreditLimit) : null,
    fechamento: diaDoProvedor(credito?.balanceCloseDate),
    vencimento: diaDoProvedor(credito?.balanceDueDate),
  };
}

/** Caixinhas do Nubank chegam pelo Open Finance como "saldo reservado" da conta. */
export function normalizarCaixinhas(a: Account): Caixinha[] {
  const reservas = a.bankData?.hasReservedBalance === false ? [] : (a.bankData?.reservedBalances ?? []);
  return reservas.map((r, i) => {
    const remuneracao = r.availableAmounts.find((x) => x.remuneration)?.remuneration ?? null;
    // Sem identificação, o nome é mais estável que a posição na lista: se a
    // ordem mudar, uma meta ligada à caixinha não pula para outra.
    const chave = r.identification || normalizar(r.name).replace(/[^a-z0-9]+/g, '-') || String(i);
    return {
      id: `${a.id}:${chave}`,
      contaId: a.id,
      nome: r.name?.trim() || 'Caixinha',
      valor: r.availableAmounts.reduce((s, x) => s + paraCentavos(x.amount), 0),
      indexador: remuneracao?.indexer ?? null,
      percentualIndexador: remuneracao?.postFixedIndexerPercentage ?? null,
    };
  });
}

/**
 * Sentido pelo `type` (DEBIT sai, CREDIT entra). Se faltar, cai no sinal,
 * que tem convenção diferente por tipo de conta: no cartão positivo é
 * cobrança (sai); na conta negativo é saída.
 */
function sentidoDa(t: Transaction, tipoConta: TipoConta): Sentido {
  if (t.type === 'CREDIT') return 'ENTRADA';
  if (t.type === 'DEBIT') return 'SAIDA';
  if (tipoConta === 'CARTAO') return t.amount >= 0 ? 'SAIDA' : 'ENTRADA';
  return t.amount < 0 ? 'SAIDA' : 'ENTRADA';
}

export function normalizarTransacao(t: Transaction, tipoConta: TipoConta): Transacao {
  const sentido = sentidoDa(t, tipoConta);
  const contraparte = sentido === 'SAIDA' ? t.paymentData?.receiver : t.paymentData?.payer;
  const cartao = t.creditCardMetadata;
  const valor = Math.abs(t.amountInAccountCurrency ?? t.amount);
  return {
    id: t.id,
    contaId: t.accountId,
    tipoConta,
    data: diaDoProvedor(t.date)!,
    descricao: t.description?.trim() || t.descriptionRaw?.trim() || 'Sem descrição',
    descricaoOriginal: t.descriptionRaw ?? null,
    valor: paraCentavos(valor),
    sentido,
    pendente: t.status === 'PENDING',
    categoriaProvedor: t.category,
    categoriaProvedorId: t.categoryId,
    estabelecimento: t.merchant?.name || t.merchant?.businessName || null,
    cnpjEstabelecimento: t.merchant?.cnpj || null,
    contraparteNome: contraparte?.name ?? null,
    contraparteDocumento: contraparte?.documentNumber?.value ?? null,
    meioPagamento: t.paymentData?.paymentMethod ?? null,
    parcela:
      cartao?.installmentNumber && cartao.totalInstallments
        ? {
            numero: cartao.installmentNumber,
            total: cartao.totalInstallments,
            valorTotal: cartao.totalAmount != null ? paraCentavos(cartao.totalAmount) : null,
            dataCompra: diaDoProvedor(cartao.purchaseDate),
            instanteCompra: instanteDoProvedor(cartao.purchaseDate),
          }
        : null,
    faturaId: cartao?.billId ?? null,
    faturaPrevista: cartao?.billForecastDate ?? null,
    outroCredito: cartao?.otherCreditsType ?? null,
  };
}

const CATEGORIA_PAGAMENTO_DE_FATURA = '05100000';

function ehPagamentoDeFatura(t: Transacao): boolean {
  return (
    t.tipoConta === 'CARTAO' &&
    t.sentido === 'ENTRADA' &&
    (normalizar(t.descricao).startsWith('pagamento recebido') || t.categoriaProvedorId === CATEGORIA_PAGAMENTO_DE_FATURA)
  );
}

/**
 * O Nubank às vezes manda o mesmo pagamento de fatura duas vezes: a versão
 * pendente (com outro id) continua lá depois que a lançada chega. Contar as
 * duas dobra o "pago". Só vale para pagamento: compras iguais no mesmo dia
 * existem de verdade.
 */
export function semPagamentosPendentesRepetidos(transacoes: readonly Transacao[]): Transacao[] {
  const chave = (t: Transacao) => [t.contaId, t.data, t.valor, t.sentido].join('|');
  const lancados = new Set(transacoes.filter((t) => !t.pendente && ehPagamentoDeFatura(t)).map(chave));
  return transacoes.filter((t) => !(t.pendente && ehPagamentoDeFatura(t) && lancados.has(chave(t))));
}

export function normalizarFatura(b: CreditCardBills, contaId: string): Fatura {
  return {
    id: b.id,
    contaId,
    vencimento: diaDoProvedor(b.dueDate)!,
    fechamento: diaDoProvedor(b.billClosingDate),
    total: paraCentavos(b.totalAmount),
    pagamentoMinimo: b.minimumPaymentAmount != null ? paraCentavos(b.minimumPaymentAmount) : null,
    pago: (b.payments ?? []).reduce((s, p) => s + paraCentavos(p.amount), 0),
  };
}

export function normalizarInvestimento(i: Investment): Investimento {
  return {
    id: i.id,
    conexaoId: i.itemId,
    nome: i.name,
    tipo: i.type,
    subtipo: i.subtype,
    saldo: paraCentavos(i.balance),
    valorAplicado: i.amountOriginal != null ? paraCentavos(i.amountOriginal) : null,
    rendimento: i.amountProfit != null ? paraCentavos(i.amountProfit) : null,
    vencimento: diaDoProvedor(i.dueDate),
    taxa: i.rate ?? null,
    indexador: i.rateType ?? null,
  };
}

const CNPJ_NU_FINANCEIRA = '30680829000143';

function ehLoteDeCaixinha(i: Investment): boolean {
  return (
    i.type === 'FIXED_INCOME' &&
    i.subtype === 'CDB' &&
    (i.issuerCNPJ ?? '').replace(/\D/g, '') === CNPJ_NU_FINANCEIRA
  );
}

/**
 * O Nubank manda as caixinhas pelo Open Finance como investimentos: cada depósito vira um CDB
 * da Nu Financeira, sem o nome da caixinha. Junta os lotes (por taxa) numa caixinha da conta.
 * O id é estável (conexão + taxa), então uma meta ligada a ela sobrevive a depósitos e resgates.
 */
export function caixinhasDoNubank(
  investimentos: readonly Investment[],
  conexaoId: string,
  contaId: string | null,
): { caixinhas: Caixinha[]; restantes: Investment[] } {
  const lotes = investimentos.filter(ehLoteDeCaixinha);
  if (contaId === null || lotes.length === 0) return { caixinhas: [], restantes: [...investimentos] };

  const porTaxa = new Map<number, Centavos>();
  for (const l of lotes) porTaxa.set(l.rate ?? 100, (porTaxa.get(l.rate ?? 100) ?? 0) + paraCentavos(l.balance));
  const taxas = [...porTaxa.keys()].sort((a, b) => a - b);
  const caixinhas = taxas.map((taxa) => ({
    id: `${conexaoId}:nu-cdb-${taxa}`,
    contaId,
    nome: taxas.length === 1 ? 'Caixinhas' : `Caixinhas · ${taxa}% do CDI`,
    valor: porTaxa.get(taxa)!,
    indexador: 'CDI',
    percentualIndexador: taxa / 100,
  }));
  return { caixinhas, restantes: investimentos.filter((i) => !ehLoteDeCaixinha(i)) };
}

/** Investimento encerrado não é patrimônio. */
export function investimentoAtivo(i: Investment): boolean {
  return i.status !== 'TOTAL_WITHDRAWAL' && normalizar(i.name) !== '';
}
