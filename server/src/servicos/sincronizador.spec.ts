import { abrirBanco } from '../db/conexao';
import { Repositorio } from '../dados/repositorio';
import { conta, transacao } from '../domain/testing/fabrica';
import type { Dia } from '../domain/types';
import type { DadosDaConexao } from '../provedores/provedor';
import type { ProvedorDemo } from '../provedores/provedor-demo';
import type { ProvedorPluggy } from '../provedores/provedor-pluggy';
import { relogioFixo } from '../relogio';
import { inicioDaRevisaoDaConta, Sincronizador } from './sincronizador';

const HOJE = '2026-09-27';

function dados(p: { situacao: string; atualizadaNoBanco: string | null; transacoes?: DadosDaConexao['transacoes']; janelas?: DadosDaConexao['janelas'] }): DadosDaConexao {
  return {
    conexao: { id: 'item', nome: 'Nubank', conectorId: 1, logoUrl: null, cor: null, situacao: p.situacao, erro: null, atualizadaNoBanco: p.atualizadaNoBanco, consentimentoExpira: null },
    contas: [conta({ id: 'k', conexaoId: 'item' })],
    caixinhas: [], investimentos: [], faturas: [],
    transacoes: p.transacoes ?? [],
    janelas: p.janelas ?? {},
  };
}

/** Banco em memória com uma conexão Pluggy já sincronizada em `dia`. */
function montar(sincronizacoes: { dia: Dia; d: DadosDaConexao }[]) {
  const banco = abrirBanco(':memory:');
  for (const [i, { dia, d }] of sincronizacoes.entries()) {
    const repo = new Repositorio(banco, relogioFixo(dia));
    if (i === 0) repo.criarConexao('item', 'pluggy', 'Nubank');
    repo.aplicarSincronizacao(d);
  }
  const repo = new Repositorio(banco, relogioFixo(HOJE));
  const pedidos: { conta: Dia; cartao: Dia }[] = [];
  let resposta = dados({ situacao: 'UPDATED', atualizadaNoBanco: `${HOJE}T12:00:00.000Z` });
  const pluggy = { nome: 'pluggy', buscar: async (_id: string, desde: { conta: Dia; cartao: Dia }) => { pedidos.push(desde); return resposta; } };
  const sincronizador = new Sincronizador(repo, {} as ProvedorDemo, pluggy as unknown as ProvedorPluggy, relogioFixo(HOJE));
  return { repo, sincronizador, pedidos, responder: (d: DadosDaConexao) => { resposta = d; } };
}

describe('inicioDaRevisaoDaConta', () => {
  it('primeira vez (ou banco que nunca terminou de atualizar) pede o histórico inteiro', () => {
    expect(inicioDaRevisaoDaConta({ ultimaSincronizacao: null, atualizadaNoBanco: null }, HOJE)).toBe('2025-08-23');
    expect(inicioDaRevisaoDaConta({ ultimaSincronizacao: '2026-09-26T10:00:00.000Z', atualizadaNoBanco: null }, HOJE)).toBe('2025-08-23');
  });

  it('parte da última vez que o banco atualizou de fato, não da última sincronização', () => {
    expect(inicioDaRevisaoDaConta({ ultimaSincronizacao: '2026-09-26T10:00:00.000Z', atualizadaNoBanco: '2026-05-01T12:00:00.000Z' }, HOJE)).toBe('2026-03-02');
    expect(inicioDaRevisaoDaConta({ ultimaSincronizacao: '2026-09-26T10:00:00.000Z', atualizadaNoBanco: '2026-09-26T09:00:00.000Z' }, HOJE)).toBe('2026-07-28');
  });

  it('nunca pede mais do que o histórico da primeira vez', () => {
    expect(inicioDaRevisaoDaConta({ ultimaSincronizacao: '2026-09-26T10:00:00.000Z', atualizadaNoBanco: '2025-01-01T12:00:00.000Z' }, HOJE)).toBe('2025-08-23');
  });
});

describe('Sincronizador', () => {
  it('conexão parada meses (sincronizando, mas sem o banco atualizar) revê desde a última atualização real', async () => {
    const { sincronizador, pedidos } = montar([
      { dia: '2026-05-01', d: dados({ situacao: 'UPDATED', atualizadaNoBanco: '2026-05-01T12:00:00.000Z' }) },
      { dia: '2026-09-20', d: dados({ situacao: 'LOGIN_ERROR', atualizadaNoBanco: '2026-05-01T12:00:00.000Z' }) },
    ]);
    await sincronizador.sincronizar('item');
    expect(pedidos[0]?.conta).toBe('2026-03-02');
  });

  it('item que não terminou de atualizar não autoriza apagar nada, mesmo se vier janela', async () => {
    const antiga = transacao({ id: 'antiga', contaId: 'k', data: '2026-09-01' });
    const { repo, sincronizador, responder } = montar([
      { dia: '2026-09-20', d: dados({ situacao: 'UPDATED', atualizadaNoBanco: '2026-09-20T12:00:00.000Z', transacoes: [antiga] }) },
    ]);
    responder(dados({
      situacao: 'OUTDATED', atualizadaNoBanco: '2026-09-20T12:00:00.000Z',
      transacoes: [transacao({ id: 'nova', contaId: 'k', data: '2026-08-01' })], janelas: { k: '2026-07-01' },
    }));
    const r = await sincronizador.sincronizar('item');
    expect(r.removidas).toBe(0);
    expect(repo.instantaneo().transacoes.map((t) => t.id).sort()).toEqual(['antiga', 'nova']);
  });

  it('avisa quem acompanha quando a sincronização grava; erro na sincronização não avisa', async () => {
    const { sincronizador, responder } = montar([
      { dia: '2026-09-20', d: dados({ situacao: 'UPDATED', atualizadaNoBanco: '2026-09-20T12:00:00.000Z' }) },
    ]);
    const avisos: string[] = [];
    const cancelar = sincronizador.aoTerminar((id) => avisos.push(id));
    sincronizador.aoTerminar(() => {
      throw new Error('ouvinte com defeito');
    });
    await sincronizador.sincronizar('item');
    expect(avisos).toEqual(['item']);
    responder(null as unknown as DadosDaConexao);
    await expect(sincronizador.sincronizar('item')).rejects.toThrow();
    cancelar();
    expect(avisos).toEqual(['item']);
  });
});

describe('sincronização automática', () => {
  /** Conexão Pluggy sincronizada pela última vez às 15:00 do dia; o relógio do Sincronizador anda `minutos` depois. */
  function aposMinutos(minutos: number) {
    const banco = abrirBanco(':memory:');
    const repo = new Repositorio(banco, relogioFixo(HOJE));
    repo.criarConexao('item', 'pluggy', 'Nubank');
    repo.aplicarSincronizacao(dados({ situacao: 'UPDATED', atualizadaNoBanco: `${HOJE}T12:00:00.000Z` }));
    const buscas: string[] = [];
    const pluggy = { nome: 'pluggy', buscar: async (id: string) => { buscas.push(id); return dados({ situacao: 'UPDATED', atualizadaNoBanco: `${HOJE}T12:00:00.000Z` }); } };
    const relogio = { agora: () => new Date(new Date(`${HOJE}T15:00:00`).getTime() + minutos * 60_000), hoje: () => HOJE as Dia };
    return { sincronizador: new Sincronizador(repo, {} as ProvedorDemo, pluggy as unknown as ProvedorPluggy, relogio), buscas };
  }

  it('puxa de novo da Pluggy quando passou mais de 1 hora desde a última vez', async () => {
    const { sincronizador, buscas } = aposMinutos(61);
    await sincronizador.sincronizarAtrasadas();
    expect(buscas).toEqual(['item']);
  });

  it('com menos de 1 hora, não puxa de novo', async () => {
    const { sincronizador, buscas } = aposMinutos(45);
    await sincronizador.sincronizarAtrasadas();
    expect(buscas).toEqual([]);
  });
});
