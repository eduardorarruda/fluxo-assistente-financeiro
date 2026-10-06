import { diasEntre, paraDia } from './datas';
import type { FaturaMes } from './cartao';
import type { LinhaOrcamento } from './orcamento';
import type { Recorrencia } from './recorrencias';
import type { Centavos, Dia } from './types';

export type Gravidade = 'INFO' | 'ATENCAO' | 'CRITICO';

export interface Alerta {
  id: string;
  gravidade: Gravidade;
  titulo: string;
  detalhe: string;
  destino: string; // rota do front
}

export interface EntradaAlertas {
  hoje: Dia;
  orcamento: readonly LinhaOrcamento[];
  faturas: readonly FaturaMes[];
  recorrencias: readonly Recorrencia[];
  saldoContas: Centavos;
  conexoes: readonly { id: string; nome: string; situacao: string; ultimaSincronizacao: string | null }[];
  nomeCategoria: (id: string) => string;
  /** Contas a pagar que a pessoa (ou o assistente) cadastrou. */
  contasAPagar?: readonly ContaParaAlerta[];
}

export interface ContaParaAlerta {
  id: string;
  descricao: string;
  valor: Centavos;
  vencimento: Dia;
  pagaEm: Dia | null;
}

/** Até quantos dias antes do vencimento uma conta a pagar começa a avisar. */
const AVISO_CONTA_DIAS = 3;

const brl = (c: Centavos) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O que merece atenção agora, do mais grave para o menos. */
export function gerarAlertas(e: EntradaAlertas): Alerta[] {
  const alertas: Alerta[] = [];

  for (const c of e.conexoes) {
    if (c.situacao === 'LOGIN_ERROR' || c.situacao === 'OUTDATED' || c.situacao === 'WAITING_USER_INPUT') {
      alertas.push({
        id: `conexao:${c.id}`, gravidade: 'CRITICO', titulo: `${c.nome} precisa de você`,
        detalhe: 'A conexão parou de atualizar. Reconecte para voltar a receber os dados.', destino: '/conexoes',
      });
    } else if (c.ultimaSincronizacao && diasEntre(paraDia(new Date(c.ultimaSincronizacao)), e.hoje) > 3) {
      alertas.push({
        id: `desatualizada:${c.id}`, gravidade: 'ATENCAO', titulo: `${c.nome} sem atualizar há dias`,
        detalhe: 'Os números podem estar atrasados. Sincronize para trazer o que falta.', destino: '/conexoes',
      });
    }
  }

  for (const f of e.faturas) {
    if (f.situacao !== 'FECHADA' && f.situacao !== 'ABERTA') continue;
    const faltam = diasEntre(e.hoje, f.vencimento);
    const devendo = f.total - f.pago;
    if (devendo <= 0 || faltam < -30 || faltam > 7) continue;
    alertas.push({
      id: `fatura:${f.contaId}:${f.mes}`,
      gravidade: faltam < 0 ? 'CRITICO' : 'ATENCAO',
      titulo: faltam < 0 ? 'Fatura vencida' : faltam === 0 ? 'Fatura vence hoje' : `Fatura vence em ${faltam} dia${faltam > 1 ? 's' : ''}`,
      detalhe: `${brl(devendo)} a pagar.${e.saldoContas < devendo ? ' O saldo em conta não cobre.' : ''}`,
      destino: '/cartao',
    });
  }

  alertas.push(...alertasDeContas(e));

  for (const l of e.orcamento) {
    if (l.situacao === 'TRANQUILO') continue;
    const nome = e.nomeCategoria(l.categoriaId);
    alertas.push(l.situacao === 'ESTOUROU'
      ? { id: `orcamento:${l.categoriaId}`, gravidade: 'ATENCAO', titulo: `${nome} passou do limite`,
          detalhe: `${brl(l.gasto)} de ${brl(l.limite)} (${brl(-l.restante)} acima).`, destino: '/orcamento' }
      : { id: `orcamento:${l.categoriaId}`, gravidade: 'INFO', titulo: `${nome} perto do limite`,
          detalhe: `No ritmo atual o mês fecha em ${brl(l.projecao)} para um limite de ${brl(l.limite)}.`, destino: '/orcamento' });
  }

  for (const r of e.recorrencias) {
    if (!r.ativa || !r.aumento) continue;
    alertas.push({
      id: `aumento:${r.chave}`, gravidade: 'INFO', titulo: `${r.nome} ficou mais caro`,
      detalhe: `De ${brl(r.aumento.de)} para ${brl(r.aumento.para)} por mês.`, destino: '/recorrencias',
    });
  }

  const peso: Record<Gravidade, number> = { CRITICO: 0, ATENCAO: 1, INFO: 2 };
  return alertas.sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
}

const diaCurto = (dia: Dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** Conta atrasada é crítica; a que vence hoje ou nos próximos dias pede atenção. */
function alertasDeContas(e: EntradaAlertas): Alerta[] {
  const abertas = (e.contasAPagar ?? []).filter((c) => !c.pagaEm).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const alertas: Alerta[] = [];
  for (const c of abertas) {
    const faltam = diasEntre(e.hoje, c.vencimento);
    if (faltam > AVISO_CONTA_DIAS) continue;
    const semSaldo = e.saldoContas < c.valor ? ' O saldo em conta não cobre.' : '';
    const base = { id: `conta-a-pagar:${c.id}`, destino: '/contas-a-pagar' };
    if (faltam < 0) {
      const ha = -faltam;
      alertas.push({ ...base, gravidade: 'CRITICO', titulo: `${c.descricao} está atrasada`,
        detalhe: `${brl(c.valor)} · venceu há ${ha} dia${ha > 1 ? 's' : ''} (${diaCurto(c.vencimento)}).` });
      continue;
    }
    const quando = faltam === 0 ? 'hoje' : faltam === 1 ? 'amanhã' : `em ${faltam} dias`;
    alertas.push({ ...base, gravidade: 'ATENCAO', titulo: `${c.descricao} vence ${quando}`,
      detalhe: `${brl(c.valor)} a pagar${faltam === 0 ? '' : ` em ${diaCurto(c.vencimento)}`}.${semSaldo}` });
  }
  return alertas;
}
