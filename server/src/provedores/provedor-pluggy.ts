import type { PageResponse, PluggyClient } from 'pluggy-sdk';
import type { Dia } from '../domain/types';
import type { DadosDaConexao, ProvedorFinanceiro } from './provedor';
import {
  caixinhasDoNubank, investimentoAtivo, normalizarCaixinhas, normalizarConta, normalizarFatura, normalizarInvestimento, normalizarTransacao,
  semPagamentosPendentesRepetidos,
} from './pluggy-normalizacao';

/** Só o pedaço do PluggyClient que usamos — permite testar com um dublê. */
export type ClientePluggy = Pick<
  PluggyClient,
  | 'fetchItem'
  | 'fetchAccounts'
  | 'fetchAllTransactions'
  | 'fetchCreditCardBills'
  | 'fetchInvestments'
  | 'createConnectToken'
  | 'updateItem'
  | 'deleteItem'
>;

/** Percorre todas as páginas de um endpoint paginado. */
async function todasAsPaginas<T>(buscarPagina: (pagina: number) => Promise<PageResponse<T>>): Promise<T[]> {
  const primeira = await buscarPagina(1);
  const itens = [...primeira.results];
  for (let p = 2; p <= primeira.totalPages; p++) itens.push(...(await buscarPagina(p)).results);
  return itens;
}

export class ProvedorPluggy implements ProvedorFinanceiro {
  readonly nome = 'pluggy' as const;

  constructor(private readonly cliente: ClientePluggy) {}

  /**
   * Token curto (30 min) que o widget Pluggy Connect usa no navegador. É a
   * única credencial que sai do servidor — o client secret nunca.
   */
  async criarTokenDeConexao(itemId?: string): Promise<string> {
    const { accessToken } = await this.cliente.createConnectToken(itemId, {
      clientUserId: 'fluxo-local',
      avoidDuplicates: true,
    });
    return accessToken;
  }

  async buscar(itemId: string, desde: { conta: Dia; cartao: Dia }): Promise<DadosDaConexao> {
    const item = await this.cliente.fetchItem(itemId);
    const instituicao = item.connector.name;
    const contasPluggy = (await this.cliente.fetchAccounts(itemId)).results;

    const dados: DadosDaConexao = {
      conexao: {
        id: item.id,
        nome: instituicao,
        conectorId: item.connector.id,
        logoUrl: item.connector.imageUrl ?? null,
        cor: item.connector.primaryColor ? `#${item.connector.primaryColor.replace(/^#/, '')}` : null,
        situacao: item.status,
        erro: item.error?.message ?? null,
        atualizadaNoBanco: item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toISOString() : null,
        consentimentoExpira: item.consentExpiresAt ? new Date(item.consentExpiresAt).toISOString() : null,
      },
      contas: [],
      caixinhas: [],
      investimentos: [],
      transacoes: [],
      faturas: [],
      janelas: {},
    };

    for (const a of contasPluggy) {
      const conta = normalizarConta(a, item.id, instituicao);
      const inicio = conta.tipo === 'CARTAO' ? desde.cartao : desde.conta;
      dados.contas.push(conta);
      dados.caixinhas.push(...normalizarCaixinhas(a));
      // Só um item que terminou de atualizar garante que a lista está completa.
      if (item.status === 'UPDATED') dados.janelas[conta.id] = inicio;
      const transacoes = await this.cliente.fetchAllTransactions(a.id, { dateFrom: inicio });
      dados.transacoes.push(...semPagamentosPendentesRepetidos(transacoes.map((t) => normalizarTransacao(t, conta.tipo))));
      if (conta.tipo === 'CARTAO') {
        const faturas = await todasAsPaginas((page) => this.cliente.fetchCreditCardBills(a.id, { page }));
        dados.faturas.push(...faturas.map((f) => normalizarFatura(f, conta.id)));
      }
    }

    const investimentos = await todasAsPaginas((page) => this.cliente.fetchInvestments(itemId, undefined, { page }));
    const ativos = investimentos.filter(investimentoAtivo);
    // Se as caixinhas já vieram como saldo reservado da conta, os CDBs ficam como estão.
    const contaCorrente = dados.caixinhas.length === 0 ? (dados.contas.find((c) => c.tipo === 'CONTA')?.id ?? null) : null;
    const { caixinhas, restantes } = caixinhasDoNubank(ativos, item.id, contaCorrente);
    dados.caixinhas.push(...caixinhas);
    dados.investimentos = restantes.map(normalizarInvestimento);
    return dados;
  }

  async pedirAtualizacao(itemId: string): Promise<void> {
    await this.cliente.updateItem(itemId);
  }

  /** Espera o banco terminar de atualizar (ou desistir). Devolve a situação final. */
  async aguardarAtualizacao(itemId: string, limiteMs = 120_000, intervaloMs = 3_000): Promise<string> {
    const fim = Date.now() + limiteMs;
    for (;;) {
      const item = await this.cliente.fetchItem(itemId);
      if (item.status !== 'UPDATING') return item.status;
      if (Date.now() + intervaloMs > fim) return item.status;
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  }

  async remover(itemId: string): Promise<void> {
    await this.cliente.deleteItem(itemId);
  }
}
