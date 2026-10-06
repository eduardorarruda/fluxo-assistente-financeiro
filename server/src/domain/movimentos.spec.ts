import { competencia } from './competencia';
import { inferirDatasDeCompra, montarMovimentos } from './movimentos';
import { cartao, transacao } from './testing/fabrica';

const ctx = { documentosDoTitular: [], nomesDoTitular: [] };

describe('montarMovimentos', () => {
  it('categoria manual de gasto não vale numa receita (e vice-versa)', () => {
    const [m] = montarMovimentos(
      [transacao({ id: 'x', sentido: 'ENTRADA', descricao: 'Salario' })],
      ctx,
      [],
      new Map([['x', { natureza: null, categoriaId: 'mercado', nota: null, ignorar: false }]]),
    );
    expect(m?.natureza).toBe('RECEITA');
    expect(m?.categoriaId).toBe('salario');
  });

  it('categoria manual do grupo certo vale', () => {
    const [m] = montarMovimentos(
      [cartao({ id: 'x', descricao: 'Padaria' })],
      ctx,
      [],
      new Map([['x', { natureza: null, categoriaId: 'mercado', nota: null, ignorar: false }]]),
    );
    expect(m?.categoriaId).toBe('mercado');
  });
});

describe('inferirDatasDeCompra', () => {
  const parcela = (id: string, numero: number, data: string) =>
    cartao({ id, descricao: 'Loja TV', valor: 10000, data, parcela: { numero, total: 3, valorTotal: 30000, dataCompra: null } });

  it('parcelas sem data de compra, todas com a mesma data: a data é a da compra', () => {
    const ts = inferirDatasDeCompra([parcela('a', 1, '2026-07-10'), parcela('b', 2, '2026-07-10'), parcela('c', 3, '2026-07-10')]);
    expect(ts.map((t) => competencia(t))).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('parcelas sem data de compra já espalhadas pelos meses ficam onde estão', () => {
    const ts = inferirDatasDeCompra([parcela('a', 1, '2026-07-10'), parcela('b', 2, '2026-08-10'), parcela('c', 3, '2026-09-10')]);
    expect(ts.map((t) => competencia(t))).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('parcela sozinha, sem irmãs, fica na própria data', () => {
    const [t] = inferirDatasDeCompra([parcela('a', 2, '2026-07-10')]);
    expect(competencia(t!)).toBe('2026-07');
  });
});

describe('transferências entre contas suas: contam quando cruzam a fronteira do Fluxo', () => {
  const titular = { documentosDoTitular: ['12345678900'], nomesDoTitular: ['fulano de tal'] };
  const propria = (p: Partial<Parameters<typeof transacao>[0]>) =>
    transacao({ descricao: 'Transferência Recebida|FULANO DE TAL', contraparteNome: 'FULANO DE TAL', contraparteDocumento: '123.456.789-00', meioPagamento: 'PIX', categoriaProvedor: 'Same person transfer', ...p });
  const montar = (ts: Parameters<typeof montarMovimentos>[0], regras: Parameters<typeof montarMovimentos>[2] = []) =>
    new Map(montarMovimentos(ts, titular, regras, new Map()).map((m) => [m.id, m]));

  it('salário que vem de outra conta sua (outro banco) entra como receita, na categoria Salário', () => {
    const m = montar([propria({ id: 'sal', sentido: 'ENTRADA', valor: 313600, data: '2025-11-07' })]).get('sal');
    expect(m).toMatchObject({ natureza: 'RECEITA', categoriaId: 'salario' });
  });

  it('o que vai para uma conta sua fora do Fluxo conta como saída', () => {
    const m = montar([propria({ id: 'ida', sentido: 'SAIDA', valor: 120000, descricao: 'Transferência enviada|Fulano de Tal' })]).get('ida');
    expect(m?.natureza).toBe('DESPESA');
  });

  it('ida e volta do mesmo valor em até 5 dias continua neutra (dinheiro seu trocando de lugar)', () => {
    const ms = montar([
      propria({ id: 'sai', sentido: 'SAIDA', valor: 232773, data: '2026-04-09', descricao: 'Transferência enviada|Fulano de Tal' }),
      propria({ id: 'volta', sentido: 'ENTRADA', valor: 232773, data: '2026-04-09' }),
      propria({ id: 'salario', sentido: 'ENTRADA', valor: 417916, data: '2026-04-09' }),
    ]);
    expect(ms.get('sai')?.natureza).toBe('TRANSFERENCIA');
    expect(ms.get('volta')?.natureza).toBe('TRANSFERENCIA');
    expect(ms.get('salario')?.natureza).toBe('RECEITA');
  });

  it('pares são um para um: duas entradas iguais e uma saída deixam uma entrada contando', () => {
    const ms = montar([
      propria({ id: 'e1', sentido: 'ENTRADA', valor: 2400, data: '2026-09-08' }),
      propria({ id: 'e2', sentido: 'ENTRADA', valor: 2400, data: '2026-09-20' }),
      propria({ id: 's', sentido: 'SAIDA', valor: 2400, data: '2026-09-07' }),
    ]);
    expect(ms.get('e1')?.natureza).toBe('TRANSFERENCIA');
    expect(ms.get('s')?.natureza).toBe('TRANSFERENCIA');
    expect(ms.get('e2')?.natureza).toBe('RECEITA');
  });

  it('volta depois da janela de 5 dias: as duas contam', () => {
    const ms = montar([
      propria({ id: 's', sentido: 'SAIDA', valor: 200, data: '2026-02-20' }),
      propria({ id: 'e', sentido: 'ENTRADA', valor: 200, data: '2026-02-27' }),
    ]);
    expect([ms.get('s')?.natureza, ms.get('e')?.natureza]).toEqual(['DESPESA', 'RECEITA']);
  });

  it('o Pix no crédito ("Valor adicionado na conta por cartão de crédito") não vira renda', () => {
    const m = montar([propria({ id: 'pix', sentido: 'ENTRADA', descricao: 'Valor adicionado na conta por cartão de crédito', valor: 5000 })]).get('pix');
    expect(m?.natureza).toBe('TRANSFERENCIA');
  });

  it('Pix da empresa da pessoa (CNPJ com o nome dela) é Salário; regra do usuário ainda manda', () => {
    const pj = transacao({
      id: 'pj', sentido: 'ENTRADA', valor: 700000, descricao: 'Transferência Recebida|12.345.678 FULANO DE TAL',
      contraparteNome: '12.345.678 FULANO DE TAL', contraparteDocumento: '12.345.678/0001-90', meioPagamento: 'PIX', categoriaProvedor: 'Transfers',
    });
    expect(montar([pj]).get('pj')).toMatchObject({ natureza: 'RECEITA', categoriaId: 'salario' });
    const regra = { id: 'r', texto: '12.345.678', categoriaId: 'renda-extra', sentido: null, prioridade: 1, criadaEm: '2026-01-01' };
    expect(montar([pj], [regra]).get('pj')?.categoriaId).toBe('renda-extra');
  });

  it('CNPJ de terceiro com nome parecido não vira salário', () => {
    const loja = transacao({
      id: 'l', sentido: 'ENTRADA', valor: 5000, descricao: 'Transferência Recebida|ACME LTDA',
      contraparteNome: 'ACME LTDA', contraparteDocumento: '99.888.777/0001-66', meioPagamento: 'PIX', categoriaProvedor: 'Transfers',
    });
    expect(montar([loja]).get('l')?.categoriaId).not.toBe('salario');
  });
});
