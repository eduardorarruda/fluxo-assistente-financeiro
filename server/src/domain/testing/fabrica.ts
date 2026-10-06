import type { Conta, Transacao } from '../types';

/** Fábrica de dados de teste: só o que importa para o caso fica explícito. */
export function transacao(parcial: Partial<Transacao> = {}): Transacao {
  return {
    id: 't1',
    contaId: 'conta',
    tipoConta: 'CONTA',
    data: '2026-07-10',
    descricao: 'Compra',
    descricaoOriginal: null,
    valor: 1000,
    sentido: 'SAIDA',
    pendente: false,
    categoriaProvedor: null,
    categoriaProvedorId: null,
    estabelecimento: null,
    cnpjEstabelecimento: null,
    contraparteNome: null,
    contraparteDocumento: null,
    meioPagamento: null,
    parcela: null,
    faturaId: null,
    faturaPrevista: null,
    outroCredito: null,
    ...parcial,
  };
}

export function cartao(parcial: Partial<Transacao> = {}): Transacao {
  return transacao({ contaId: 'cartao', tipoConta: 'CARTAO', ...parcial });
}

export function conta(parcial: Partial<Conta> = {}): Conta {
  return {
    id: 'conta',
    conexaoId: 'c1',
    tipo: 'CONTA',
    nome: 'Conta',
    numero: null,
    instituicao: 'Nubank',
    saldo: 0,
    titular: 'Fulano de Tal',
    documentoTitular: '123.456.789-09',
    limite: null,
    limiteDisponivel: null,
    fechamento: null,
    vencimento: null,
    ...parcial,
  };
}
