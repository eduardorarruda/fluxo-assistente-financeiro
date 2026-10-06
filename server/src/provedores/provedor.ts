import type { Caixinha, Conta, Dia, Fatura, Investimento, Transacao } from '../domain/types';

export interface DadosDaConexao {
  conexao: {
    id: string;
    nome: string;
    conectorId: number | null;
    logoUrl: string | null;
    cor: string | null;
    situacao: string;
    erro: string | null;
    atualizadaNoBanco: string | null;
    consentimentoExpira: string | null;
  };
  contas: Conta[];
  caixinhas: Caixinha[];
  investimentos: Investimento[];
  transacoes: Transacao[];
  faturas: Fatura[];
  /**
   * A partir de que dia as transações de cada conta vieram completas. É o que
   * autoriza a sincronização a apagar o que sumiu: fora da janela, nada é apagado.
   */
  janelas: Record<string, Dia>;
}

export interface ProvedorFinanceiro {
  readonly nome: 'pluggy' | 'demo';
  /** Busca tudo de uma conexão. `desde` por tipo de conta: o cartão pede mais histórico. */
  buscar(conexaoId: string, desde: { conta: Dia; cartao: Dia }): Promise<DadosDaConexao>;
  /** Pede ao banco dados novos (quando o provedor suporta). */
  pedirAtualizacao?(conexaoId: string): Promise<void>;
  remover?(conexaoId: string): Promise<void>;
}
