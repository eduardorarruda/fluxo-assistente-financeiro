import { abrirBanco } from '../db/conexao';
import { Repositorio } from '../dados/repositorio';
import { conta, transacao } from '../domain/testing/fabrica';
import { relogioFixo } from '../relogio';
import { Financas } from './financas';

const HOJE = '2026-09-24';

function montar() {
  const relogio = relogioFixo(HOJE);
  const repo = new Repositorio(abrirBanco(':memory:'), relogio);
  repo.criarConexao('c1', 'pluggy', 'Banco');
  return { repo, financas: new Financas(repo, relogio) };
}

describe('Financas', () => {
  it('evolução do patrimônio não conta duas vezes a caixinha que também veio como investimento', () => {
    const { repo, financas } = montar();
    repo.aplicarSincronizacao({
      conexao: { id: 'c1', nome: 'Banco', conectorId: 1, logoUrl: null, cor: null, situacao: 'UPDATED', erro: null, atualizadaNoBanco: null, consentimentoExpira: null },
      contas: [conta({ id: 'k', conexaoId: 'c1', saldo: 100000 })],
      caixinhas: [{ id: 'k:viagem', contaId: 'k', nome: 'Viagem', valor: 500000, indexador: 'CDI', percentualIndexador: 1 }],
      investimentos: [{ id: 'inv', conexaoId: 'c1', nome: 'Viagem', tipo: 'FIXED_INCOME', subtipo: 'CDB', saldo: 500000, valorAplicado: null, rendimento: null, vencimento: null, taxa: null, indexador: null }],
      transacoes: [transacao({ contaId: 'k', data: '2026-09-01' })],
      faturas: [],
      janelas: {},
    });
    const v = financas.visaoGeral('2026-09');
    expect(v.patrimonio.total).toBe(600000);
    expect(v.evolucao.at(-1)?.total).toBe(600000);
  });

  it('antes da primeira foto, a caixinha é refeita pelas aplicações e resgates em vez de virar zero', () => {
    const { repo, financas } = montar();
    repo.aplicarSincronizacao({
      conexao: { id: 'c1', nome: 'Banco', conectorId: 1, logoUrl: null, cor: null, situacao: 'UPDATED', erro: null, atualizadaNoBanco: null, consentimentoExpira: null },
      contas: [conta({ id: 'k', conexaoId: 'c1', saldo: 1000 })],
      caixinhas: [{ id: 'k:cx', contaId: 'k', nome: 'Caixinhas', valor: 30000, indexador: 'CDI', percentualIndexador: 1 }],
      investimentos: [],
      transacoes: [
        transacao({ id: 'a', contaId: 'k', data: '2026-08-10', descricao: 'Aplicação RDB', valor: 20000, sentido: 'SAIDA' }),
        transacao({ id: 'r', contaId: 'k', data: '2026-09-05', descricao: 'Resgate RDB', valor: 5000, sentido: 'ENTRADA' }),
      ],
      faturas: [],
      janelas: {},
    });
    const caixinhas = Object.fromEntries(financas.visaoGeral('2026-09').evolucao.map((p) => [p.mes, p.caixinhas]));
    expect(caixinhas['2026-07']).toBe(30000 + 5000 - 20000);
    expect(caixinhas['2026-08']).toBe(30000 + 5000);
    expect(caixinhas['2026-09']).toBe(30000);
    // A caixinha sozinha na conta ganha a mesma série na tela de caixinhas.
    expect(financas.caixinhas().caixinhas[0]?.serie.at(-2)).toEqual({ mes: '2026-08', valor: 35000 });
  });

  it('rendimento estimado usa o CDI mensal bruto atual vezes o percentual da caixinha', () => {
    const { repo, financas } = montar();
    repo.aplicarSincronizacao({
      conexao: { id: 'c1', nome: 'Banco', conectorId: 1, logoUrl: null, cor: null, situacao: 'UPDATED', erro: null, atualizadaNoBanco: null, consentimentoExpira: null },
      contas: [conta({ id: 'k', conexaoId: 'c1', saldo: 0 })],
      caixinhas: [{ id: 'k:cx', contaId: 'k', nome: 'Caixinhas', valor: 100000, indexador: 'CDI', percentualIndexador: 1.15 }],
      investimentos: [], transacoes: [], faturas: [], janelas: {},
    });
    expect(financas.caixinhas().rendimentoEstimadoMes).toBe(Math.round(100000 * 0.0112 * 1.15));
  });

  it('refaz as contas quando o banco muda e reaproveita quando não muda', () => {
    const { repo, financas } = montar();
    const antes = financas.recorrencias();
    expect(financas.recorrencias().itens).toBe(financas.recorrencias().itens);
    repo.definirOrcamento('mercado', 1000);
    expect(financas.orcamento('2026-09').linhas).toHaveLength(1);
    expect(antes.itens).toEqual([]);
  });
});
