import {
  candidatosDaConta, conciliarContas, palavrasSignificativas, proximoVencimento, situacaoDaConta, toleranciaDeValor,
  vencimentosDeCartao, type ContaConciliavel, type MovimentoConciliavel,
} from './contas-a-pagar';

const HOJE = '2026-10-02';

const conta = (p: Partial<ContaConciliavel> = {}): ContaConciliavel => ({
  id: 'luz', descricao: 'Conta de luz', valor: 15000, vencimento: '2026-10-10', textoNoExtrato: 'enel',
  pagaEm: null, movimentoId: null, recusados: [], ...p,
});

const mov = (p: Partial<MovimentoConciliavel> = {}): MovimentoConciliavel => ({
  id: 'm1', data: '2026-10-08', descricao: 'Pagamento de boleto|ENEL DISTRIBUICAO SAO PAULO', estabelecimento: null,
  contraparteNome: null, valor: 15000, natureza: 'DESPESA', pendente: false, tipoConta: 'CONTA', ...p,
});

describe('situacaoDaConta', () => {
  it('paga quando tem data de pagamento, mesmo vencida', () => {
    expect(situacaoDaConta({ vencimento: '2026-09-01', pagaEm: '2026-09-02' }, HOJE)).toBe('paga');
  });

  it('atrasada só depois do dia do vencimento', () => {
    expect(situacaoDaConta({ vencimento: '2026-10-01', pagaEm: null }, HOJE)).toBe('atrasada');
    expect(situacaoDaConta({ vencimento: HOJE, pagaEm: null }, HOJE)).toBe('aberta');
    expect(situacaoDaConta({ vencimento: '2026-10-20', pagaEm: null }, HOJE)).toBe('aberta');
  });
});

describe('proximoVencimento', () => {
  it('mensal mantém o dia', () => {
    expect(proximoVencimento('2026-10-10', 'mensal')).toBe('2026-11-10');
    expect(proximoVencimento('2026-12-05', 'mensal')).toBe('2027-01-05');
  });

  it('mensal no dia 31 cai no último dia dos meses curtos e volta ao 31 depois', () => {
    expect(proximoVencimento('2026-01-31', 'mensal', 31)).toBe('2026-02-28');
    expect(proximoVencimento('2026-02-28', 'mensal', 31)).toBe('2026-03-31');
    expect(proximoVencimento('2026-03-31', 'mensal', 31)).toBe('2026-04-30');
    expect(proximoVencimento('2028-01-31', 'mensal', 31)).toBe('2028-02-29');
  });

  it('anual vai para o mesmo dia do ano seguinte (29/02 vira 28/02)', () => {
    expect(proximoVencimento('2026-03-15', 'anual')).toBe('2027-03-15');
    expect(proximoVencimento('2028-02-29', 'anual')).toBe('2029-02-28');
    expect(proximoVencimento('2031-02-28', 'anual', 29)).toBe('2032-02-29');
  });

  it('conta que não repete não tem próxima', () => {
    expect(proximoVencimento('2026-10-10', 'nao')).toBeNull();
  });
});

describe('toleranciaDeValor', () => {
  it('10% para cima ou para baixo; exato abaixo de R$ 10', () => {
    expect(toleranciaDeValor(15000)).toBe(1500);
    expect(toleranciaDeValor(1000)).toBe(100);
    expect(toleranciaDeValor(990)).toBe(0);
  });
});

describe('palavrasSignificativas', () => {
  it('ignora acento, caixa, palavras curtas e genéricas', () => {
    expect([...palavrasSignificativas('Conta de Água — SABESP')]).toEqual(['agua', 'sabesp']);
    expect([...palavrasSignificativas('Mensalidade da academia')]).toEqual(['academia']);
  });
});

describe('candidatosDaConta', () => {
  it('acha o débito pelo texto do extrato, sem acento nem caixa', () => {
    expect(candidatosDaConta(conta({ textoNoExtrato: 'Enél' }), [mov()], new Set()).map((m) => m.id)).toEqual(['m1']);
  });

  it('procura também no estabelecimento e na contraparte', () => {
    const m = mov({ descricao: 'Boleto pago', estabelecimento: null, contraparteNome: 'Enel Distribuição' });
    expect(candidatosDaConta(conta(), [m], new Set())).toHaveLength(1);
  });

  it('sem texto do extrato, basta uma palavra significativa da descrição', () => {
    const c = conta({ descricao: 'Netflix', textoNoExtrato: null, valor: 5590 });
    expect(candidatosDaConta(c, [mov({ descricao: 'NETFLIX.COM', valor: 5590, tipoConta: 'CARTAO' })], new Set())).toHaveLength(1);
    expect(candidatosDaConta(conta({ textoNoExtrato: null }), [mov()], new Set())).toHaveLength(0);
  });

  it('valor fora de ±10% não paga', () => {
    expect(candidatosDaConta(conta(), [mov({ valor: 16500 })], new Set())).toHaveLength(1);
    expect(candidatosDaConta(conta(), [mov({ valor: 16501 })], new Set())).toHaveLength(0);
    expect(candidatosDaConta(conta(), [mov({ valor: 13499 })], new Set())).toHaveLength(0);
  });

  it('conta pequena exige o valor exato', () => {
    const c = conta({ valor: 990, textoNoExtrato: 'spotify' });
    expect(candidatosDaConta(c, [mov({ descricao: 'Spotify', valor: 990 })], new Set())).toHaveLength(1);
    expect(candidatosDaConta(c, [mov({ descricao: 'Spotify', valor: 1000 })], new Set())).toHaveLength(0);
  });

  it('janela de 10 dias antes a 15 depois do vencimento', () => {
    const datas = ['2026-09-29', '2026-09-30', '2026-10-25', '2026-10-26'];
    const achados = datas.filter((data) => candidatosDaConta(conta(), [mov({ data })], new Set()).length > 0);
    expect(achados).toEqual(['2026-09-30', '2026-10-25']);
  });

  it('só despesa: pagamento de fatura, transferência e investimento nunca pagam conta', () => {
    for (const natureza of ['PAGAMENTO_FATURA', 'TRANSFERENCIA', 'INVESTIMENTO', 'RECEITA', 'ESTORNO'] as const) {
      expect(candidatosDaConta(conta(), [mov({ natureza })], new Set())).toHaveLength(0);
    }
  });

  it('compra no cartão paga (assinatura); agendamento pendente na conta ainda não', () => {
    expect(candidatosDaConta(conta(), [mov({ tipoConta: 'CARTAO', pendente: true })], new Set())).toHaveLength(1);
    expect(candidatosDaConta(conta(), [mov({ pendente: true })], new Set())).toHaveLength(0);
  });

  it('movimento já ligado a outra conta ou recusado pela pessoa fica de fora', () => {
    expect(candidatosDaConta(conta(), [mov()], new Set(['m1']))).toHaveLength(0);
    expect(candidatosDaConta(conta({ recusados: ['m1'] }), [mov()], new Set())).toHaveLength(0);
  });

  it('no modo amplo (escolha à mão) basta o valor ou o texto, recusados voltam e o texto pesa mais', () => {
    const outro = mov({ id: 'm2', descricao: 'Pix enviado|Fulano', valor: 15000 });
    const caro = mov({ id: 'm3', valor: 30000 });
    const r = candidatosDaConta(conta({ recusados: ['m1'] }), [mov(), outro, caro], new Set(), 'amplo');
    expect(r.map((m) => m.id)).toEqual(['m1', 'm3', 'm2']);
  });
});

describe('conciliarContas', () => {
  it('liga o único candidato e marca paga na data do movimento', () => {
    expect(conciliarContas([conta()], [mov()])).toEqual([{ contaId: 'luz', movimentoId: 'm1', data: '2026-10-08' }]);
  });

  it('dois candidatos: ambíguo, não liga nada', () => {
    expect(conciliarContas([conta()], [mov(), mov({ id: 'm2', data: '2026-10-09' })])).toEqual([]);
  });

  it('o mesmo movimento servindo a duas contas abertas: ambíguo', () => {
    const contas = [conta(), conta({ id: 'luz2', vencimento: '2026-10-12' })];
    expect(conciliarContas(contas, [mov()])).toEqual([]);
  });

  it('conta paga não concilia de novo, e o movimento dela não serve a outra', () => {
    const paga = conta({ id: 'paga', pagaEm: '2026-10-08', movimentoId: 'm1' });
    expect(conciliarContas([paga, conta()], [mov()])).toEqual([]);
  });

  it('cada conta com o seu: duas ligações de uma vez', () => {
    const agua = conta({ id: 'agua', descricao: 'Água', textoNoExtrato: 'sabesp', valor: 8000 });
    const r = conciliarContas([conta(), agua], [mov(), mov({ id: 'm2', descricao: 'SABESP', valor: 8200 })]);
    expect(r).toEqual([
      { contaId: 'luz', movimentoId: 'm1', data: '2026-10-08' },
      { contaId: 'agua', movimentoId: 'm2', data: '2026-10-08' },
    ]);
  });
});

describe('vencimentosDeCartao', () => {
  const fatura = (p: Partial<Parameters<typeof vencimentosDeCartao>[0][number]['faturas'][number]>) => ({
    contaId: 'nu', mes: '2026-10', vencimento: '2026-10-15', total: 120000, pago: 0, situacao: 'ABERTA' as const, ...p,
  });
  const ciclos = new Map([['nu', { fechamento: '2026-10-08', vencimento: '2026-10-15' }]]);

  it('fechada a pagar e aberta, com o fechamento do banco ou estimado pelo ciclo', () => {
    const r = vencimentosDeCartao(
      [{ contaId: 'nu', nome: 'Nubank', faturas: [
        fatura({ mes: '2026-09', vencimento: '2026-09-15', situacao: 'PAGA', pago: 120000 }),
        fatura({ mes: '2026-10', vencimento: '2026-10-15', situacao: 'FECHADA', pago: 20000 }),
        fatura({ mes: '2026-11', vencimento: '2026-11-15', situacao: 'ABERTA', total: 30000 }),
        fatura({ mes: '2026-12', vencimento: '2026-12-15', situacao: 'FUTURA' }),
      ] }],
      ciclos, new Map([['nu|2026-10', '2026-10-07']]), HOJE,
    );
    expect(r).toEqual([
      { contaId: 'nu', cartao: 'Nubank', mes: '2026-10', fechamento: '2026-10-07', vencimento: '2026-10-15', valor: 100000, situacao: 'FECHADA' },
      { contaId: 'nu', cartao: 'Nubank', mes: '2026-11', fechamento: '2026-11-08', vencimento: '2026-11-15', valor: 30000, situacao: 'ABERTA' },
    ]);
  });

  it('fechada já quitada ou esquecida há mais de 40 dias não aparece', () => {
    const r = vencimentosDeCartao(
      [{ contaId: 'nu', nome: 'Nubank', faturas: [
        fatura({ situacao: 'FECHADA', pago: 120000 }),
        fatura({ mes: '2026-07', vencimento: '2026-07-15', situacao: 'FECHADA' }),
      ] }],
      ciclos, new Map(), HOJE,
    );
    expect(r).toEqual([]);
  });
});
