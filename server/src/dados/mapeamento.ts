import type { InferSelectModel, Table } from 'drizzle-orm';
import type { Regra } from '../domain/categorizacao';
import type { Ajuste } from '../domain/movimentos';
import { normalizar } from '../domain/texto';
import type { Caixinha, Conta, Fatura, Investimento, Natureza, Transacao } from '../domain/types';
import type * as s from '../db/schema';

type Linha<T extends Table> = InferSelectModel<T>;

/** Impressão digital de uma transação: sobrevive à troca de id do provedor. */
export function impressaoDe(t: Pick<Transacao, 'contaId' | 'data' | 'valor' | 'sentido' | 'descricao'>): string {
  return [t.contaId, t.data, t.valor, t.sentido, normalizar(t.descricao)].join('|');
}

export function transacaoParaLinha(t: Transacao): Linha<typeof s.transacoes> {
  return {
    id: t.id,
    contaId: t.contaId,
    tipoConta: t.tipoConta,
    data: t.data,
    descricao: t.descricao,
    descricaoOriginal: t.descricaoOriginal,
    valor: t.valor,
    sentido: t.sentido,
    pendente: t.pendente,
    categoriaProvedor: t.categoriaProvedor,
    categoriaProvedorId: t.categoriaProvedorId,
    estabelecimento: t.estabelecimento,
    cnpjEstabelecimento: t.cnpjEstabelecimento,
    contraparteNome: t.contraparteNome,
    contraparteDocumento: t.contraparteDocumento,
    meioPagamento: t.meioPagamento,
    parcelaNumero: t.parcela?.numero ?? null,
    parcelaTotal: t.parcela?.total ?? null,
    parcelaValorTotal: t.parcela?.valorTotal ?? null,
    parcelaDataCompra: t.parcela?.dataCompra ?? null,
    parcelaInstanteCompra: t.parcela?.instanteCompra ?? null,
    faturaId: t.faturaId,
    faturaPrevista: t.faturaPrevista,
    outroCredito: t.outroCredito,
    impressao: impressaoDe(t),
  };
}

export function linhaParaTransacao(l: Linha<typeof s.transacoes>): Transacao {
  return {
    id: l.id,
    contaId: l.contaId,
    tipoConta: l.tipoConta,
    data: l.data,
    descricao: l.descricao,
    descricaoOriginal: l.descricaoOriginal,
    valor: l.valor,
    sentido: l.sentido,
    pendente: l.pendente,
    categoriaProvedor: l.categoriaProvedor,
    categoriaProvedorId: l.categoriaProvedorId,
    estabelecimento: l.estabelecimento,
    cnpjEstabelecimento: l.cnpjEstabelecimento,
    contraparteNome: l.contraparteNome,
    contraparteDocumento: l.contraparteDocumento,
    meioPagamento: l.meioPagamento,
    parcela:
      l.parcelaNumero && l.parcelaTotal
        ? {
            numero: l.parcelaNumero, total: l.parcelaTotal, valorTotal: l.parcelaValorTotal, dataCompra: l.parcelaDataCompra,
            // Só aparece quando existe: linhas antigas relêem exatamente como foram gravadas.
            ...(l.parcelaInstanteCompra ? { instanteCompra: l.parcelaInstanteCompra } : {}),
          }
        : null,
    faturaId: l.faturaId,
    faturaPrevista: l.faturaPrevista,
    outroCredito: l.outroCredito,
  };
}

export function linhaParaConta(l: Linha<typeof s.contas>): Conta {
  const { atualizadaEm: _a, ...conta } = l;
  return conta;
}

export function linhaParaCaixinha(l: Linha<typeof s.caixinhas>): Caixinha {
  const { atualizadaEm: _a, ...c } = l;
  return c;
}

export function linhaParaInvestimento(l: Linha<typeof s.investimentos>): Investimento {
  const { atualizadaEm: _a, ...i } = l;
  return i;
}

export function linhaParaFatura(l: Linha<typeof s.faturas>): Fatura {
  return l;
}

export function linhaParaAjuste(l: Linha<typeof s.ajustes>): Ajuste {
  return { natureza: (l.natureza as Natureza | null) ?? null, categoriaId: l.categoriaId, nota: l.nota, ignorar: l.ignorar };
}

export function linhaParaRegra(l: Linha<typeof s.regras>): Regra {
  return { id: l.id, texto: l.texto, categoriaId: l.categoriaId, sentido: l.sentido, prioridade: l.prioridade };
}
