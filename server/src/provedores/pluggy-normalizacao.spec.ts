import type { Account, CreditCardBills, Investment, Transaction } from 'pluggy-sdk';
import {
  caixinhasDoNubank, diaDoProvedor, investimentoAtivo, normalizarCaixinhas, normalizarConta, normalizarFatura,
  normalizarInvestimento, normalizarTransacao, semPagamentosPendentesRepetidos,
} from './pluggy-normalizacao';

// Formatos exatamente como o pluggy-sdk devolve (datas já como Date).
const contaCorrente = {
  id: 'acc-1', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', number: '1234-5', balance: 3210.55,
  name: 'Conta', marketingName: 'NuConta', owner: 'FULANO DE TAL', taxNumber: '123.456.789-09', currencyCode: 'BRL',
  creditData: null,
  bankData: {
    transferNumber: null, closingBalance: 3210.55, automaticallyInvestedBalance: null, overdraftContractedLimit: null,
    overdraftUsedLimit: null, unarrangedOverdraftAmount: null, hasReservedBalance: true,
    reservedBalances: [
      { name: 'Viagem', identification: 'cx-1', availableAmounts: [
        { amount: 1000.1, currencyCode: 'BRL', remuneration: { preFixedRate: null, postFixedIndexerPercentage: 1, rateType: 'LINEAR', indexer: 'CDI', calculation: 'DIAS_UTEIS', ratePeriodicity: 'ANUAL', indexerAdditionalInfo: null } },
        { amount: 0.2, currencyCode: 'BRL', remuneration: null },
      ] },
      { name: null, identification: '', availableAmounts: [{ amount: 50, currencyCode: 'BRL', remuneration: null }] },
      { name: 'Reserva de Emergência', identification: '', availableAmounts: [{ amount: 10, currencyCode: 'BRL', remuneration: null }] },
    ],
  },
} as unknown as Account;

const cartaoCredito = {
  ...contaCorrente, id: 'acc-2', type: 'CREDIT', subtype: 'CREDIT_CARD', balance: 1500.4, marketingName: null, name: 'Ultravioleta',
  bankData: null,
  creditData: {
    level: 'BLACK', brand: 'MASTERCARD', balanceCloseDate: new Date('2026-07-08T00:00:00.000Z'),
    balanceDueDate: new Date('2026-07-15T00:00:00.000Z'), availableCreditLimit: 8500, balanceForeignCurrency: null,
    minimumPayment: 200, creditLimit: 10000, isLimitFlexible: false, status: 'ACTIVE', holderType: 'MAIN',
  },
} as unknown as Account;

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1', accountId: 'acc-2', date: new Date('2026-07-10T00:00:00.000Z'), description: 'IFOOD', descriptionRaw: null,
    type: 'DEBIT', amount: 45.9, amountInAccountCurrency: null, balance: 0, currencyCode: 'BRL', category: 'Food delivery',
    categoryId: '11020000', status: 'POSTED' as Transaction['status'], creditCardMetadata: null, operationType: null, ...p,
  } as Transaction;
}

describe('diaDoProvedor', () => {
  it('meia-noite UTC é data de calendário: não volta um dia no fuso do Brasil', () => {
    expect(diaDoProvedor(new Date('2026-07-10T00:00:00.000Z'))).toBe('2026-07-10');
  });
  it('instante com hora vira o dia local', () => {
    expect(diaDoProvedor(new Date('2026-07-10T15:00:00.000Z'))).toBe('2026-07-10');
  });
  it('nulo e inválido', () => {
    expect(diaDoProvedor(null)).toBeNull();
    expect(diaDoProvedor('xx')).toBeNull();
  });
});

describe('normalizarConta', () => {
  it('conta corrente em centavos, com nome comercial', () => {
    expect(normalizarConta(contaCorrente, 'item-1', 'Nubank')).toMatchObject({
      tipo: 'CONTA', nome: 'NuConta', saldo: 321055, limite: null, documentoTitular: '123.456.789-09',
    });
  });
  it('cartão com limite e ciclo da fatura', () => {
    expect(normalizarConta(cartaoCredito, 'item-1', 'Nubank')).toMatchObject({
      tipo: 'CARTAO', nome: 'Ultravioleta', saldo: 150040, limite: 1000000, limiteDisponivel: 850000,
      fechamento: '2026-07-08', vencimento: '2026-07-15',
    });
  });
  it('poupança', () => {
    expect(normalizarConta({ ...contaCorrente, subtype: 'SAVINGS_ACCOUNT' } as Account, 'i', 'X').tipo).toBe('POUPANCA');
  });
});

describe('normalizarCaixinhas', () => {
  it('soma as faixas de remuneração e guarda o indexador', () => {
    expect(normalizarCaixinhas(contaCorrente)).toEqual([
      { id: 'acc-1:cx-1', contaId: 'acc-1', nome: 'Viagem', valor: 100030, indexador: 'CDI', percentualIndexador: 1 },
      { id: 'acc-1:1', contaId: 'acc-1', nome: 'Caixinha', valor: 5000, indexador: null, percentualIndexador: null },
      { id: 'acc-1:reserva-de-emergencia', contaId: 'acc-1', nome: 'Reserva de Emergência', valor: 1000, indexador: null, percentualIndexador: null },
    ]);
  });
  it('conta sem saldo reservado não tem caixinha', () => {
    expect(normalizarCaixinhas(cartaoCredito)).toEqual([]);
  });
});

describe('normalizarTransacao', () => {
  it('compra no cartão: DEBIT sai, valor positivo em centavos', () => {
    expect(normalizarTransacao(tx({}), 'CARTAO')).toMatchObject({
      sentido: 'SAIDA', valor: 4590, data: '2026-07-10', categoriaProvedor: 'Food delivery', pendente: false,
    });
  });
  it('pagamento no cartão chega negativo e vira entrada', () => {
    expect(normalizarTransacao(tx({ type: 'CREDIT', amount: -1200 }), 'CARTAO')).toMatchObject({ sentido: 'ENTRADA', valor: 120000 });
  });
  it('sem type, usa a convenção de sinal de cada tipo de conta', () => {
    const semTipo = (amount: number) => tx({ type: undefined as never, amount });
    expect(normalizarTransacao(semTipo(10), 'CARTAO').sentido).toBe('SAIDA');
    expect(normalizarTransacao(semTipo(-10), 'CARTAO').sentido).toBe('ENTRADA');
    expect(normalizarTransacao(semTipo(-10), 'CONTA').sentido).toBe('SAIDA');
    expect(normalizarTransacao(semTipo(10), 'CONTA').sentido).toBe('ENTRADA');
  });
  it('compra em moeda estrangeira usa o valor em reais', () => {
    expect(normalizarTransacao(tx({ amount: 20, amountInAccountCurrency: 110.37, currencyCode: 'USD' }), 'CARTAO').valor).toBe(11037);
  });
  it('parcela, fatura e previsão de fatura', () => {
    const t = normalizarTransacao(tx({
      status: 'PENDING' as Transaction['status'],
      creditCardMetadata: {
        installmentNumber: 2, totalInstallments: 10, totalAmount: 459, purchaseDate: new Date('2026-06-10T00:00:00.000Z'),
        billId: 'bill-9', billForecastDate: '2026-08',
      },
    }), 'CARTAO');
    expect(t).toMatchObject({
      pendente: true, faturaId: 'bill-9', faturaPrevista: '2026-08',
      parcela: { numero: 2, total: 10, valorTotal: 45900, dataCompra: '2026-06-10' },
    });
  });
  it('guarda o instante completo da compra: é igual em todas as parcelas e separa compras do mesmo dia', () => {
    const t = normalizarTransacao(tx({
      creditCardMetadata: { installmentNumber: 3, totalInstallments: 10, purchaseDate: new Date('2026-09-09T22:07:53.001Z') },
    }), 'CARTAO');
    expect(t.parcela).toMatchObject({ dataCompra: '2026-09-09', instanteCompra: '2026-09-09T22:07:53.001Z' });
    const semData = normalizarTransacao(tx({ creditCardMetadata: { installmentNumber: 1, totalInstallments: 2 } }), 'CARTAO');
    expect(semData.parcela).toMatchObject({ dataCompra: null, instanteCompra: null });
  });
  it('Pix: contraparte é quem recebe na saída e quem paga na entrada', () => {
    const paymentData = {
      payer: { name: 'Maria', documentNumber: { type: 'CPF', value: '***.111.222-**' } },
      receiver: { name: 'Padaria', documentNumber: { type: 'CNPJ', value: '11.222.333/0001-44' } },
      paymentMethod: 'PIX', boletoMetadata: null,
    } as Transaction['paymentData'];
    expect(normalizarTransacao(tx({ accountId: 'acc-1', type: 'DEBIT', amount: -30, paymentData }), 'CONTA'))
      .toMatchObject({ contraparteNome: 'Padaria', meioPagamento: 'PIX' });
    expect(normalizarTransacao(tx({ accountId: 'acc-1', type: 'CREDIT', amount: 30, paymentData }), 'CONTA'))
      .toMatchObject({ contraparteNome: 'Maria', contraparteDocumento: '***.111.222-**' });
  });
  it('descrição vazia não quebra a tela', () => {
    expect(normalizarTransacao(tx({ description: '  ', descriptionRaw: null }), 'CARTAO').descricao).toBe('Sem descrição');
  });
});

describe('fatura e investimento', () => {
  it('fatura soma os pagamentos', () => {
    const b = {
      id: 'b1', dueDate: new Date('2026-07-15T00:00:00.000Z'), billClosingDate: new Date('2026-07-08T00:00:00.000Z'),
      totalAmount: 1500.4, totalAmountCurrencyCode: 'BRL', minimumPaymentAmount: 200, allowsInstallments: true, financeCharges: [],
      payments: [{ amount: 1000, paymentDate: new Date(), valueType: 'OTHER_PAYMENT' }, { amount: 500.4 }],
      createdAt: new Date(), updatedAt: new Date(),
    } as unknown as CreditCardBills;
    expect(normalizarFatura(b, 'acc-2')).toEqual({
      id: 'b1', contaId: 'acc-2', vencimento: '2026-07-15', fechamento: '2026-07-08', total: 150040, pagamentoMinimo: 20000, pago: 150040,
    });
  });
  it('investimento em centavos e filtro de encerrados', () => {
    const i = {
      id: 'inv', itemId: 'item-1', name: 'Tesouro Selic 2029', type: 'FIXED_INCOME', subtype: 'TREASURY', balance: 5123.45,
      amountOriginal: 5000, amountProfit: 123.45, dueDate: new Date('2029-03-01T00:00:00.000Z'), rate: 100, rateType: 'SELIC', status: 'ACTIVE',
    } as unknown as Investment;
    expect(normalizarInvestimento(i)).toMatchObject({ saldo: 512345, valorAplicado: 500000, rendimento: 12345, vencimento: '2029-03-01', indexador: 'SELIC' });
    expect(investimentoAtivo(i)).toBe(true);
    expect(investimentoAtivo({ ...i, status: 'TOTAL_WITHDRAWAL' } as Investment)).toBe(false);
  });
});

describe('caixinhasDoNubank', () => {
  // Cada depósito numa caixinha vira um CDB da Nu Financeira no Open Finance.
  function lote(p: Partial<Investment>): Investment {
    return {
      id: 'lote', itemId: 'item-1', name: 'CDB - NU FINANCEIRA S.A. - SOCIEDADE DE CREDITO, FINANCIAMENTO E INVESTIMENTO',
      type: 'FIXED_INCOME', subtype: 'CDB', balance: 100, issuerCNPJ: '30.680.829/0001-43', rate: 115, rateType: 'CDI',
      status: 'ACTIVE', ...p,
    } as unknown as Investment;
  }
  const tesouro = lote({ id: 'tesouro', name: 'Tesouro Selic', subtype: 'TREASURY', issuerCNPJ: null, rateType: 'SELIC', rate: 100 });

  it('junta os lotes numa caixinha só, ligada à conta, com a taxa do CDI', () => {
    const r = caixinhasDoNubank([lote({ id: 'a', balance: 2641.45 }), lote({ id: 'b', balance: 859.51 }), tesouro], 'item-1', 'acc-1');
    expect(r.caixinhas).toEqual([
      { id: 'item-1:nu-cdb-115', contaId: 'acc-1', nome: 'Caixinhas', valor: 350096, indexador: 'CDI', percentualIndexador: 1.15 },
    ]);
    expect(r.restantes.map((i) => i.id)).toEqual(['tesouro']);
  });

  it('taxas diferentes viram caixinhas separadas, com a taxa no nome', () => {
    const r = caixinhasDoNubank([lote({ id: 'a', rate: 115 }), lote({ id: 'b', rate: 100, balance: 50 })], 'item-1', 'acc-1');
    expect(r.caixinhas.map((c) => [c.nome, c.valor])).toEqual([
      ['Caixinhas · 100% do CDI', 5000],
      ['Caixinhas · 115% do CDI', 10000],
    ]);
  });

  it('CDB de outro banco continua investimento', () => {
    const outro = lote({ id: 'x', issuerCNPJ: '00.000.000/0001-91' });
    expect(caixinhasDoNubank([outro], 'item-1', 'acc-1')).toEqual({ caixinhas: [], restantes: [outro] });
  });

  it('sem conta para pendurar, não inventa caixinha', () => {
    const l = lote({});
    expect(caixinhasDoNubank([l], 'item-1', null)).toEqual({ caixinhas: [], restantes: [l] });
  });
});

describe('semPagamentosPendentesRepetidos', () => {
  const pagamento = (id: string, status: 'PENDING' | 'POSTED', date: string, amount = -3923.91) =>
    normalizarTransacao(tx({
      id, status: status as Transaction['status'], type: 'CREDIT', amount, date: new Date(date),
      description: 'Pagamento recebido', category: 'Credit card payment', categoryId: '05100000',
    }), 'CARTAO');

  it('descarta o pagamento de fatura pendente que já chegou lançado (mesma conta, valor, dia e sentido)', () => {
    const lista = [pagamento('pend', 'PENDING', '2026-09-04T09:28:45.864Z'), pagamento('lanc', 'POSTED', '2026-09-04T03:00:00.000Z')];
    expect(semPagamentosPendentesRepetidos(lista).map((t) => t.id)).toEqual(['lanc']);
  });

  it('mantém o pendente sem par lançado, e o de valor ou dia diferente', () => {
    const lista = [
      pagamento('pend', 'PENDING', '2026-09-04T09:28:45.864Z'),
      pagamento('outro-valor', 'POSTED', '2026-09-04T03:00:00.000Z', -100),
      pagamento('outro-dia', 'POSTED', '2026-09-05T03:00:00.000Z'),
    ];
    expect(semPagamentosPendentesRepetidos(lista).map((t) => t.id)).toEqual(['pend', 'outro-valor', 'outro-dia']);
  });

  it('não mexe em compras iguais repetidas: isso existe de verdade', () => {
    const compra = (id: string, status: 'PENDING' | 'POSTED') =>
      normalizarTransacao(tx({ id, status: status as Transaction['status'], amount: 12, description: 'Cafe' }), 'CARTAO');
    expect(semPagamentosPendentesRepetidos([compra('a', 'PENDING'), compra('b', 'POSTED')]).map((t) => t.id)).toEqual(['a', 'b']);
  });
});
