import type { Account, Item, Transaction } from 'pluggy-sdk';
import { ProvedorPluggy, type ClientePluggy } from './provedor-pluggy';

function pagina<T>(results: T[], page = 1, totalPages = 1) {
  return { results, page, totalPages, total: results.length };
}

type Duble = Record<keyof ClientePluggy, ReturnType<typeof vi.fn>>;
const provedor = (c: Duble) => new ProvedorPluggy(c as unknown as ClientePluggy);

function dubleDoCliente(): Duble {
  const item = {
    id: 'item-1', status: 'UPDATED', error: null, lastUpdatedAt: new Date('2026-07-10T12:00:00Z'),
    consentExpiresAt: new Date('2027-07-10T12:00:00Z'),
    connector: { id: 200, name: 'MeuPluggy', imageUrl: 'https://x/logo.svg', primaryColor: 'ef294b' },
  } as unknown as Item;
  const contas = [
    { id: 'acc-1', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', balance: 100, name: 'Conta', bankData: null, creditData: null },
    { id: 'acc-2', itemId: 'item-1', type: 'CREDIT', subtype: 'CREDIT_CARD', balance: 50, name: 'Cartão', bankData: null,
      creditData: { creditLimit: 1000, availableCreditLimit: 950, balanceCloseDate: null, balanceDueDate: null } },
  ] as unknown as Account[];
  const t = (id: string, accountId: string) =>
    ({ id, accountId, date: new Date('2026-07-01T00:00:00.000Z'), description: 'X', type: 'DEBIT', amount: 10 }) as unknown as Transaction;
  return {
    fetchItem: vi.fn().mockResolvedValue(item),
    fetchAccounts: vi.fn().mockResolvedValue(pagina(contas)),
    fetchAllTransactions: vi.fn(async (accountId: string) => [t(`${accountId}-t`, accountId)]),
    fetchCreditCardBills: vi.fn(async (_id: string, { page }: { page: number }) =>
      pagina([{ id: `b${page}`, dueDate: new Date('2026-07-15T00:00:00.000Z'), billClosingDate: null, totalAmount: 50, minimumPaymentAmount: null, payments: [] }], page, 2)),
    fetchInvestments: vi.fn().mockResolvedValue(pagina([
      { id: 'i1', itemId: 'item-1', name: 'CDB', type: 'FIXED_INCOME', subtype: 'CDB', balance: 10, status: 'ACTIVE' },
      { id: 'i2', itemId: 'item-1', name: 'Antigo', type: 'FIXED_INCOME', subtype: 'CDB', balance: 0, status: 'TOTAL_WITHDRAWAL' },
    ])),
    createConnectToken: vi.fn().mockResolvedValue({ accessToken: 'tok' }),
    updateItem: vi.fn().mockResolvedValue(item),
    deleteItem: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('ProvedorPluggy', () => {
  it('busca contas, transações com a janela certa por tipo, todas as páginas de faturas e investimentos ativos', async () => {
    const cliente = dubleDoCliente();
    const dados = await provedor(cliente).buscar('item-1', { conta: '2026-05-01', cartao: '2025-06-01' });

    expect(cliente.fetchAllTransactions).toHaveBeenCalledWith('acc-1', { dateFrom: '2026-05-01' });
    expect(cliente.fetchAllTransactions).toHaveBeenCalledWith('acc-2', { dateFrom: '2025-06-01' });
    expect(dados.janelas).toEqual({ 'acc-1': '2026-05-01', 'acc-2': '2025-06-01' });
    expect(dados.contas.map((c) => c.tipo)).toEqual(['CONTA', 'CARTAO']);
    expect(dados.transacoes.map((t) => [t.id, t.tipoConta])).toEqual([['acc-1-t', 'CONTA'], ['acc-2-t', 'CARTAO']]);
    expect(dados.faturas.map((f) => f.id)).toEqual(['b1', 'b2']);
    expect(dados.investimentos.map((i) => i.id)).toEqual(['i1']);
    expect(dados.conexao).toMatchObject({ nome: 'MeuPluggy', cor: '#ef294b', situacao: 'UPDATED', conectorId: 200 });
  });

  it('CDBs da Nu Financeira viram a caixinha da conta corrente e saem dos investimentos', async () => {
    const cliente = dubleDoCliente();
    cliente.fetchInvestments.mockResolvedValue(pagina([
      { id: 'nu', itemId: 'item-1', name: 'CDB - NU FINANCEIRA', type: 'FIXED_INCOME', subtype: 'CDB', balance: 35.5,
        issuerCNPJ: '30.680.829/0001-43', rate: 115, rateType: 'CDI', status: 'ACTIVE' },
      { id: 'i1', itemId: 'item-1', name: 'CDB', type: 'FIXED_INCOME', subtype: 'CDB', balance: 10, status: 'ACTIVE' },
    ]));
    const dados = await provedor(cliente).buscar('item-1', { conta: '2026-05-01', cartao: '2025-06-01' });
    expect(dados.caixinhas).toEqual([
      { id: 'item-1:nu-cdb-115', contaId: 'acc-1', nome: 'Caixinhas', valor: 3550, indexador: 'CDI', percentualIndexador: 1.15 },
    ]);
    expect(dados.investimentos.map((i) => i.id)).toEqual(['i1']);
  });

  it('pagamento de fatura que veio duas vezes (pendente e lançado) fica só o lançado', async () => {
    const cliente = dubleDoCliente();
    const pagamento = (id: string, status: string, date: string) =>
      ({ id, accountId: 'acc-2', date: new Date(date), description: 'Pagamento recebido', type: 'CREDIT', amount: -3923.91,
        status, category: 'Credit card payment', categoryId: '05100000' }) as unknown as Transaction;
    cliente.fetchAllTransactions.mockImplementation(async (accountId: string) => accountId === 'acc-2'
      ? [pagamento('pend', 'PENDING', '2026-09-04T09:28:45.864Z'), pagamento('lanc', 'POSTED', '2026-09-04T03:00:00.000Z')]
      : []);
    const dados = await provedor(cliente).buscar('item-1', { conta: '2026-05-01', cartao: '2025-06-01' });
    expect(dados.transacoes.map((t) => t.id)).toEqual(['lanc']);
  });

  it('item que não terminou de atualizar não autoriza apagar nada (sem janelas)', async () => {
    const cliente = dubleDoCliente();
    cliente.fetchItem.mockResolvedValue({ id: 'item-1', status: 'UPDATING', error: null, connector: { id: 1, name: 'X' } });
    const dados = await provedor(cliente).buscar('item-1', { conta: '2026-05-01', cartao: '2025-06-01' });
    expect(dados.janelas).toEqual({});
    expect(dados.transacoes).toHaveLength(2);
  });

  it('cria o token do widget sem expor o segredo e evitando conexão duplicada', async () => {
    const cliente = dubleDoCliente();
    expect(await provedor(cliente).criarTokenDeConexao()).toBe('tok');
    expect(cliente.createConnectToken).toHaveBeenCalledWith(undefined, { clientUserId: 'fluxo-local', avoidDuplicates: true });
  });

  it('espera o item sair de UPDATING', async () => {
    const cliente = dubleDoCliente();
    cliente.fetchItem
      .mockResolvedValueOnce({ status: 'UPDATING' })
      .mockResolvedValueOnce({ status: 'UPDATED' });
    expect(await provedor(cliente).aguardarAtualizacao('item-1', 1000, 1)).toBe('UPDATED');
  });

  it('desiste de esperar no tempo limite', async () => {
    const cliente = dubleDoCliente();
    cliente.fetchItem.mockResolvedValue({ status: 'UPDATING' });
    expect(await provedor(cliente).aguardarAtualizacao('item-1', 0, 1)).toBe('UPDATING');
  });

  it('pedir atualização e remover chamam a API', async () => {
    const cliente = dubleDoCliente();
    const p = provedor(cliente);
    await p.pedirAtualizacao('item-1');
    await p.remover('item-1');
    expect(cliente.updateItem).toHaveBeenCalledWith('item-1');
    expect(cliente.deleteItem).toHaveBeenCalledWith('item-1');
  });
});
