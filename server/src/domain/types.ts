/**
 * O modelo interno do Fluxo. Tudo que vem de fora (Pluggy ou modo demonstração)
 * é convertido para estes tipos na entrada — daqui para dentro ninguém conhece
 * o formato de nenhum provedor.
 *
 * Dinheiro é sempre inteiro em centavos. Data é sempre 'AAAA-MM-DD' e mês é
 * sempre 'AAAA-MM', ambos no fuso local — comparar strings já ordena certo.
 */

export type Centavos = number;
export type Dia = string; // 'AAAA-MM-DD'
export type Mes = string; // 'AAAA-MM'

export type TipoConta = 'CONTA' | 'POUPANCA' | 'CARTAO';

export interface Conta {
  id: string;
  conexaoId: string;
  tipo: TipoConta;
  nome: string;
  numero: string | null;
  instituicao: string;
  saldo: Centavos; // no cartão: quanto se deve na fatura atual
  titular: string | null;
  documentoTitular: string | null;
  limite: Centavos | null; // só cartão
  limiteDisponivel: Centavos | null; // só cartão
  fechamento: Dia | null; // só cartão: data de fechamento da fatura atual
  vencimento: Dia | null; // só cartão: vencimento da fatura atual
}

export interface Caixinha {
  id: string;
  contaId: string;
  nome: string;
  valor: Centavos;
  indexador: string | null; // 'CDI', 'IPCA'…
  percentualIndexador: number | null; // 1.0 = 100% do CDI
}

export interface Investimento {
  id: string;
  conexaoId: string;
  nome: string;
  tipo: string;
  subtipo: string | null;
  saldo: Centavos;
  valorAplicado: Centavos | null;
  rendimento: Centavos | null;
  vencimento: Dia | null;
  taxa: number | null;
  indexador: string | null;
}

/** Sentido do dinheiro do ponto de vista de quem é dono da conta. */
export type Sentido = 'ENTRADA' | 'SAIDA';

export interface Parcela {
  numero: number;
  total: number;
  valorTotal: Centavos | null;
  dataCompra: Dia | null;
  /**
   * Instante exato da compra (ISO, com hora), igual em todas as parcelas. Identifica a
   * compra melhor que descrição + valor, que mudam entre parcelas. Ausente em dados antigos.
   */
  instanteCompra?: string | null;
}

export interface Transacao {
  id: string;
  contaId: string;
  tipoConta: TipoConta;
  data: Dia;
  descricao: string;
  descricaoOriginal: string | null;
  valor: Centavos; // sempre positivo; a direção está em `sentido`
  sentido: Sentido;
  pendente: boolean;
  categoriaProvedor: string | null;
  categoriaProvedorId: string | null;
  estabelecimento: string | null;
  cnpjEstabelecimento: string | null;
  contraparteNome: string | null;
  contraparteDocumento: string | null;
  meioPagamento: string | null; // 'PIX', 'TED', 'BOLETO'…
  parcela: Parcela | null;
  faturaId: string | null;
  faturaPrevista: Mes | null; // mês da fatura em que o provedor diz que a compra cai
  /** Linha de crédito do cartão que não é compra: rotativo, parcelamento da própria fatura… */
  outroCredito: 'REVOLVING_CREDIT' | 'BILL_INSTALLMENT' | 'LOAN' | 'OTHER' | null;
}

/**
 * O que o movimento é, para fins de conta. Só DESPESA, RECEITA e ESTORNO mexem
 * em "quanto eu ganhei/gastei"; os outros são dinheiro seu trocando de lugar.
 */
export type Natureza =
  | 'DESPESA'
  | 'RECEITA'
  | 'ESTORNO'
  | 'PAGAMENTO_FATURA'
  | 'TRANSFERENCIA'
  | 'INVESTIMENTO';

export interface Fatura {
  id: string;
  contaId: string;
  vencimento: Dia;
  fechamento: Dia | null;
  total: Centavos;
  pagamentoMinimo: Centavos | null;
  pago: Centavos;
}

/** Uma transação depois de classificada e categorizada — o que as telas usam. */
export interface Movimento extends Transacao {
  natureza: Natureza;
  categoriaId: string | null; // nulo para as naturezas que não são gasto/ganho
  competencia: Mes; // mês a que o gasto/ganho pertence
  nota: string | null;
  editado: boolean; // o usuário mexeu na natureza ou na categoria
  ignorado: boolean; // o usuário pediu para tirar das contas
}
