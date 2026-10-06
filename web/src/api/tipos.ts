/** Tipos das respostas da API — espelham server/src (domain e servicos). */

export type Centavos = number;
export type Mes = string;
export type Dia = string;
export type Natureza = 'DESPESA' | 'RECEITA' | 'ESTORNO' | 'PAGAMENTO_FATURA' | 'TRANSFERENCIA' | 'INVESTIMENTO';
export type TipoConta = 'CONTA' | 'POUPANCA' | 'CARTAO';

export interface Categoria {
  id: string;
  nome: string;
  grupo: 'DESPESA' | 'RECEITA';
  cor: string;
  icone: string;
}

export interface Conta {
  id: string;
  conexaoId: string;
  tipo: TipoConta;
  nome: string;
  numero: string | null;
  instituicao: string;
  saldo: Centavos;
  limite: Centavos | null;
  limiteDisponivel: Centavos | null;
  fechamento: Dia | null;
  vencimento: Dia | null;
}

export interface Caixinha {
  id: string;
  contaId: string;
  nome: string;
  valor: Centavos;
  indexador: string | null;
  percentualIndexador: number | null;
}

export interface Movimento {
  id: string;
  contaId: string;
  tipoConta: TipoConta;
  data: Dia;
  descricao: string;
  descricaoOriginal: string | null;
  valor: Centavos;
  sentido: 'ENTRADA' | 'SAIDA';
  pendente: boolean;
  categoriaProvedor: string | null;
  estabelecimento: string | null;
  contraparteNome: string | null;
  meioPagamento: string | null;
  parcela: { numero: number; total: number; valorTotal: Centavos | null; dataCompra: Dia | null } | null;
  natureza: Natureza;
  categoriaId: string | null;
  competencia: Mes;
  nota: string | null;
  editado: boolean;
  ignorado: boolean;
  conta?: string;
}

export interface Conexao {
  id: string;
  provedor: 'pluggy' | 'demo';
  nome: string;
  logoUrl: string | null;
  cor: string | null;
  situacao: string;
  erro: string | null;
  ultimaSincronizacao: string | null;
  atualizadaNoBanco: string | null;
  consentimentoExpira: string | null;
  sincronizando: boolean;
  contas: { id: string; tipo: TipoConta; nome: string; numero: string | null; saldo: Centavos }[];
}

export interface Estado {
  hoje: Dia;
  mesAtual: Mes;
  mesesDisponiveis: Mes[];
  pluggyConfigurada: boolean;
  pluggySandbox: boolean;
  demonstracao: boolean;
  configuracoes: { caixinhasNoSaldo: boolean; demoDispensada: boolean };
  conexoes: Conexao[];
}

export interface Patrimonio {
  contas: Centavos;
  caixinhas: Centavos;
  investimentos: Centavos;
  faturaAberta: Centavos;
  total: Centavos;
  duplicados: string[];
}

export interface TotalCategoria {
  categoriaId: string;
  valor: Centavos;
  quantidade: number;
}

export interface Resumo {
  mes: Mes;
  receitas: Centavos;
  despesas: Centavos;
  guardado: Centavos;
  resultado: Centavos;
  porCategoria: TotalCategoria[];
  receitasPorCategoria: TotalCategoria[];
}

export interface FluxoCaixa {
  mes: Mes;
  entradas: { receitas: Centavos; resgates: Centavos; transferencias: Centavos; estornos: Centavos };
  saidas: { despesas: Centavos; faturas: Centavos; guardado: Centavos; transferencias: Centavos };
  variacao: Centavos;
}

export type Gravidade = 'INFO' | 'ATENCAO' | 'CRITICO';
export interface Alerta {
  id: string;
  gravidade: Gravidade;
  titulo: string;
  detalhe: string;
  destino: string;
}

export interface FaturaMes {
  contaId: string;
  mes: Mes;
  vencimento: Dia;
  total: Centavos;
  somaItens: Centavos;
  pago: Centavos;
  quantidade: number;
  situacao: 'PAGA' | 'FECHADA' | 'ABERTA' | 'FUTURA';
  /** Como a fatura PAGA deixou de estar a pagar: paga, parcelada ou com o saldo levado para a seguinte. */
  quitacao?: 'PAGAMENTO' | 'PARCELAMENTO' | 'PROXIMA_FATURA' | null;
  porCategoria: { categoriaId: string; valor: Centavos }[];
}

export interface Parcelamento {
  chave: string;
  descricao: string;
  categoriaId: string | null;
  valorParcela: Centavos;
  parcelaAtual: number;
  totalParcelas: number;
  restante: Centavos;
  valorTotal: Centavos;
  ultimaFatura: Mes;
}

export interface VisaoCartao {
  contaId: string;
  nome: string;
  limite: Centavos | null;
  disponivel: Centavos | null;
  usado: Centavos | null;
  faturaAtual: Mes;
  faturas: FaturaMes[];
  parcelamentos: Parcelamento[];
  compromissoFuturo: Centavos;
}

export interface Recorrencia {
  chave: string;
  nome: string;
  categoriaId: string | null;
  valorTipico: Centavos;
  ultimoValor: Centavos;
  ultimaData: Dia;
  proximaData: Dia;
  meses: number;
  custoAnual: Centavos;
  ativa: boolean;
  aumento: { de: Centavos; para: Centavos } | null;
}

export interface LinhaOrcamento {
  categoriaId: string;
  limite: Centavos;
  gasto: Centavos;
  restante: Centavos;
  percentual: number;
  situacao: 'TRANQUILO' | 'ATENCAO' | 'ESTOUROU';
  esperadoAteHoje: Centavos;
  projecao: Centavos;
}

export interface VisaoGeral {
  mes: Mes;
  patrimonio: Patrimonio;
  evolucao: { mes: Mes; contas: Centavos; caixinhas: Centavos; investimentos: Centavos; total: Centavos }[];
  resumo: Resumo;
  anterior: { receitas: Centavos; despesas: Centavos; guardado: Centavos; resultado: Centavos };
  caixa: FluxoCaixa;
  serieMensal: { mes: Mes; receitas: Centavos; despesas: Centavos; guardado: Centavos; resultado: Centavos }[];
  categorias: TotalCategoria[];
  contas: Conta[];
  caixinhas: Caixinha[];
  cartoes: {
    contaId: string;
    nome: string;
    limite: Centavos | null;
    disponivel: Centavos | null;
    usado: Centavos | null;
    faturaAberta: FaturaMes | null;
    faturaFechada: FaturaMes | null;
    compromissoFuturo: Centavos;
  }[];
  orcamento: LinhaOrcamento[];
  proximas: Recorrencia[];
  alertas: Alerta[];
  ultimos: Movimento[];
}

export interface NoSankey {
  id: string;
  nome: string;
  lado: 'ORIGEM' | 'CENTRO' | 'DESTINO';
  cor: string;
  icone: string;
  valor: Centavos;
}

export interface Fluxo {
  mes: Mes;
  resumo: Resumo;
  sankey: {
    nos: NoSankey[];
    ligacoes: { origem: string; destino: string; valor: Centavos }[];
    total: Centavos;
    /** Resgate das caixinhas além do que faltou no mês (pagou coisa de outro mês). */
    resgateForaDoMes: Centavos;
  };
  caixa: FluxoCaixa;
}

export interface PaginaMovimentos {
  total: number;
  pagina: number;
  paginas: number;
  entradas: Centavos;
  saidas: Centavos;
  itens: Movimento[];
}

export interface Caixinhas {
  total: Centavos;
  investimentos: Centavos;
  rendimentoEstimadoMes: Centavos;
  caixinhas: (Caixinha & { serie: { mes: Mes; valor: Centavos | null }[]; metas: string[] })[];
  listaInvestimentos: {
    id: string;
    nome: string;
    tipo: string;
    subtipo: string | null;
    saldo: Centavos;
    valorAplicado: Centavos | null;
    rendimento: Centavos | null;
    vencimento: Dia | null;
    taxa: number | null;
    indexador: string | null;
    duplicado: boolean;
  }[];
}

export interface Orcamento {
  mes: Mes;
  linhas: LinhaOrcamento[];
  semLimite: { categoriaId: string; gasto: Centavos; sugestao: Centavos }[];
  totalLimite: Centavos;
  totalGasto: Centavos;
  receitas: Centavos;
}

export interface Meta {
  id: string;
  nome: string;
  alvo: Centavos;
  prazo: Mes | null;
  caixinhaId: string | null;
  valorManual: Centavos;
  icone: string;
  cor: string;
  caixinhaNome: string | null;
  progresso: {
    atual: Centavos;
    falta: Centavos;
    percentual: number;
    concluida: boolean;
    porMes: Centavos | null;
    ritmoMensal: Centavos | null;
    previsao: Mes | null;
    noRitmo: boolean | null;
  };
}

export interface Insights {
  mes: Mes;
  variacoes: { categoriaId: string; atual: Centavos; anterior: Centavos; media3: Centavos; delta: Centavos }[];
  maioresGastos: Pick<Movimento, 'id' | 'data' | 'descricao' | 'valor' | 'categoriaId' | 'tipoConta'>[];
  estabelecimentos: { nome: string; categoriaId: string | null; total: Centavos; vezes: number }[];
  ritmo: { dia: number; atual: Centavos | null; anterior: Centavos }[];
  porDiaDaSemana: Centavos[];
  quantidade: number;
  ticketMedio: Centavos;
  mediaDiaria: Centavos;
}

export interface Regra {
  id: string;
  texto: string;
  categoriaId: string;
  sentido: 'ENTRADA' | 'SAIDA' | null;
  prioridade: number;
}

export interface Sincronizacao {
  id: number;
  conexaoId: string;
  inicio: string;
  fim: string | null;
  situacao: 'RODANDO' | 'OK' | 'ERRO';
  novas: number;
  atualizadas: number;
  removidas: number;
  erro: string | null;
}

// ------------------------------------------------------------ contas a pagar

export type Repeticao = 'nao' | 'mensal' | 'anual';
export type SituacaoConta = 'aberta' | 'paga' | 'atrasada';

export interface ContaAPagar {
  id: string;
  descricao: string;
  valor: Centavos;
  vencimento: Dia;
  repete: Repeticao;
  categoriaId: string | null;
  /** Texto que identifica o débito no extrato; nulo = usa a descrição. */
  textoNoExtrato: string | null;
  situacao: SituacaoConta;
  pagaEm: Dia | null;
  movimentoId: string | null;
  origem: 'pessoa' | 'assistente';
  nota: string | null;
  criadaEm: string;
  atualizadaEm: string;
  /** O movimento que pagou (nulo se aberta, paga à mão ou se o banco trocou o id). */
  movimento: { id: string; data: Dia; descricao: string; valor: Centavos; conta: string } | null;
}

export interface CandidatoAPagamento {
  id: string;
  data: Dia;
  descricao: string;
  estabelecimento: string | null;
  valor: Centavos;
  conta: string;
  tipoConta: TipoConta;
  /** Casa texto, valor e data: só não foi ligado sozinho porque havia mais de um. */
  forte: boolean;
}

export interface VencimentoDeCartao {
  contaId: string;
  cartao: string;
  mes: Mes;
  fechamento: Dia | null;
  vencimento: Dia;
  valor: Centavos;
  situacao: 'ABERTA' | 'FECHADA';
}
