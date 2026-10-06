import { entraNaFatura, visaoDoCartao } from './cartao';
import { montarMovimentos } from './movimentos';
import { cartao, conta, transacao } from './testing/fabrica';
import type { Transacao } from './types';

const ctx = { documentosDoTitular: [], nomesDoTitular: [] };
const mov = (ts: Transacao[]) => montarMovimentos(ts, ctx, [], new Map());
const nubank = conta({
  id: 'cartao', tipo: 'CARTAO', nome: 'Nubank Mastercard', saldo: 50000,
  limite: 1000000, limiteDisponivel: 700000, fechamento: '2026-07-08', vencimento: '2026-07-15',
});

describe('visaoDoCartao', () => {
  // Hoje: 20/07 → a fatura aberta é a de agosto (fecha 08/08, vence 15/08).
  const hoje = '2026-07-20';
  const movimentos = mov([
    cartao({ id: 'a', descricao: 'Mercado', valor: 20000, data: '2026-06-20' }), // fatura jul
    cartao({ id: 'b', descricao: 'iFood', valor: 5000, data: '2026-07-10' }), // fatura ago
    cartao({ id: 'e', sentido: 'ENTRADA', descricao: 'Estorno iFood', valor: 1000, data: '2026-07-11' }),
    cartao({ id: 'fp', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 20000, data: '2026-07-15' }),
    ...[1, 2, 3].map((n) => cartao({
      id: `tv${n}`, descricao: 'Loja TV', valor: 100000, data: '2026-07-10', pendente: n > 1,
      parcela: { numero: n, total: 3, valorTotal: 300000, dataCompra: '2026-07-10' },
    })), // ago, set, out
  ]);
  const v = visaoDoCartao(nubank, movimentos, [
    { id: 'fjul', contaId: 'cartao', vencimento: '2026-07-15', fechamento: '2026-07-08', total: 20000, pagamentoMinimo: 3000, pago: 20000 },
  ], hoje);

  it('limite usado = limite − disponível', () => {
    expect(v.usado).toBe(300000);
    expect(v.faturaAtual).toBe('2026-08');
  });

  it('monta as faturas por mês com a situação de cada uma', () => {
    expect(v.faturas.map((f) => [f.mes, f.situacao, f.total])).toEqual([
      ['2026-07', 'PAGA', 20000],
      ['2026-08', 'ABERTA', 5000 - 1000 + 100000],
      ['2026-09', 'FUTURA', 100000],
      ['2026-10', 'FUTURA', 100000],
    ]);
  });

  it('pagamento da fatura não entra como item da fatura', () => {
    expect(v.faturas.find((f) => f.mes === '2026-07')?.quantidade).toBe(1);
  });

  it('compromisso futuro soma as faturas que ainda não abriram', () => {
    expect(v.compromissoFuturo).toBe(200000);
  });

  it('agrupa o parcelamento e sabe quanto falta', () => {
    expect(v.parcelamentos).toEqual([expect.objectContaining({
      descricao: 'Loja TV', parcelaAtual: 1, totalParcelas: 3, valorParcela: 100000, restante: 200000,
      valorTotal: 300000, ultimaFatura: '2026-10',
    })]);
  });

  it('conta parcelas que o banco ainda não mandou', () => {
    const so1 = mov([cartao({
      id: 'x1', descricao: 'Celular', valor: 50000, data: '2026-07-10',
      parcela: { numero: 1, total: 10, valorTotal: 500000, dataCompra: '2026-07-10' },
    })]);
    const [p] = visaoDoCartao(nubank, so1, [], hoje).parcelamentos;
    expect(p).toMatchObject({ parcelaAtual: 1, restante: 450000, ultimaFatura: '2027-05' });
  });

  it('fatura sem pagamentos na lista do banco, mas com "pagamento recebido" no cartão, conta como paga', () => {
    const ms = mov([
      cartao({ id: 'c', descricao: 'Mercado', valor: 30000, data: '2026-06-20' }),
      cartao({ id: 'p', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 30000, data: '2026-07-14' }),
    ]);
    const v = visaoDoCartao(nubank, ms, [
      { id: 'f', contaId: 'cartao', vencimento: '2026-07-15', fechamento: '2026-07-08', total: 30000, pagamentoMinimo: null, pago: 0 },
    ], hoje);
    expect(v.faturas.find((f) => f.mes === '2026-07')).toMatchObject({ situacao: 'PAGA', pago: 30000 });
  });

  it('parcelamento terminado some da lista', () => {
    const acabou = mov([1, 2].map((n) => cartao({
      id: `o${n}`, descricao: 'Antigo', valor: 1000, data: '2026-03-01',
      parcela: { numero: n, total: 2, valorTotal: 2000, dataCompra: '2026-03-01' },
    })));
    expect(visaoDoCartao(nubank, acabou, [], hoje).parcelamentos).toEqual([]);
  });
});

describe('situação das faturas fechadas', () => {
  // Nubank: fecha dia 4, vence dia 11. O "pagamento recebido" vem ligado à
  // fatura SEGUINTE (a que está aberta quando o dinheiro entra).
  const cartaoNu = conta({
    id: 'cartao', tipo: 'CARTAO', nome: 'Nubank', saldo: 0, limite: 1000000, limiteDisponivel: 1000000,
    fechamento: null, vencimento: null,
  });
  const fatura = (id: string, mes: string, total: number, pago: number) => ({
    id, contaId: 'cartao', vencimento: `${mes}-11`, fechamento: `${mes}-04`, total, pagamentoMinimo: null, pago,
  });

  it('o pagamento da fatura anterior (ligado pelo banco à fatura seguinte) não quita a seguinte', () => {
    // Hoje 06/08: a de agosto fechou dia 4 e ainda não foi paga.
    const ms = mov([
      cartao({ id: 'c1', descricao: 'Mercado', valor: 30000, data: '2026-06-20', faturaId: 'fjul' }),
      cartao({ id: 'c2', descricao: 'Mercado', valor: 30000, data: '2026-07-20', faturaId: 'fago' }),
      cartao({ id: 'p1', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 30000, data: '2026-07-06', faturaId: 'fago' }),
    ]);
    const v = visaoDoCartao(cartaoNu, ms, [fatura('fjul', '2026-07', 30000, 30000), fatura('fago', '2026-08', 30000, 0)], '2026-08-06');
    expect(v.faturas.find((f) => f.mes === '2026-07')).toMatchObject({ situacao: 'PAGA', pago: 30000 });
    expect(v.faturas.find((f) => f.mes === '2026-08')).toMatchObject({ situacao: 'FECHADA', pago: 0 });
  });

  it('com a fatura do banco, vale o pago dela — nunca a soma dos pagamentos ligados por id', () => {
    const ms = mov([
      cartao({ id: 'p1', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 30000, data: '2026-07-06', faturaId: 'fago' }),
      cartao({ id: 'p2', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 25000, data: '2026-08-06', faturaId: 'fset' }),
    ]);
    const v = visaoDoCartao(cartaoNu, ms, [fatura('fago', '2026-08', 25000, 25000)], '2026-08-20');
    expect(v.faturas.find((f) => f.mes === '2026-08')).toMatchObject({ situacao: 'PAGA', pago: 25000 });
  });

  it('fatura quitada com "Crédito de parcelamento" (parcelamento da fatura) não fica a pagar', () => {
    // Dezembro: total 5.160,05, pagos 4.300,00; o resto virou parcelamento no dia 08.
    const ms = mov([
      cartao({ id: 'pg', sentido: 'ENTRADA', descricao: 'Pagamento recebido', valor: 430000, data: '2025-12-08', faturaId: 'fjan' }),
      cartao({ id: 'cp', sentido: 'ENTRADA', descricao: 'Crédito de parcelamento', valor: 86005, data: '2025-12-08', faturaId: 'fjan' }),
    ]);
    const v = visaoDoCartao(cartaoNu, ms, [fatura('fdez', '2025-12', 516005, 430000)], '2025-12-20');
    expect(v.faturas.find((f) => f.mes === '2025-12')).toMatchObject({ situacao: 'PAGA', quitacao: 'PARCELAMENTO', pago: 430000 });
  });

  it('crédito de parcelamento que não cobre o restante não quita a fatura', () => {
    const ms = mov([
      cartao({ id: 'cp', sentido: 'ENTRADA', descricao: 'Crédito de parcelamento', valor: 10000, data: '2025-12-08' }),
    ]);
    const v = visaoDoCartao(cartaoNu, ms, [fatura('fdez', '2025-12', 516005, 430000)], '2025-12-20');
    expect(v.faturas.find((f) => f.mes === '2025-12')).toMatchObject({ situacao: 'FECHADA', quitacao: null });
  });

  it('só a fatura fechada mais recente pode estar a pagar: o saldo das anteriores rolou para a seguinte', () => {
    const v = visaoDoCartao(cartaoNu, [], [
      fatura('fjul', '2026-07', 50000, 20000),
      fatura('fago', '2026-08', 60000, 0),
    ], '2026-08-06');
    expect(v.faturas.map((f) => [f.mes, f.situacao, f.quitacao])).toEqual([
      ['2026-07', 'PAGA', 'PROXIMA_FATURA'],
      ['2026-08', 'FECHADA', null],
    ]);
  });

  it('sem as faturas do banco, não dá para saber se o saldo rolou: a fatura sem pagamento continua fechada', () => {
    const ms = mov([
      cartao({ id: 'jun', descricao: 'Mercado', valor: 50000, data: '2026-05-20' }),
      cartao({ id: 'jul', descricao: 'Mercado', valor: 20000, data: '2026-06-20' }),
    ]);
    const v = visaoDoCartao({ ...cartaoNu, fechamento: '2026-08-04', vencimento: '2026-08-11' }, ms, [], '2026-08-20');
    // Junho não teve pagamento; sem a fatura de julho do banco, "rolou" seria chute.
    expect(v.faturas.map((f) => [f.mes, f.situacao, f.quitacao])).toEqual([
      ['2026-06', 'FECHADA', null],
      ['2026-07', 'FECHADA', null],
    ]);
  });

  it('só a fatura seguinte vinda do banco (o total dela traz o saldo) permite dizer que rolou', () => {
    // Julho veio do banco, agosto não: julho sem pagamento continua fechada.
    const ms = mov([cartao({ id: 'ago', descricao: 'Mercado', valor: 20000, data: '2026-07-20' })]);
    const v = visaoDoCartao(cartaoNu, ms, [fatura('fjun', '2026-06', 40000, 0), fatura('fjul', '2026-07', 50000, 0)], '2026-08-20');
    expect(v.faturas.map((f) => [f.mes, f.situacao, f.quitacao])).toEqual([
      ['2026-06', 'PAGA', 'PROXIMA_FATURA'],
      ['2026-07', 'FECHADA', null],
      ['2026-08', 'FECHADA', null],
    ]);
  });

  it('sem fechamento na conta, o ciclo vem da última fatura do banco (fecha dia 4, não 8)', () => {
    // 06/09 já é depois do fechamento de setembro (dia 4): a compra cai em outubro.
    const compra = mov([cartao({ id: 'x', descricao: 'Padaria', valor: 1000, data: '2026-09-06' })]);
    const v = visaoDoCartao({ ...cartaoNu, vencimento: '2026-08-11' }, compra, [fatura('fset', '2026-09', 1000, 1000)], '2026-09-06');
    expect(v.faturaAtual).toBe('2026-10');
    expect(v.faturas.find((f) => f.mes === '2026-10')?.vencimento).toBe('2026-10-11');
  });
});

describe('compras parceladas pelo instante da compra', () => {
  const hoje = '2026-09-27'; // fatura aberta: outubro (fecha dia 4, vence dia 11)
  const cartaoNu = conta({
    id: 'cartao', tipo: 'CARTAO', nome: 'Nubank', saldo: 0, limite: 1000000, limiteDisponivel: 1000000,
    fechamento: '2026-10-04', vencimento: '2026-10-11',
  });
  const parcela = (id: string, n: number, total: number, valor: number, instante: string, descricao: string, prevista: string) =>
    cartao({
      id, descricao, valor, data: '2026-08-12', faturaPrevista: prevista,
      parcela: { numero: n, total, valorTotal: null, dataCompra: '2026-08-12', instanteCompra: instante },
    });
  const meses = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'];

  it('duas compras 10x no mesmo dia continuam separadas; descrição e centavos que mudam não dividem a compra', () => {
    const loja = meses.map((m, i) => parcela(`l${i + 1}`, i + 1, 10, i === 0 ? 27950 : 27940, '2026-08-12T20:41:48.001Z',
      i < 5 ? `Loja Um ${i + 1}/10` : `LOJA UM LTDA ${i + 1}/10`, m));
    const colchao = meses.map((m, i) => parcela(`c${i + 1}`, i + 1, 10, i === 0 ? 18197 : 18195, '2026-08-12T21:52:35.001Z',
      `Colchoes ${i + 1}/10`, m));
    const v = visaoDoCartao(cartaoNu, mov([...loja, ...colchao]), [], hoje);
    expect(v.parcelamentos).toHaveLength(2);
    expect(v.parcelamentos.map((p) => [p.parcelaAtual, p.totalParcelas, p.restante, p.valorTotal])).toEqual([
      [2, 10, 8 * 27940, 27950 + 9 * 27940],
      [2, 10, 8 * 18195, 18197 + 9 * 18195],
    ]);
    // O que falta das compras parceladas é exatamente o que as faturas futuras somam.
    expect(v.parcelamentos.reduce((s, p) => s + p.restante, 0)).toBe(v.compromissoFuturo);
  });

  it('instante sem hora (meia-noite UTC) não junta duas compras do mesmo dia', () => {
    const meiaNoite = '2026-08-12T00:00:00.000Z';
    const ms = mov([
      ...[1, 2, 3].map((n) => parcela(`tv${n}`, n, 3, 100000, meiaNoite, `TV ${n}/3`, meses[n - 1]!)),
      ...[1, 2, 3].map((n) => parcela(`so${n}`, n, 3, 50000, meiaNoite, `Sofa ${n}/3`, meses[n - 1]!)),
    ]);
    const v = visaoDoCartao(cartaoNu, ms, [], hoje);
    expect(v.parcelamentos.map((p) => [p.descricao, p.restante])).toEqual([['TV', 100000], ['Sofa', 50000]]);
    expect(v.parcelamentos.reduce((s, p) => s + p.restante, 0)).toBe(v.compromissoFuturo);
  });

  it('parcela irmã sem o instante não vira uma compra fantasma', () => {
    const instante = '2026-08-12T10:00:00.001Z';
    const semInstante = parcela('a3', 3, 3, 1000, instante, 'Loja 3/3', '2026-11');
    const ms = mov([
      parcela('a1', 1, 3, 1000, instante, 'Loja 1/3', '2026-09'),
      parcela('a2', 2, 3, 1000, instante, 'Loja 2/3', '2026-10'),
      { ...semInstante, parcela: { ...semInstante.parcela!, instanteCompra: null } },
    ]);
    expect(visaoDoCartao(cartaoNu, ms, [], hoje).parcelamentos).toEqual([
      expect.objectContaining({ parcelaAtual: 2, restante: 1000, valorTotal: 3000 }),
    ]);
  });

  it('a mesma parcela repetida (pendente e lançada) conta uma vez só', () => {
    const ms = mov([
      parcela('a1', 1, 3, 1000, '2026-08-12T10:00:00.001Z', 'Loja 1/3', '2026-09'),
      parcela('a2', 2, 3, 1000, '2026-08-12T10:00:00.001Z', 'Loja 2/3', '2026-10'),
      { ...parcela('a2b', 2, 3, 1000, '2026-08-12T10:00:00.001Z', 'Loja 2/3', '2026-10'), pendente: true },
      parcela('a3', 3, 3, 1000, '2026-08-12T10:00:00.001Z', 'Loja 3/3', '2026-11'),
    ]);
    expect(visaoDoCartao(cartaoNu, ms, [], hoje).parcelamentos).toEqual([
      expect.objectContaining({ parcelaAtual: 2, restante: 1000, valorTotal: 3000 }),
    ]);
  });
});

describe('o que entra na fatura', () => {
  const hoje = '2026-07-20'; // fatura aberta: agosto
  const nubank = conta({ id: 'cartao', tipo: 'CARTAO', nome: 'Nubank', fechamento: '2026-07-08', vencimento: '2026-07-15' });

  it('Pix no crédito e parcela do parcelamento da fatura não são gasto, mas o cartão cobra: entram na fatura', () => {
    const ms = mov([
      transacao({
        id: 'add', sentido: 'ENTRADA', valor: 4500, data: '2026-07-10',
        descricao: 'Valor adicionado na conta por cartão de crédito | Valor adicionado para PIX no Crédito',
      }),
      cartao({ id: 'pix', descricao: 'Pagamento de pix', valor: 5000, data: '2026-07-10' }),
      cartao({ id: 'pf', descricao: 'Parcelamento de Fatura 2/6', valor: 7000, data: '2026-07-10' }),
    ]);
    expect(ms.map((m) => m.natureza)).toEqual(['TRANSFERENCIA', 'TRANSFERENCIA', 'TRANSFERENCIA']);
    expect(visaoDoCartao(nubank, ms, [], hoje).faturas).toEqual([
      expect.objectContaining({ mes: '2026-08', total: 12000, quantidade: 2 }),
    ]);
  });

  it('"Crédito de parcelamento" só zera o saldo antigo: não abate a fatura em que cai', () => {
    const ms = mov([
      cartao({ id: 'c', descricao: 'Mercado', valor: 5000, data: '2026-07-10' }),
      cartao({ id: 'cp', sentido: 'ENTRADA', descricao: 'Crédito de parcelamento', valor: 3000, data: '2026-07-10' }),
    ]);
    expect(visaoDoCartao(nubank, ms, [], hoje).faturas).toEqual([expect.objectContaining({ mes: '2026-08', total: 5000 })]);
  });

  it('o que o usuário muda na natureza não muda o que o banco cobra: estorno ignorado continua abatendo', () => {
    const ts = [
      cartao({ id: 'c', descricao: 'Loja', valor: 10000, data: '2026-07-10' }),
      cartao({ id: 'e', sentido: 'ENTRADA', descricao: 'Estorno Loja', valor: 4000, data: '2026-07-11' }),
      cartao({ id: 'x', descricao: 'Mercado', valor: 2000, data: '2026-07-12' }),
    ];
    const ajustes = new Map([
      ['e', { natureza: null, categoriaId: null, nota: null, ignorar: true }],
      ['x', { natureza: 'PAGAMENTO_FATURA' as const, categoriaId: null, nota: null, ignorar: false }],
    ]);
    const ms = montarMovimentos(ts, ctx, [], ajustes);
    expect(visaoDoCartao(nubank, ms, [], hoje).faturas).toEqual([
      expect.objectContaining({ mes: '2026-08', total: 10000 - 4000 + 2000, quantidade: 3 }),
    ]);
    expect(ms.filter(entraNaFatura).map((m) => m.id)).toEqual(['c', 'e', 'x']);
  });
});
