import { classificar } from '../domain/classificacao';
import { competencia } from '../domain/competencia';
import { montarMovimentos } from '../domain/movimentos';
import { detectarRecorrencias } from '../domain/recorrencias';
import { resumoDoMes } from '../domain/resumo';
import { gerarDadosDemo } from './provedor-demo';

const HOJE = '2026-09-24';
const dados = gerarDadosDemo(HOJE);
const ctx = { documentosDoTitular: ['11122233344'], nomesDoTitular: ['titular demonstracao'] };

describe('gerarDadosDemo', () => {
  it('é determinístico para o mesmo dia', () => {
    expect(gerarDadosDemo(HOJE)).toEqual(dados);
  });

  it('nada no futuro, exceto parcelas pendentes', () => {
    const futuras = dados.transacoes.filter((t) => t.data > HOJE);
    expect(futuras).toEqual([]);
    const pendentes = dados.transacoes.filter((t) => t.pendente);
    expect(pendentes.length).toBeGreaterThan(0);
    expect(pendentes.every((t) => t.parcela)).toBe(true);
  });

  it('todas as datas são válidas', () => {
    expect(dados.transacoes.every((t) => /^\d{4}-\d{2}-(0[1-9]|[12]\d|3[01])$/.test(t.data))).toBe(true);
  });

  it('o saldo da conta bate com a soma dos movimentos a partir do saldo inicial', () => {
    const conta = dados.contas.find((c) => c.tipo === 'CONTA')!;
    const soma = dados.transacoes
      .filter((t) => t.contaId === conta.id)
      .reduce((s, t) => s + (t.sentido === 'ENTRADA' ? t.valor : -t.valor), 680000);
    expect(conta.saldo).toBe(soma);
  });

  it('cada fatura paga tem o pagamento na conta e o "pagamento recebido" no cartão, do mesmo valor', () => {
    const pagas = dados.faturas.filter((f) => f.pago > 0);
    expect(pagas.length).toBeGreaterThan(6);
    for (const f of pagas) {
      const naConta = dados.transacoes.find((t) => t.contaId === 'demo-conta' && t.data === f.vencimento && t.descricao === 'Pagamento de fatura');
      const noCartao = dados.transacoes.find((t) => t.faturaId === f.id);
      expect(naConta?.valor).toBe(f.total);
      expect(noCartao?.valor).toBe(f.total);
    }
  });

  it('o sistema classifica a demonstração como um Nubank real: sem contar fatura, caixinha ou Pix para si', () => {
    const movimentos = montarMovimentos(dados.transacoes, ctx, [], new Map());
    const naturezas = new Set(movimentos.map((m) => m.natureza));
    expect([...naturezas].sort()).toEqual(['DESPESA', 'ESTORNO', 'INVESTIMENTO', 'PAGAMENTO_FATURA', 'RECEITA', 'TRANSFERENCIA']);
    const pixParaSi = dados.transacoes.find((t) => t.contraparteNome === 'Titular Demonstração')!;
    expect(classificar(pixParaSi, ctx)).toBe('TRANSFERENCIA');
  });

  it('um mês cheio tem receita, despesa em várias categorias e dinheiro guardado', () => {
    const movimentos = montarMovimentos(dados.transacoes, ctx, [], new Map());
    const agosto = resumoDoMes(movimentos, '2026-08');
    expect(agosto.receitas).toBeGreaterThan(1_000_000);
    expect(agosto.porCategoria.length).toBeGreaterThan(12);
    expect(agosto.guardado).toBeGreaterThan(0);
    expect(agosto.porCategoria.some((c) => c.categoriaId === 'outros')).toBe(false);
  });

  it('as assinaturas são reconhecidas, com o aumento do Spotify e a Disney cancelada', () => {
    const movimentos = montarMovimentos(dados.transacoes, ctx, [], new Map());
    const recorrencias = detectarRecorrencias(movimentos, HOJE);
    const nomes = recorrencias.map((r) => r.nome);
    expect(nomes).toEqual(expect.arrayContaining(['Netflix.com', 'Spotify', 'Smart Fit', 'Disney Plus']));
    expect(recorrencias.find((r) => r.nome === 'Spotify')?.aumento).toEqual({ de: 2190, para: 2390 });
    expect(recorrencias.find((r) => r.nome === 'Disney Plus')?.ativa).toBe(false);
  });

  it('parcelas de uma compra se espalham pelos meses seguintes', () => {
    const iphone = dados.transacoes.filter((t) => t.descricao === 'Apple Store iPhone');
    expect(iphone).toHaveLength(12);
    expect(new Set(iphone.map((t) => competencia(t))).size).toBe(12);
  });

  it('caixinhas crescem e têm histórico mensal', () => {
    expect(dados.caixinhas.map((c) => c.nome)).toEqual(['Reserva de emergência', 'Viagem Japão', 'Carro novo']);
    const reserva = dados.historico.filter((h) => h.refId === 'demo-conta:reserva');
    expect(reserva.length).toBe(14);
    expect(reserva.at(-1)!.valor).toBeGreaterThan(reserva[0]!.valor);
  });

  it('o limite usado do cartão inclui as parcelas futuras', () => {
    const cartao = dados.contas.find((c) => c.tipo === 'CARTAO')!;
    expect(cartao.limite! - cartao.limiteDisponivel!).toBeGreaterThan(cartao.saldo);
  });
});
