import { categorizar, type Regra } from './categorizacao';
import { cartao, transacao } from './testing/fabrica';

describe('categorizar', () => {
  it('reconhece estabelecimentos conhecidos pela descrição', () => {
    expect(categorizar(cartao({ descricao: 'IFOOD *IFOOD' }), 'DESPESA', [])).toBe('delivery');
    expect(categorizar(cartao({ descricao: 'Uber *Trip' }), 'DESPESA', [])).toBe('transporte');
    expect(categorizar(cartao({ descricao: 'Uber Eats' }), 'DESPESA', [])).toBe('delivery');
    expect(categorizar(cartao({ descricao: 'NETFLIX.COM' }), 'DESPESA', [])).toBe('assinaturas');
    expect(categorizar(cartao({ descricao: 'Drogasil 123' }), 'DESPESA', [])).toBe('saude');
  });

  it('Mercado Livre é compra, não mercado', () => {
    expect(categorizar(cartao({ descricao: 'MERCADOLIVRE*LOJA' }), 'DESPESA', [])).toBe('compras');
    expect(categorizar(cartao({ descricao: 'Mercado Livre' }), 'DESPESA', [])).toBe('compras');
    expect(categorizar(cartao({ descricao: 'Supermercado Dia' }), 'DESPESA', [])).toBe('mercado');
  });

  it('usa a categoria do provedor quando a descrição não diz nada', () => {
    expect(categorizar(cartao({ descricao: 'XPTO LTDA', categoriaProvedor: 'Groceries' }), 'DESPESA', [])).toBe('mercado');
    expect(categorizar(cartao({ descricao: 'XPTO', categoriaProvedor: 'Gas stations' }), 'DESPESA', [])).toBe('carro');
    expect(categorizar(cartao({ descricao: 'XPTO', categoriaProvedor: 'Electricity' }), 'DESPESA', [])).toBe('contas');
  });

  it('"gas" de conta de gás não confunde com posto de gasolina', () => {
    expect(categorizar(transacao({ descricao: 'Comgas', categoriaProvedor: 'Gas' }), 'DESPESA', [])).toBe('contas');
  });

  it('Pix separa enviado de recebido', () => {
    expect(categorizar(transacao({ descricao: 'Pix', categoriaProvedor: 'Transfer - PIX' }), 'DESPESA', []))
      .toBe('pix-enviado');
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'Pix recebido' }), 'RECEITA', []))
      .toBe('pix-recebido');
  });

  it('receitas: salário, rendimento, reembolso', () => {
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'Salario ACME' }), 'RECEITA', [])).toBe('salario');
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'XPTO', categoriaProvedor: 'Salary' }), 'RECEITA', []))
      .toBe('salario');
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'Rendimento' }), 'RECEITA', [])).toBe('rendimentos');
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'Estorno' }), 'RECEITA', [])).toBe('reembolsos');
  });

  it('estorno no cartão fica na categoria da loja, para abater o gasto certo', () => {
    expect(categorizar(cartao({ sentido: 'ENTRADA', descricao: 'Estorno Amazon' }), 'ESTORNO', [])).toBe('compras');
  });

  it('cai em "outros" quando nada casa', () => {
    expect(categorizar(cartao({ descricao: 'ABC 123' }), 'DESPESA', [])).toBe('outros');
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'ABC' }), 'RECEITA', [])).toBe('outras-receitas');
  });

  it('regra do usuário vence tudo, respeitando sentido e ordem de prioridade', () => {
    const regras: Regra[] = [
      { id: 'r1', texto: 'padaria do ze', categoriaId: 'mercado', sentido: 'SAIDA', prioridade: 2 },
      { id: 'r2', texto: 'ze', categoriaId: 'lazer', sentido: null, prioridade: 1 },
    ];
    expect(categorizar(cartao({ descricao: 'PADARIA DO ZÉ' }), 'DESPESA', regras)).toBe('lazer');
    expect(categorizar(cartao({ descricao: 'PADARIA DO ZÉ' }), 'DESPESA', [regras[0]!])).toBe('mercado');
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'padaria do ze' }), 'RECEITA', [regras[0]!]))
      .toBe('outras-receitas');
  });

  it('regra que aponta para categoria do grupo errado é ignorada', () => {
    const regras: Regra[] = [{ id: 'r', texto: 'salario', categoriaId: 'mercado', sentido: null, prioridade: 1 }];
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'Salario' }), 'RECEITA', regras)).toBe('salario');
  });

  it('naturezas que não são gasto nem ganho não têm categoria', () => {
    expect(categorizar(transacao({ descricao: 'Pagamento de fatura' }), 'PAGAMENTO_FATURA', [])).toBeNull();
    expect(categorizar(transacao({ descricao: 'Aplicação RDB' }), 'INVESTIMENTO', [])).toBeNull();
    expect(categorizar(transacao({ descricao: 'Pix' }), 'TRANSFERENCIA', [])).toBeNull();
  });
  it('posto do Carrefour é combustível, não mercado', () => {
    expect(categorizar(cartao({ descricao: 'Carrefour Posto Pgs', categoriaProvedor: 'Gas stations' }), 'DESPESA', [])).toBe('carro');
    expect(categorizar(transacao({ descricao: 'Compra no débito|CARREFOUR POSTO PGS', categoriaProvedor: 'Gas stations' }), 'DESPESA', []))
      .toBe('carro');
    expect(categorizar(cartao({ descricao: 'Carrefour Gos', categoriaProvedor: 'Groceries' }), 'DESPESA', [])).toBe('mercado');
  });

  it('99Food é delivery em qualquer meio: cartão, Pix e NuPay', () => {
    expect(categorizar(cartao({ descricao: '99food *House Burger L', estabelecimento: '99 food' }), 'DESPESA', [])).toBe('delivery');
    expect(categorizar(cartao({ descricao: '99Food', categoriaProvedor: 'Vehicle maintenance' }), 'DESPESA', [])).toBe('delivery');
    expect(categorizar(transacao({
      descricao: 'Transferência enviada|99 FOOD LTDA.', estabelecimento: '99 FOOD LTDA.', categoriaProvedor: 'Services',
    }), 'DESPESA', [])).toBe('delivery');
    expect(categorizar(transacao({ descricao: 'Compra no débito via NuPay|99Food', categoriaProvedor: 'Services' }), 'DESPESA', []))
      .toBe('delivery');
  });

  it('reembolso de Pix da 99Food abate delivery', () => {
    expect(categorizar(transacao({ sentido: 'ENTRADA', descricao: 'Reembolso recebido pelo Pix|99 FOOD LTDA.', categoriaProvedor: 'Cashback' }), 'ESTORNO', []))
      .toBe('delivery');
  });

  it('corrida da 99 é transporte', () => {
    expect(categorizar(transacao({
      descricao: 'Compra no débito via NuPay|99', estabelecimento: '99 TECNOLOGIA LTDA', categoriaProvedor: 'Services',
    }), 'DESPESA', [])).toBe('transporte');
    expect(categorizar(transacao({ descricao: 'Transferência enviada|99 TECNOLOGIA LTDA', categoriaProvedor: 'Services' }), 'DESPESA', []))
      .toBe('transporte');
  });

  it('Detran pelo nome completo é carro; Ministério da Fazenda é imposto', () => {
    expect(categorizar(transacao({
      descricao: 'Transferência enviada|DEPARTAMENTO ESTADUAL DE TRANSITO', categoriaProvedor: 'Services',
    }), 'DESPESA', [])).toBe('carro');
    expect(categorizar(transacao({ descricao: 'Transferência enviada|MINISTERIO DA FAZENDA', categoriaProvedor: 'Services' }), 'DESPESA', []))
      .toBe('taxas');
  });
});
