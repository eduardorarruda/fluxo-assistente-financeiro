import { abrirBanco } from '../db/conexao';
import type { DadosDaConexao } from '../provedores/provedor';
import { gerarDadosDemo, ID_CONEXAO_DEMO } from '../provedores/provedor-demo';
import { relogioFixo } from '../relogio';
import { transacao } from '../domain/testing/fabrica';
import { Repositorio } from './repositorio';

const HOJE = '2026-09-24';

function novoRepositorio() {
  const repo = new Repositorio(abrirBanco(':memory:'), relogioFixo(HOJE));
  repo.criarConexao(ID_CONEXAO_DEMO, 'demo', 'Nubank');
  return repo;
}

function dadosPequenos(transacoes = [
  transacao({ id: 'a', contaId: 'conta', data: '2026-09-01', descricao: 'Mercado', valor: 1000 }),
  transacao({ id: 'b', contaId: 'conta', data: '2026-09-10', descricao: 'iFood', valor: 2000 }),
  transacao({ id: 'antiga', contaId: 'conta', data: '2026-01-10', descricao: 'Velha', valor: 3000 }),
]): DadosDaConexao {
  return {
    conexao: { id: ID_CONEXAO_DEMO, nome: 'Nubank', conectorId: null, logoUrl: null, cor: null, situacao: 'UPDATED', erro: null, atualizadaNoBanco: null, consentimentoExpira: null },
    contas: [{
      id: 'conta', conexaoId: ID_CONEXAO_DEMO, tipo: 'CONTA', nome: 'NuConta', numero: null, instituicao: 'Nubank', saldo: 5000,
      titular: null, documentoTitular: null, limite: null, limiteDisponivel: null, fechamento: null, vencimento: null,
    }],
    caixinhas: [{ id: 'conta:cx', contaId: 'conta', nome: 'Viagem', valor: 100, indexador: 'CDI', percentualIndexador: 1 }],
    investimentos: [],
    transacoes,
    faturas: [],
    janelas: { conta: '2026-01-01' },
  };
}

describe('Repositorio.aplicarSincronizacao', () => {
  it('grava a demonstração inteira e relê igual', () => {
    const repo = novoRepositorio();
    const dados = gerarDadosDemo(HOJE);
    const r = repo.aplicarSincronizacao(dados);
    const lido = repo.instantaneo();
    expect(r.novas).toBe(dados.transacoes.length);
    expect(lido.transacoes).toHaveLength(dados.transacoes.length);
    expect(lido.contas).toHaveLength(2);
    expect(lido.caixinhas).toHaveLength(3);
    expect(lido.faturas).toHaveLength(dados.faturas.length);
    const original = dados.transacoes.find((t) => t.parcela)!;
    expect(lido.transacoes.find((t) => t.id === original.id)).toEqual(original);
    expect(repo.historico('caixinha').length).toBeGreaterThanOrEqual(14 * 3);
  });

  it('guarda o instante da compra da parcela', () => {
    const repo = novoRepositorio();
    const parcela = { numero: 2, total: 10, valorTotal: null, dataCompra: '2026-09-09', instanteCompra: '2026-09-09T22:07:53.001Z' };
    repo.aplicarSincronizacao(dadosPequenos([transacao({ id: 'p', contaId: 'conta', data: '2026-09-10', parcela })]));
    expect(repo.instantaneo().transacoes.find((t) => t.id === 'p')?.parcela).toEqual(parcela);
  });

  it('sincronizar de novo não duplica nada', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(gerarDadosDemo(HOJE));
    const r = repo.aplicarSincronizacao(gerarDadosDemo(HOJE));
    expect(r.novas).toBe(0);
    expect(r.removidas).toBe(0);
    expect(repo.instantaneo().transacoes).toHaveLength(gerarDadosDemo(HOJE).transacoes.length);
  });

  it('apaga o que sumiu dentro da janela e preserva o que está fora dela', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos());
    const segunda = dadosPequenos([transacao({ id: 'a', contaId: 'conta', data: '2026-09-01', descricao: 'Mercado', valor: 1000 })]);
    segunda.janelas = { conta: '2026-08-01' };
    const r = repo.aplicarSincronizacao(segunda);
    expect(r.removidas).toBe(1);
    expect(repo.instantaneo().transacoes.map((t) => t.id).sort()).toEqual(['a', 'antiga']);
  });

  it('quando o provedor troca o id da transação, a edição do usuário vai junto', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos());
    repo.salvarAjuste('b', { categoriaId: 'restaurantes', nota: 'jantar com a família' });
    const trocada = dadosPequenos([
      transacao({ id: 'a', contaId: 'conta', data: '2026-09-01', descricao: 'Mercado', valor: 1000 }),
      transacao({ id: 'b-novo', contaId: 'conta', data: '2026-09-10', descricao: 'iFood', valor: 2000 }),
      transacao({ id: 'antiga', contaId: 'conta', data: '2026-01-10', descricao: 'Velha', valor: 3000 }),
    ]);
    const r = repo.aplicarSincronizacao(trocada);
    expect(r).toMatchObject({ novas: 1, removidas: 1, ajustesPreservados: 1 });
    expect(repo.instantaneo().ajustes.get('b-novo')).toMatchObject({ categoriaId: 'restaurantes', nota: 'jantar com a família' });
  });

  it('a sincronização nunca mexe em regras, orçamento, metas e configurações', () => {
    const repo = novoRepositorio();
    repo.criarRegra({ id: 'r1', texto: 'padaria', categoriaId: 'mercado', sentido: null });
    repo.definirOrcamento('mercado', 150000);
    repo.salvarMeta({ id: 'm1', nome: 'Viagem', alvo: 1000000, prazo: '2027-06', caixinhaId: 'conta:cx', valorManual: 0, icone: 'aviao', cor: '#22D3EE' });
    repo.salvarConfiguracoes({ caixinhasNoSaldo: true });
    repo.aplicarSincronizacao(dadosPequenos());
    const i = repo.instantaneo();
    expect(i.regras).toHaveLength(1);
    expect(i.orcamentos.get('mercado')).toBe(150000);
    expect(i.metas[0]?.nome).toBe('Viagem');
    expect(i.configuracoes.caixinhasNoSaldo).toBe(true);
  });

  it('caixinha encerrada no banco some na próxima sincronização', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos());
    const sem = dadosPequenos();
    sem.caixinhas = [];
    repo.aplicarSincronizacao(sem);
    expect(repo.instantaneo().caixinhas).toEqual([]);
  });

  it('remover a conexão leva tudo dela junto, inclusive o histórico', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(gerarDadosDemo(HOJE));
    repo.removerConexao(ID_CONEXAO_DEMO);
    const i = repo.instantaneo();
    expect([i.conexoes, i.contas, i.transacoes, i.caixinhas, i.faturas].every((x) => x.length === 0)).toBe(true);
    expect(repo.historico('caixinha')).toEqual([]);
  });
});

describe('Repositorio — dados do usuário', () => {
  it('ajuste vazio é apagado; ajuste em transação inexistente é erro', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos());
    repo.salvarAjuste('a', { ignorar: true });
    expect(repo.instantaneo().ajustes.get('a')?.ignorar).toBe(true);
    repo.salvarAjuste('a', { ignorar: false });
    expect(repo.instantaneo().ajustes.has('a')).toBe(false);
    expect(() => repo.salvarAjuste('nao-existe', { nota: 'x' })).toThrow('Transação não encontrada.');
  });

  it('regras ganham prioridade crescente; orçamento zero remove o limite', () => {
    const repo = novoRepositorio();
    repo.criarRegra({ id: 'r1', texto: 'a', categoriaId: 'mercado', sentido: null });
    const r2 = repo.criarRegra({ id: 'r2', texto: 'b', categoriaId: 'lazer', sentido: 'SAIDA' });
    expect(r2.prioridade).toBe(2);
    repo.removerRegra('r1');
    expect(repo.instantaneo().regras.map((r) => r.id)).toEqual(['r2']);
    repo.definirOrcamento('mercado', 100);
    repo.definirOrcamento('mercado', 0);
    expect(repo.instantaneo().orcamentos.size).toBe(0);
  });

  it('toda escrita muda a versão', () => {
    const repo = novoRepositorio();
    const antes = repo.versao;
    repo.definirOrcamento('lazer', 5000);
    expect(repo.versao).toBeGreaterThan(antes);
  });

  it('log de sincronização', () => {
    const repo = novoRepositorio();
    const id = repo.iniciarLogDeSincronizacao(ID_CONEXAO_DEMO);
    repo.encerrarLogDeSincronizacao(id, { novas: 3, atualizadas: 1, removidas: 0, ajustesPreservados: 0 }, null);
    expect(repo.ultimasSincronizacoes()[0]).toMatchObject({ situacao: 'OK', novas: 3 });
  });
});

describe('Repositorio — casos da revisão', () => {
  it('compra pendente que efetiva com outro valor e outra descrição leva a edição junto (casamento aproximado)', () => {
    const repo = novoRepositorio();
    // Como numa sincronização real: a janela de revisão volta dias antes da compra.
    const antiga = transacao({ id: 'base', contaId: 'conta', data: '2026-08-01', descricao: 'Mercado', valor: 1000 });
    const pendente = transacao({ id: 'p1', contaId: 'conta', data: '2026-09-10', descricao: 'UBER *TRIP PENDING', valor: 2590 });
    const primeira = dadosPequenos([antiga, pendente]);
    primeira.janelas = { conta: '2026-08-01' };
    repo.aplicarSincronizacao(primeira);
    repo.salvarAjuste('p1', { categoriaId: 'lazer', nota: 'show' });
    const efetivada = transacao({ id: 'p2', contaId: 'conta', data: '2026-09-11', descricao: 'UBER *TRIP', valor: 2740 });
    const segunda = dadosPequenos([antiga, efetivada]);
    segunda.janelas = { conta: '2026-08-01' };
    const r = repo.aplicarSincronizacao(segunda);
    expect(r.ajustesPreservados).toBe(1);
    expect(repo.instantaneo().ajustes.get('p2')).toMatchObject({ categoriaId: 'lazer', nota: 'show' });
  });

  it('na dúvida (dois candidatos parecidos), não chuta: a edição espera', () => {
    const repo = novoRepositorio();
    const antiga = transacao({ id: 'base', contaId: 'conta', data: '2026-08-01', descricao: 'Mercado', valor: 1000 });
    repo.aplicarSincronizacao(dadosPequenos([antiga, transacao({ id: 'p1', contaId: 'conta', data: '2026-09-10', descricao: 'Uber', valor: 2590 })]));
    repo.salvarAjuste('p1', { nota: 'x' });
    const r = repo.aplicarSincronizacao(dadosPequenos([
      antiga,
      transacao({ id: 'a', contaId: 'conta', data: '2026-09-11', descricao: 'Uber', valor: 2600 }),
      transacao({ id: 'b', contaId: 'conta', data: '2026-09-12', descricao: 'Uber', valor: 2700 }),
    ]));
    expect(r.ajustesPreservados).toBe(0);
    expect([...repo.instantaneo().ajustes.keys()]).toEqual(['p1']);
  });

  it('edição que ficou órfã volta sozinha quando a transação reaparece numa sincronização seguinte', () => {
    const repo = novoRepositorio();
    const t = transacao({ id: 'x1', contaId: 'conta', data: '2026-09-10', descricao: 'Farmácia', valor: 5000 });
    repo.aplicarSincronizacao(dadosPequenos([t]));
    repo.salvarAjuste('x1', { categoriaId: 'saude' });
    // Some de uma vez (o banco oscilou)…
    const vazia = dadosPequenos([transacao({ id: 'outra', contaId: 'conta', data: '2026-09-15', descricao: 'Padaria', valor: 100 })]);
    repo.aplicarSincronizacao(vazia);
    // …e volta com id novo, idêntica.
    repo.aplicarSincronizacao(dadosPequenos([{ ...t, id: 'x2' }, transacao({ id: 'outra', contaId: 'conta', data: '2026-09-15', descricao: 'Padaria', valor: 100 })]));
    expect(repo.instantaneo().ajustes.get('x2')).toMatchObject({ categoriaId: 'saude' });
  });

  it('não apaga o que é mais antigo que a primeira transação que o banco devolveu', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos([
      transacao({ id: 'velha', contaId: 'conta', data: '2025-10-01', descricao: 'Antiga', valor: 100 }),
      transacao({ id: 'nova', contaId: 'conta', data: '2026-09-01', descricao: 'Nova', valor: 100 }),
    ]));
    const d = dadosPequenos([transacao({ id: 'nova', contaId: 'conta', data: '2026-09-01', descricao: 'Nova', valor: 100 })]);
    d.janelas = { conta: '2025-08-01' }; // pediu desde agosto/25, mas o banco só tem desde set/26
    expect(repo.aplicarSincronizacao(d).removidas).toBe(0);
    expect(repo.instantaneo().transacoes.map((t) => t.id).sort()).toEqual(['nova', 'velha']);
  });

  it('conta que volta vazia não apaga nada (falha passageira do banco)', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos());
    expect(repo.aplicarSincronizacao(dadosPequenos([])).removidas).toBe(0);
    expect(repo.instantaneo().transacoes).toHaveLength(3);
  });

  it('sem janela (banco não terminou de atualizar), nada é apagado', () => {
    const repo = novoRepositorio();
    repo.aplicarSincronizacao(dadosPequenos());
    const d = dadosPequenos([transacao({ id: 'a', contaId: 'conta', data: '2026-09-01', descricao: 'Mercado', valor: 1000 })]);
    d.janelas = {};
    expect(repo.aplicarSincronizacao(d).removidas).toBe(0);
  });
});
