import { BadRequestException } from '@nestjs/common';
import { abrirBanco } from '../db/conexao';
import { NaoEncontrado, Repositorio } from '../dados/repositorio';
import { conta, transacao } from '../domain/testing/fabrica';
import type { Transacao } from '../domain/types';
import type { DadosDaConexao } from '../provedores/provedor';
import { relogioFixo } from '../relogio';
import { ContasAPagar } from './contas-a-pagar';
import { Financas } from './financas';
import type { Sincronizador } from './sincronizador';

const HOJE = '2026-10-02';

function dados(transacoes: Transacao[]): DadosDaConexao {
  return {
    conexao: { id: 'item', nome: 'Nubank', conectorId: 1, logoUrl: null, cor: null, situacao: 'UPDATED', erro: null, atualizadaNoBanco: `${HOJE}T12:00:00.000Z`, consentimentoExpira: null },
    contas: [conta({ id: 'k', conexaoId: 'item' }), conta({ id: 'nu', conexaoId: 'item', tipo: 'CARTAO', nome: 'Cartão' })],
    caixinhas: [], investimentos: [], faturas: [], transacoes, janelas: {},
  };
}

const enel = (p: Partial<Transacao> = {}) =>
  transacao({ id: 'enel-out', contaId: 'k', data: '2026-10-08', descricao: 'Pagamento de boleto|ENEL DISTRIBUICAO SP', valor: 15230, ...p });

function montar(transacoes: Transacao[] = [], hoje = HOJE) {
  const banco = abrirBanco(':memory:');
  const relogio = relogioFixo(hoje);
  const repo = new Repositorio(banco, relogio);
  repo.criarConexao('item', 'pluggy', 'Nubank');
  repo.aplicarSincronizacao(dados(transacoes));
  let aoSincronizar: (() => void) | null = null;
  const sincronizador = { aoTerminar: (cb: () => void) => { aoSincronizar = cb; return () => { aoSincronizar = null; }; } };
  const servico = new ContasAPagar(repo, new Financas(repo, relogio), sincronizador as unknown as Sincronizador, relogio);
  servico.onModuleInit();
  const sincronizar = (novas: Transacao[]) => {
    repo.aplicarSincronizacao(dados(novas));
    aoSincronizar?.();
  };
  return { repo, servico, sincronizar };
}

const luz = { descricao: 'Conta de luz', valor: 15000, vencimento: '2026-10-10', textoNoExtrato: 'Enel' };

describe('ContasAPagar — cadastro', () => {
  it('cria, lista com a situação calculada e obtém', () => {
    const { servico } = montar();
    const c = servico.criar({ ...luz, repete: 'mensal', origem: 'assistente' });
    expect(c).toMatchObject({ descricao: 'Conta de luz', valor: 15000, situacao: 'aberta', repete: 'mensal', origem: 'assistente', pagaEm: null });
    servico.criar({ descricao: 'IPTU', valor: 50000, vencimento: '2026-09-20' });
    expect(servico.listar().map((x) => [x.descricao, x.situacao])).toEqual([['IPTU', 'atrasada'], ['Conta de luz', 'aberta']]);
    expect(servico.listar({ situacao: 'atrasada' })).toHaveLength(1);
    expect(servico.listar({ de: '2026-10-01', ate: '2026-10-31' }).map((x) => x.descricao)).toEqual(['Conta de luz']);
    expect(servico.obter(c.id)?.id).toBe(c.id);
    expect(servico.obter('nao-existe')).toBeNull();
  });

  it('recusa dados inválidos com mensagem em português', () => {
    const { servico } = montar();
    const erro = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return (e as BadRequestException).message;
      }
      throw new Error('deveria ter falhado');
    };
    expect(erro(() => servico.criar({ ...luz, valor: 0 }))).toContain('o valor precisa ser maior que zero');
    expect(erro(() => servico.criar({ ...luz, valor: 10.5 }))).toContain('centavos');
    expect(erro(() => servico.criar({ ...luz, vencimento: '2026-02-30' }))).toContain('não existe no calendário');
    expect(erro(() => servico.criar({ ...luz, vencimento: '10/10/2026' }))).toContain('AAAA-MM-DD');
    expect(erro(() => servico.criar({ ...luz, descricao: '  ' }))).toContain('informe a descrição');
    expect(erro(() => servico.criar({ ...luz, categoriaId: 'salario' }))).toContain('categoria de gasto');
    expect(erro(() => servico.listar({ situacao: 'qualquer' as never }))).toContain('situação');
  });

  it('atualiza só o que veio; conta que não existe é 404', () => {
    const { servico } = montar();
    const c = servico.criar({ ...luz, nota: 'débito automático' });
    const editada = servico.atualizar(c.id, { valor: 16000, nota: undefined });
    expect(editada).toMatchObject({ valor: 16000, nota: 'débito automático', descricao: 'Conta de luz' });
    expect(() => servico.atualizar('nao-existe', { valor: 1 })).toThrow(NaoEncontrado);
    expect(() => servico.remover('nao-existe')).toThrow(NaoEncontrado);
  });

  it('remove', () => {
    const { servico } = montar();
    const c = servico.criar(luz);
    servico.remover(c.id);
    expect(servico.listar()).toEqual([]);
  });
});

describe('ContasAPagar — pagamento', () => {
  it('marcar paga à mão; a que repete ganha a próxima (uma vez só)', () => {
    const { servico } = montar();
    const c = servico.criar({ ...luz, vencimento: '2026-01-31', repete: 'mensal' });
    expect(servico.marcarPaga(c.id)).toMatchObject({ situacao: 'paga', pagaEm: HOJE, movimentoId: null });
    servico.marcarPaga(c.id, { data: '2026-01-30' });
    const lista = servico.listar();
    expect(lista.map((x) => [x.vencimento, x.situacao])).toEqual([['2026-01-31', 'paga'], ['2026-02-28', 'atrasada']]);
    // A seguinte volta ao dia 31 depois de fevereiro.
    servico.marcarPaga(lista[1]!.id);
    expect(servico.listar().at(-1)?.vencimento).toBe('2026-03-31');
  });

  it('marcar paga com o movimento escolhido usa a data dele; movimento inválido é recusado', () => {
    const { servico } = montar([enel(), transacao({ id: 'pix-meu', contaId: 'k', data: '2026-10-05', descricao: 'Transferência para conta própria', valor: 1 })]);
    const c = servico.criar({ ...luz, textoNoExtrato: 'nao-casa' });
    expect(servico.marcarPaga(c.id, { movimentoId: 'enel-out' })).toMatchObject({ pagaEm: '2026-10-08', movimentoId: 'enel-out' });
    const outra = servico.criar({ descricao: 'Outra', valor: 100, vencimento: '2026-10-20' });
    expect(() => servico.marcarPaga(outra.id, { movimentoId: 'enel-out' })).toThrow('já pagou "Conta de luz"');
    expect(() => servico.marcarPaga(outra.id, { movimentoId: 'sumiu' })).toThrow('não está no extrato');
  });

  it('reabrir desfaz o pagamento e apaga a próxima que ninguém mexeu', () => {
    const { servico } = montar();
    const c = servico.criar({ ...luz, repete: 'mensal' });
    servico.marcarPaga(c.id);
    expect(servico.listar()).toHaveLength(2);
    expect(servico.reabrir(c.id)).toMatchObject({ situacao: 'aberta', pagaEm: null });
    expect(servico.listar()).toHaveLength(1);
    // Reabrir o que já está aberto não faz nada.
    expect(servico.reabrir(c.id).situacao).toBe('aberta');
  });

  it('reabrir mantém a próxima se a pessoa já editou', () => {
    const { servico } = montar();
    const c = servico.criar({ ...luz, repete: 'mensal' });
    servico.marcarPaga(c.id);
    const proxima = servico.listar().find((x) => x.id !== c.id)!;
    servico.atualizar(proxima.id, { valor: 17000 });
    servico.reabrir(c.id);
    expect(servico.listar()).toHaveLength(2);
  });
});

describe('ContasAPagar — conciliação', () => {
  it('ao criar, se o débito já caiu, nasce paga', () => {
    const { servico } = montar([enel()]);
    expect(servico.criar(luz)).toMatchObject({ situacao: 'paga', pagaEm: '2026-10-08', movimentoId: 'enel-out' });
  });

  it('depois da sincronização, o débito novo paga a conta e cria a próxima', () => {
    const { servico, sincronizar } = montar();
    const c = servico.criar({ ...luz, repete: 'mensal' });
    expect(servico.obter(c.id)?.situacao).toBe('aberta');
    sincronizar([enel()]);
    expect(servico.obter(c.id)).toMatchObject({ situacao: 'paga', movimentoId: 'enel-out' });
    expect(servico.listar().map((x) => x.vencimento)).toEqual(['2026-10-10', '2026-11-10']);
  });

  it('dois débitos possíveis: não liga, e os dois aparecem como candidatos fortes', () => {
    const { servico } = montar([enel(), enel({ id: 'enel-2', data: '2026-10-09', valor: 14900 })]);
    const c = servico.criar(luz);
    expect(c.situacao).toBe('aberta');
    expect(servico.conciliar()).toEqual([]);
    const candidatos = servico.candidatos(c.id);
    // O mais perto do vencimento primeiro.
    expect(candidatos.map((m) => [m.id, m.forte])).toEqual([['enel-2', true], ['enel-out', true]]);
    expect(candidatos[1]).toMatchObject({ conta: 'Conta', valor: 15230, data: '2026-10-08' });
  });

  it('reabrir uma conta paga pelo extrato não deixa a conciliação ligar o mesmo débito de novo', () => {
    const { servico } = montar([enel()]);
    const c = servico.criar(luz);
    expect(c.situacao).toBe('paga');
    servico.reabrir(c.id);
    expect(servico.conciliar()).toEqual([]);
    expect(servico.obter(c.id)?.situacao).toBe('aberta');
    // Mas a pessoa ainda pode escolher esse débito à mão.
    expect(servico.candidatos(c.id).map((m) => [m.id, m.forte])).toEqual([['enel-out', false]]);
    expect(servico.marcarPaga(c.id, { movimentoId: 'enel-out' }).situacao).toBe('paga');
  });

  it('assinatura no cartão paga a conta', () => {
    const netflix = transacao({ id: 'nf', contaId: 'nu', tipoConta: 'CARTAO', data: '2026-10-05', descricao: 'Netflix.com', valor: 5590 });
    const { servico } = montar([netflix]);
    expect(servico.criar({ descricao: 'Netflix', valor: 5590, vencimento: '2026-10-05' }).movimentoId).toBe('nf');
  });
});

describe('ContasAPagar — avisos', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('junta várias mudanças num aviso só e deixa cancelar', () => {
    const { servico } = montar();
    const ouvinte = vi.fn();
    const cancelar = servico.aoMudar(ouvinte);
    const c = servico.criar(luz);
    servico.atualizar(c.id, { valor: 1 });
    servico.remover(c.id);
    expect(ouvinte).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    cancelar();
    servico.criar(luz);
    vi.advanceTimersByTime(500);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('ouvinte que falha não derruba os outros', () => {
    const { servico } = montar();
    const bom = vi.fn();
    servico.aoMudar(() => {
      throw new Error('falhou');
    });
    servico.aoMudar(bom);
    servico.criar(luz);
    vi.advanceTimersByTime(500);
    expect(bom).toHaveBeenCalledTimes(1);
  });
});
