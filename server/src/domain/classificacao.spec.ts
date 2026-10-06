import { categorizar } from './categorizacao';
import { classificar, type ContextoClassificacao } from './classificacao';
import { montarMovimentos } from './movimentos';
import { resumoDoMes } from './resumo';
import { cartao, transacao } from './testing/fabrica';

const ctx: ContextoClassificacao = {
  documentosDoTitular: ['12345678909'],
  nomesDoTitular: ['fulano de tal'],
};

describe('classificar — cartão de crédito', () => {
  it('compra no cartão é despesa', () => {
    expect(classificar(cartao({ sentido: 'SAIDA', descricao: 'iFood' }), ctx)).toBe('DESPESA');
  });

  it('pagamento recebido na fatura não é receita: é o outro lado do pagamento da fatura', () => {
    expect(classificar(cartao({ sentido: 'ENTRADA', descricao: 'Pagamento recebido' }), ctx))
      .toBe('PAGAMENTO_FATURA');
    expect(classificar(cartao({ sentido: 'ENTRADA', descricao: 'PAGAMENTO_FATURA' }), ctx))
      .toBe('PAGAMENTO_FATURA');
  });

  it('crédito no cartão que não é pagamento é estorno', () => {
    expect(classificar(cartao({ sentido: 'ENTRADA', descricao: 'Estorno Amazon' }), ctx)).toBe('ESTORNO');
  });
});

describe('classificar — conta', () => {
  it('pagar a fatura pela conta não é gasto: as compras já foram contadas', () => {
    expect(classificar(transacao({ descricao: 'Pagamento de fatura' }), ctx)).toBe('PAGAMENTO_FATURA');
    expect(classificar(transacao({ descricao: 'Pgto fatura cartão', categoriaProvedor: 'Credit card payment' }), ctx))
      .toBe('PAGAMENTO_FATURA');
  });

  it('guardar e resgatar da caixinha é investimento, nos dois sentidos', () => {
    expect(classificar(transacao({ descricao: 'Aplicação RDB' }), ctx)).toBe('INVESTIMENTO');
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Resgate RDB' }), ctx)).toBe('INVESTIMENTO');
    expect(classificar(transacao({ descricao: 'Dinheiro guardado na Caixinha Viagem' }), ctx)).toBe('INVESTIMENTO');
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Dinheiro resgatado' }), ctx)).toBe('INVESTIMENTO');
  });

  it('rendimento é receita, mesmo vindo da categoria de investimentos', () => {
    expect(classificar(transacao({
      sentido: 'ENTRADA', descricao: 'Rendimento da conta', categoriaProvedor: 'Proceeds interests and dividends',
    }), ctx)).toBe('RECEITA');
  });

  it('transferência para si mesmo, reconhecida pelo CPF da contraparte', () => {
    expect(classificar(transacao({
      descricao: 'Transferência enviada pelo Pix', contraparteDocumento: '123.456.789-09',
    }), ctx)).toBe('TRANSFERENCIA');
  });

  it('reconhece o CPF mascarado do Open Finance pelos dígitos visíveis', () => {
    expect(classificar(transacao({
      descricao: 'Pix enviado', contraparteDocumento: '***.456.789-**',
    }), ctx)).toBe('TRANSFERENCIA');
    expect(classificar(transacao({
      descricao: 'Pix enviado', contraparteDocumento: '***.999.789-**',
    }), ctx)).toBe('DESPESA');
  });

  it('transferência para si mesmo, reconhecida pelo nome ou pela categoria do provedor', () => {
    expect(classificar(transacao({ descricao: 'Pix', contraparteNome: 'FULANO DE TAL' }), ctx)).toBe('TRANSFERENCIA');
    expect(classificar(transacao({ descricao: 'TED', categoriaProvedor: 'Same person transfer' }), ctx))
      .toBe('TRANSFERENCIA');
  });

  it('Pix para outra pessoa é despesa; Pix de outra pessoa é receita', () => {
    expect(classificar(transacao({ descricao: 'Pix', contraparteNome: 'Maria Souza' }), ctx)).toBe('DESPESA');
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Pix recebido', contraparteNome: 'Maria' }), ctx))
      .toBe('RECEITA');
  });

  it('sem contexto do titular, nada vira transferência por engano', () => {
    const vazio = { documentosDoTitular: [], nomesDoTitular: [] };
    expect(classificar(transacao({ descricao: 'Pix', contraparteDocumento: '***.***.***-**' }), vazio)).toBe('DESPESA');
  });
});

describe('classificar — casos da revisão', () => {
  it('Pix de terceiro com mensagem "aplicação RDB" continua sendo gasto', () => {
    expect(classificar(transacao({
      descricao: 'Pix enviado aplicacao rdb', meioPagamento: 'PIX', contraparteNome: 'Loja Esperta',
    }), ctx)).toBe('DESPESA');
  });

  it('Pix recebido de terceiro com a palavra "fatura" continua sendo receita', () => {
    expect(classificar(transacao({
      sentido: 'ENTRADA', descricao: 'Pix recebido pagamento de fatura', meioPagamento: 'PIX', contraparteNome: 'Cliente X',
    }), ctx)).toBe('RECEITA');
  });

  it('"Pagamento recebido" entrando na conta corrente é receita, não fatura', () => {
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Pagamento recebido - Cliente X' }), ctx)).toBe('RECEITA');
  });

  it('compra e venda de outros investimentos não são gasto nem receita', () => {
    expect(classificar(transacao({ descricao: 'Compra Tesouro IPCA+', categoriaProvedor: 'Fixed income' }), ctx)).toBe('INVESTIMENTO');
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Venda de ações', categoriaProvedor: 'Variable income' }), ctx)).toBe('INVESTIMENTO');
    expect(classificar(transacao({ descricao: 'XP Fundo', categoriaProvedorId: '03030000' }), ctx)).toBe('INVESTIMENTO');
  });

  it('dividendos continuam sendo receita', () => {
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Dividendos ITSA4', categoriaProvedorId: '03060000', categoriaProvedor: 'Proceeds interests and dividends' }), ctx)).toBe('RECEITA');
  });

  it('crédito rotativo e parcelamento de fatura no cartão não são gasto novo', () => {
    expect(classificar(cartao({ descricao: 'Saldo em atraso', outroCredito: 'REVOLVING_CREDIT' }), ctx)).toBe('TRANSFERENCIA');
    expect(classificar(cartao({ descricao: 'Parcelamento de fatura 2/6', outroCredito: 'BILL_INSTALLMENT' }), ctx)).toBe('TRANSFERENCIA');
  });
});

describe('classificar — lançamentos do Nubank vistos nos dados reais', () => {
  // Titular fictícia: o nome entra no contexto como `contextoDoTitular` monta (normalizado).
  const titular: ContextoClassificacao = { documentosDoTitular: ['98765432100'], nomesDoTitular: ['ana beatriz souza'] };

  it('parcelamento de fatura sem o outroCredito certo (Nubank manda OTHER) não é gasto novo, nos dois lados', () => {
    expect(classificar(cartao({
      descricao: 'Parcelamento de Fatura 2/6', outroCredito: 'OTHER', categoriaProvedor: 'Credit card payment', categoriaProvedorId: '05100000',
    }), titular)).toBe('TRANSFERENCIA');
    expect(classificar(cartao({ descricao: 'Parcelamento de Fatura', outroCredito: 'OTHER' }), titular)).toBe('TRANSFERENCIA');
    expect(classificar(cartao({
      sentido: 'ENTRADA', descricao: 'Crédito de parcelamento', outroCredito: 'OTHER', categoriaProvedor: 'Transfers',
    }), titular)).toBe('TRANSFERENCIA');
  });

  it('crédito de parcelamento com a categoria "credit card payment" continua sendo parcelamento, não pagamento', () => {
    expect(classificar(cartao({
      sentido: 'ENTRADA', descricao: 'Crédito de parcelamento', outroCredito: 'OTHER', categoriaProvedor: 'Credit card payment',
    }), titular)).toBe('TRANSFERENCIA');
  });

  it('"parcelamento de fatura" no meio do texto do cartão continua sendo compra/estorno', () => {
    expect(classificar(cartao({ descricao: 'Loja Parcelamento de Fatura' }), titular)).toBe('DESPESA');
    expect(classificar(cartao({ sentido: 'ENTRADA', descricao: 'Estorno credito de parcelamento' }), titular)).toBe('ESTORNO');
  });

  it('Pix no crédito para a própria titular (o cartão mostra o nome dela) é transferência', () => {
    expect(classificar(cartao({ descricao: 'Ana Beatriz Souza 3/3', categoriaProvedor: 'Transfers' }), titular)).toBe('TRANSFERENCIA');
    expect(classificar(cartao({ descricao: 'ANA BEATRIZ SOUZA' }), titular)).toBe('TRANSFERENCIA');
  });

  it('Pix no crédito para outra pessoa, ou loja com nome parecido, continua sendo despesa', () => {
    expect(classificar(cartao({ descricao: 'Carla Mendes Lima', categoriaProvedor: 'Transfers' }), titular)).toBe('DESPESA');
    expect(classificar(cartao({ descricao: 'Ana Beatriz Souza Doces' }), titular)).toBe('DESPESA');
    expect(classificar(cartao({ descricao: 'Ana Beatriz' }), titular)).toBe('DESPESA');
  });

  it('no cartão o texto é da loja: "Pagamento de pix…" sem par na conta é compra', () => {
    expect(classificar(cartao({
      descricao: 'Pagamento de pix', categoriaProvedor: 'Transfer - PIX', categoriaProvedorId: '05070000', outroCredito: 'OTHER',
    }), titular)).toBe('DESPESA');
    const [m] = montarMovimentos([cartao({ id: 'loja', descricao: 'PAGAMENTO DE PIX LOJA EXEMPLO', valor: 5000 })], titular, [], new Map());
    expect(m?.natureza).toBe('DESPESA');
  });

  it('nome da titular sem par só vale sem loja por trás', () => {
    expect(classificar(cartao({ descricao: 'Ana Beatriz Souza', estabelecimento: 'ANA BEATRIZ SOUZA ME' }), titular)).toBe('DESPESA');
    expect(classificar(cartao({ descricao: 'Ana Beatriz Souza', cnpjEstabelecimento: '12345678000199' }), titular)).toBe('DESPESA');
  });

  it('Pix no crédito: o valor que o cartão põe na conta é transferência, mesmo com o recebedor como contraparte', () => {
    const adicionado = {
      sentido: 'ENTRADA' as const,
      descricao: 'Valor adicionado na conta por cartão de crédito | Valor adicionado para PIX no Crédito',
      meioPagamento: 'TEF',
    };
    expect(classificar(transacao({
      ...adicionado, categoriaProvedor: 'Transfer - Internal', categoriaProvedorId: '05060000', contraparteNome: 'Lanchonete Exemplo S.A.',
    }), titular)).toBe('TRANSFERENCIA');
    expect(classificar(transacao({ ...adicionado, categoriaProvedor: 'Transfer - Internal' }), titular)).toBe('TRANSFERENCIA');
    expect(classificar(transacao({ ...adicionado, categoriaProvedor: 'Same person transfer' }), titular)).toBe('TRANSFERENCIA');
  });

  it('depósito de empréstimo é entrada (as parcelas pagas é que saem como despesa), na categoria de empréstimo', () => {
    const deposito = transacao({
      sentido: 'ENTRADA', descricao: 'Depósito de empréstimo', categoriaProvedor: 'Loans', categoriaProvedorId: '02040000', meioPagamento: 'OTHER',
    });
    expect(classificar(deposito, titular)).toBe('RECEITA');
    expect(categorizar(deposito, 'RECEITA', [])).toBe('emprestimo');
    // A categoria da Pluggy sobre texto de terceiro não decide mais nada.
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Crédito XPTO', categoriaProvedorId: '02040000' }), titular))
      .toBe('RECEITA');
  });

  it('empréstimo no ano: o resultado é só o custo dele (o principal entra e sai uma vez)', () => {
    const ts = [
      transacao({ id: 'dep', sentido: 'ENTRADA', descricao: 'Depósito de empréstimo', categoriaProvedorId: '02040000', valor: 1000000, data: '2026-01-05' }),
      ...Array.from({ length: 12 }, (_, i) => transacao({
        id: `p${i}`, descricao: 'Parcela Paga', categoriaProvedor: 'Loans', categoriaProvedorId: '02040000', valor: 100000,
        data: `2026-${String(i + 1).padStart(2, '0')}-20`,
      })),
    ];
    const ms = montarMovimentos(ts, titular, [], new Map());
    const resultado = Array.from({ length: 12 }, (_, i) => resumoDoMes(ms, `2026-${String(i + 1).padStart(2, '0')}`).resultado)
      .reduce((a, b) => a + b, 0);
    expect(resultado).toBe(1000000 - 12 * 100000);
  });

  it('pagar parcela de empréstimo continua sendo despesa', () => {
    expect(classificar(transacao({ descricao: 'Parcela Paga', categoriaProvedor: 'Loans', categoriaProvedorId: '02040000' }), titular))
      .toBe('DESPESA');
  });

  it('reembolso de Pix é estorno (abate gasto), mesmo com a loja como contraparte', () => {
    expect(classificar(transacao({
      sentido: 'ENTRADA', descricao: 'Reembolso recebido pelo Pix|Loja Exemplo LTDA.', meioPagamento: 'PIX',
      contraparteNome: 'Loja Exemplo LTDA.', categoriaProvedor: 'Cashback',
    }), titular)).toBe('ESTORNO');
    expect(classificar(transacao({ sentido: 'ENTRADA', descricao: 'Reembolso recebido pelo Pix', meioPagamento: 'PIX' }), titular))
      .toBe('ESTORNO');
  });

  it('textos do Nubank só valem no começo: Pix de terceiro que os cita no meio segue a regra normal', () => {
    expect(classificar(transacao({
      sentido: 'ENTRADA', descricao: 'Transferência Recebida|reembolso recebido pelo pix', meioPagamento: 'PIX', contraparteNome: 'Carla',
    }), titular)).toBe('RECEITA');
    expect(classificar(transacao({
      sentido: 'ENTRADA', descricao: 'Transferência Recebida|deposito de emprestimo', meioPagamento: 'PIX', contraparteNome: 'Carla',
    }), titular)).toBe('RECEITA');
  });

  it('reembolso de Pix na conta reduz a despesa do mês no resumo', () => {
    const mes = montarMovimentos([
      transacao({ id: 'g', descricao: 'Transferência enviada|Loja Exemplo', meioPagamento: 'PIX', contraparteNome: 'Loja Exemplo', valor: 5000 }),
      transacao({
        id: 'r', sentido: 'ENTRADA', descricao: 'Reembolso recebido pelo Pix|Loja Exemplo', meioPagamento: 'PIX', contraparteNome: 'Loja Exemplo', valor: 2000,
      }),
    ], titular, [], new Map());
    const r = resumoDoMes(mes, '2026-07');
    expect(r.despesas).toBe(3000);
    expect(r.receitas).toBe(0);
  });
});

describe('Pix no crédito: a cobrança no cartão com par na conta', () => {
  // Titular e contrapartes fictícias. O Nubank põe o valor na conta ("Valor adicionado…") e cobra
  // no cartão o valor + IOF/juros, no mesmo dia; o texto da cobrança é o nome de quem recebeu.
  const titular: ContextoClassificacao = { documentosDoTitular: ['98765432100'], nomesDoTitular: ['ana beatriz souza'] };
  const adicionado = (id: string, valor: number, data = '2026-07-10') => transacao({
    id, sentido: 'ENTRADA', valor, data, meioPagamento: 'TEF',
    descricao: 'Valor adicionado na conta por cartão de crédito | Valor adicionado para PIX no Crédito',
  });
  const pixSaindo = (id: string, valor: number, nome = 'Carla Mendes Lima', data = '2026-07-10') => transacao({
    id, descricao: `Transferência enviada|${nome}`, meioPagamento: 'PIX', contraparteNome: nome, valor, data,
  });
  const natureza = (ms: { id: string; natureza: string }[]) => Object.fromEntries(ms.map((m) => [m.id, m.natureza]));
  const montar = (ts: Parameters<typeof montarMovimentos>[0]) => montarMovimentos(ts, titular, [], new Map());

  it('cobrança com nome de terceiro pareada é transferência: o gasto conta uma vez, no Pix da conta', () => {
    const ms = montar([
      adicionado('add', 30000),
      pixSaindo('pix', 30000),
      cartao({ id: 'cob', descricao: 'Carla Mendes Lima', categoriaProvedor: 'Transfers', valor: 33500 }),
    ]);
    expect(natureza(ms)).toEqual({ add: 'TRANSFERENCIA', pix: 'DESPESA', cob: 'TRANSFERENCIA' });
    expect(resumoDoMes(ms, '2026-07').despesas).toBe(30000);
  });

  it('"Pagamento de pix" pareado é transferência', () => {
    const ms = montar([adicionado('add', 1500), pixSaindo('pix', 1500), cartao({ id: 'cob', descricao: 'Pagamento de pix', valor: 1682 })]);
    expect(natureza(ms).cob).toBe('TRANSFERENCIA');
  });

  it('parcelado: o total cobrado pareia, e todas as parcelas da compra saem do gasto (mesmo com o texto mudando)', () => {
    const instante = '2026-07-10T16:33:31.511Z';
    const parcela = (n: number, data: string, descricao: string) => cartao({
      id: `c${n}`, descricao, valor: 10500, data, parcela: { numero: n, total: 3, valorTotal: null, dataCompra: '2026-07-10', instanteCompra: instante },
    });
    const ms = montar([
      adicionado('add', 30000),
      pixSaindo('pix', 30000),
      parcela(1, '2026-07-10', 'Pagamento de pix'),
      parcela(2, '2026-08-04', 'Pagamento de pix'),
      parcela(3, '2026-09-04', 'Carla Mendes Lima 3/3'),
    ]);
    expect(natureza(ms)).toMatchObject({ c1: 'TRANSFERENCIA', c2: 'TRANSFERENCIA', c3: 'TRANSFERENCIA' });
    const despesas = ['2026-07', '2026-08', '2026-09'].reduce((s, mes) => s + resumoDoMes(ms, mes).despesas, 0);
    expect(despesas).toBe(30000);
  });

  it('compra de valor igual ao adicionado não é o par: o Pix no crédito sempre cobra algo a mais', () => {
    const ms = montar([
      adicionado('add', 1800),
      cartao({ id: 'loja', descricao: 'Loja Exemplo', valor: 1800 }),
      cartao({ id: 'cob', descricao: 'Pagamento de pix', valor: 2011 }),
    ]);
    expect(natureza(ms)).toMatchObject({ loja: 'DESPESA', cob: 'TRANSFERENCIA' });
  });

  it('sem par não vira transferência: outro dia, valor menor ou bem maior que o adicionado', () => {
    const ms = montar([
      adicionado('add', 10000),
      cartao({ id: 'outroDia', descricao: 'Pagamento de pix', valor: 11200, data: '2026-07-11' }),
      cartao({ id: 'menor', descricao: 'Carla Mendes Lima', valor: 9000 }),
      cartao({ id: 'dobro', descricao: 'Loja Grande', valor: 20000 }),
    ]);
    expect(natureza(ms)).toMatchObject({ outroDia: 'DESPESA', menor: 'DESPESA', dobro: 'DESPESA' });
  });

  it('cada valor adicionado pareia uma cobrança só — a mais próxima do valor', () => {
    const ms = montar([
      adicionado('add', 10000),
      cartao({ id: 'loja', descricao: 'Loja Exemplo', valor: 13000 }),
      cartao({ id: 'cob', descricao: 'Pagamento de pix', valor: 11200 }),
    ]);
    expect(natureza(ms)).toMatchObject({ loja: 'DESPESA', cob: 'TRANSFERENCIA' });
  });

  it('dois Pix no crédito no mesmo dia pareiam cada um com a sua cobrança', () => {
    const ms = montar([
      adicionado('a1', 3600), adicionado('a2', 30518),
      cartao({ id: 'c1', descricao: 'Pagamento de pix', valor: 34088 }),
      cartao({ id: 'c2', descricao: 'Pagamento de pix', valor: 3949 }),
    ]);
    expect(natureza(ms)).toMatchObject({ c1: 'TRANSFERENCIA', c2: 'TRANSFERENCIA' });
  });

  it('cobrança de parcelamento da fatura não rouba o par', () => {
    const ms = montar([
      adicionado('add', 10000),
      cartao({ id: 'pf', descricao: 'Parcelamento de Fatura 2/6', valor: 10500 }),
      cartao({ id: 'cob', descricao: 'Carla Mendes Lima', valor: 11200 }),
    ]);
    expect(natureza(ms)).toMatchObject({ pf: 'TRANSFERENCIA', cob: 'TRANSFERENCIA' });
  });
});
