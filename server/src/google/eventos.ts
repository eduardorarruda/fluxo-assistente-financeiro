import { createHash } from 'node:crypto';
import type { FaturaMes } from '../domain/cartao';
import { cicloDoCartao } from '../domain/competencia';
import { diaDoMes, diaNoMes, intervaloDeMeses, mesDe, paraDia, somarDias, somarMeses } from '../domain/datas';
import type { Centavos, Conta, Dia, Fatura, Mes } from '../domain/types';
import type { PreferenciasGoogle } from './cofre-google';

/**
 * O que vai para a agenda "Fluxo": monta os eventos a partir do cartão e das
 * contas a pagar. Puro (sem rede, sem relógio escondido): quem chama passa o
 * "hoje" e o "agora".
 */

export const FUSO = 'America/Sao_Paulo';
/** Do que já passou, só o último mês; do futuro, uns quatro meses. */
export const DIAS_PARA_TRAS = 30;
export const DIAS_PARA_FRENTE = 120;

/**
 * Cores dos eventos (ids da paleta "event" do Google Agenda).
 * 3 uva = fechamento · 9 mirtilo = fatura · 7 pavão = conta · 8 grafite = paga · 11 tomate = atrasada.
 */
export const CORES = { fechamento: '3', fatura: '9', conta: '7', paga: '8', atrasada: '11' } as const;

const RODAPE = 'Criado pelo Fluxo. O Fluxo refaz este evento a cada sincronização: mudanças feitas aqui são substituídas.';

export interface Janela {
  de: Dia;
  ate: Dia;
}

export function janelaDe(hoje: Dia): Janela {
  return { de: somarDias(hoje, -DIAS_PARA_TRAS), ate: somarDias(hoje, DIAS_PARA_FRENTE) };
}

const dentro = (dia: Dia, j: Janela) => dia >= j.de && dia <= j.ate;

/** "R$ 1.234,56" com espaço comum (o Intl põe um espaço inseparável depois do R$). */
export function reais(centavos: Centavos): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
}

const ddmm = (dia: Dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

// ------------------------------------------------------------------ itens

export type SituacaoItem = 'aberta' | 'paga' | 'atrasada';

/** Um vencimento ou fechamento, já decidido; vira um evento (e, se atrasado, um alerta). */
export type ItemDaAgenda =
  | { tipo: 'fechamento'; chave: string; data: Dia; cartao: string; vencimentoDaFatura: Dia }
  | {
      tipo: 'fatura';
      chave: string;
      data: Dia;
      cartao: string;
      situacao: SituacaoItem;
      /** Valor fechado a pagar (total − pago); nulo enquanto a fatura não fechou. */
      valor: Centavos | null;
      /** Soma até agora, para fatura aberta (só na descrição). */
      parcial: Centavos | null;
    }
  | { tipo: 'conta'; chave: string; data: Dia; descricao: string; valor: Centavos; situacao: SituacaoItem; pagaEm: Dia | null };

export interface CartaoDaAgenda {
  conta: Pick<Conta, 'id' | 'nome' | 'instituicao' | 'fechamento' | 'vencimento'>;
  faturas: readonly Pick<FaturaMes, 'mes' | 'vencimento' | 'total' | 'pago' | 'situacao'>[];
  faturasDoBanco: readonly Pick<Fatura, 'vencimento' | 'fechamento'>[];
}

/** "Cartão Nubank" quando só há um cartão daquele banco; senão o nome do cartão. */
function nomesDosCartoes(cartoes: readonly CartaoDaAgenda[]): Map<string, string> {
  const porBanco = new Map<string, number>();
  for (const c of cartoes) porBanco.set(c.conta.instituicao, (porBanco.get(c.conta.instituicao) ?? 0) + 1);
  return new Map(cartoes.map((c) => {
    const unico = c.conta.instituicao && porBanco.get(c.conta.instituicao) === 1;
    return [c.conta.id, unico ? `Cartão ${c.conta.instituicao}` : c.conta.nome];
  }));
}

/** Dia em que fecha a fatura que vence no mês `mes`, pelo ciclo do cartão. */
function fechamentoPeloCiclo(mes: Mes, ciclo: { fechamento: Dia | null; vencimento: Dia | null }): Dia | null {
  if (!ciclo.fechamento || !ciclo.vencimento) return null;
  const fecha = diaDoMes(ciclo.fechamento);
  const vence = diaDoMes(ciclo.vencimento);
  return vence > fecha ? diaNoMes(mes, fecha) : diaNoMes(somarMeses(mes, -1), fecha);
}

function situacaoDaFatura(f: CartaoDaAgenda['faturas'][number] | undefined, vencimento: Dia, hoje: Dia): { situacao: SituacaoItem; valor: Centavos | null; parcial: Centavos | null } {
  if (!f || f.situacao === 'FUTURA') return { situacao: 'aberta', valor: null, parcial: f && f.total > 0 ? f.total : null };
  if (f.situacao === 'ABERTA') return { situacao: 'aberta', valor: null, parcial: f.total > 0 ? f.total : null };
  const devendo = f.total - f.pago;
  if (f.situacao === 'PAGA' || devendo <= 0) return { situacao: 'paga', valor: f.total, parcial: null };
  return { situacao: vencimento < hoje ? 'atrasada' : 'aberta', valor: devendo, parcial: null };
}

/**
 * Fechamento e vencimento de cada fatura com data dentro da janela. Mês sem
 * fatura nenhuma ainda (nem compra) também entra, pelas datas do ciclo — a
 * pessoa quer o dia na agenda mesmo antes da primeira compra.
 */
export function itensDosCartoes(cartoes: readonly CartaoDaAgenda[], hoje: Dia, janela: Janela): ItemDaAgenda[] {
  const nomes = nomesDosCartoes(cartoes);
  const itens: ItemDaAgenda[] = [];
  for (const c of cartoes) {
    const ciclo = cicloDoCartao(c.conta, c.faturasDoBanco);
    const nome = nomes.get(c.conta.id)!;
    // +1 mês: o fechamento do fim da janela pode ser de uma fatura que vence depois dela.
    for (const mes of intervaloDeMeses(mesDe(janela.de), somarMeses(mesDe(janela.ate), 1))) {
      const fatura = c.faturas.find((f) => f.mes === mes);
      const doBanco = c.faturasDoBanco.find((f) => mesDe(f.vencimento) === mes);
      const vencimento = fatura?.vencimento ?? doBanco?.vencimento ?? (ciclo.vencimento ? diaNoMes(mes, diaDoMes(ciclo.vencimento)) : null);
      if (!vencimento) continue;
      const fechamento = doBanco?.fechamento ?? fechamentoPeloCiclo(mes, ciclo);
      if (fechamento && dentro(fechamento, janela)) {
        itens.push({ tipo: 'fechamento', chave: `cartao:${c.conta.id}:${mes}:fecha`, data: fechamento, cartao: nome, vencimentoDaFatura: vencimento });
      }
      if (dentro(vencimento, janela)) {
        itens.push({ tipo: 'fatura', chave: `cartao:${c.conta.id}:${mes}:vence`, data: vencimento, cartao: nome, ...situacaoDaFatura(fatura, vencimento, hoje) });
      }
    }
  }
  return itens;
}

/** O mínimo que a agenda precisa de uma conta a pagar (o contrato de `ContasAPagar`). */
export interface ContaAPagarDaAgenda {
  id: string;
  descricao: string;
  valor: Centavos;
  vencimento: Dia;
  situacao: SituacaoItem;
  pagaEm?: string | null;
}

/** Contas com vencimento na janela, mais as atrasadas de antes dela (essas só geram o alerta). */
export function itensDasContas(contas: readonly ContaAPagarDaAgenda[]): ItemDaAgenda[] {
  const vistos = new Set<string>();
  const itens: ItemDaAgenda[] = [];
  for (const c of contas) {
    // A mesma conta repete todo mês: a chave leva o vencimento.
    const chave = `conta:${c.id}:${c.vencimento}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({
      tipo: 'conta', chave, data: c.vencimento, descricao: c.descricao.trim().slice(0, 120) || 'Conta',
      valor: c.valor, situacao: c.situacao, pagaEm: c.pagaEm ? paraDia(c.pagaEm) : null,
    });
  }
  return itens;
}

// ---------------------------------------------------------------- eventos

export interface Lembrete {
  method: 'popup';
  minutes: number;
}

export interface CorpoDoEvento {
  summary: string;
  description: string;
  start: { date: Dia } | { dateTime: string; timeZone: string };
  end: { date: Dia } | { dateTime: string; timeZone: string };
  colorId: string;
  /** Explícito: atualizar um evento que a pessoa apagou no Google o traz de volta. */
  status: 'confirmed';
  transparency: 'transparent';
  reminders: { useDefault: false; overrides: Lembrete[] };
  extendedProperties: { private: { fluxo: '1'; fluxoChave: string; fluxoHash?: string } };
}

export interface EventoDesejado {
  chave: string;
  hash: string;
  corpo: CorpoDoEvento;
}

/** Minutos ANTES da meia-noite que abre um evento de dia inteiro: `dias` antes, às `hora` horas. 2 dias às 9h = 2.340. */
export function minutosAntes(dias: number, hora: number): number {
  return dias * 24 * 60 - hora * 60;
}

export function lembretes(p: Pick<PreferenciasGoogle, 'hora' | 'antecedencias'>): Lembrete[] {
  return [...new Set(p.antecedencias)]
    .sort((a, b) => b - a)
    .map((dias) => ({ method: 'popup' as const, minutes: minutosAntes(dias, p.hora) }))
    .filter((l) => l.minutes >= 0 && l.minutes <= 40_320)
    .slice(0, 5);
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/**
 * O próximo "hoje às `hora`h": hoje, se ainda não deu a hora; senão amanhã.
 * Assim o alerta de atraso toca uma vez por dia enquanto a conta não é paga.
 */
export function proximoAviso(agora: Date, hora: number): { dia: Dia; inicio: string; fim: string } {
  const hoje = paraDia(agora);
  const dia = agora.getHours() < hora ? hoje : somarDias(hoje, 1);
  return { dia, inicio: `${dia}T${doisDigitos(hora)}:00:00`, fim: `${dia}T${doisDigitos(hora)}:30:00` };
}

/** Hash curto do conteúdo: igual = nada a mandar para o Google. */
export function hashDoCorpo(corpo: CorpoDoEvento): string {
  return createHash('sha256').update(JSON.stringify(corpo)).digest('hex').slice(0, 24);
}

function diaInteiro(chave: string, dia: Dia, campos: Pick<CorpoDoEvento, 'summary' | 'description' | 'colorId'>, avisos: Lembrete[]): CorpoDoEvento {
  return {
    ...campos,
    start: { date: dia },
    end: { date: somarDias(dia, 1) },
    status: 'confirmed',
    // Lembrete de conta não ocupa a agenda: ninguém fica "ocupado" por ter boleto.
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: avisos },
    extendedProperties: { private: { fluxo: '1', fluxoChave: chave } },
  };
}

function texto(...linhas: (string | null | false)[]): string {
  return [...linhas.filter(Boolean), '', RODAPE].join('\n');
}

function eventoDoItem(item: ItemDaAgenda, avisos: Lembrete[]): CorpoDoEvento {
  if (item.tipo === 'fechamento') {
    return diaInteiro(item.chave, item.data, {
      summary: `${item.cartao}: fecha a fatura`,
      description: texto(`Hoje fecha a fatura que vence em ${ddmm(item.vencimentoDaFatura)}.`, 'O que você comprar depois do fechamento entra na fatura seguinte.'),
      colorId: CORES.fechamento,
    }, avisos);
  }
  if (item.tipo === 'fatura') {
    const valor = item.valor !== null ? ` · ${reais(item.valor)}` : '';
    if (item.situacao === 'paga') {
      return diaInteiro(item.chave, item.data, {
        summary: `✓ Paga: fatura do ${item.cartao}${valor}`,
        description: texto('Fatura paga. Nada a fazer.'),
        colorId: CORES.paga,
      }, []);
    }
    if (item.situacao === 'atrasada') {
      return diaInteiro(item.chave, item.data, {
        summary: `⚠ Atrasada: fatura do ${item.cartao}${valor}`,
        description: texto(`A fatura venceu em ${ddmm(item.data)} e ainda falta pagar${valor ? ` ${reais(item.valor!)}` : ''}.`, 'Atraso no cartão cobra juros e multa: pague o quanto antes.'),
        colorId: CORES.atrasada,
      }, []);
    }
    return diaInteiro(item.chave, item.data, {
      summary: `${item.cartao}: vence a fatura${valor}`,
      description: texto(
        item.valor !== null ? `Valor a pagar: ${reais(item.valor)}.` : 'A fatura ainda não fechou: o valor aparece aqui quando ela fechar.',
        item.parcial !== null && `Até agora: ${reais(item.parcial)}.`,
      ),
      colorId: CORES.fatura,
    }, avisos);
  }
  const titulo = `${item.descricao} · ${reais(item.valor)}`;
  if (item.situacao === 'paga') {
    return diaInteiro(item.chave, item.data, {
      summary: `✓ Paga: ${titulo}`,
      description: texto(item.pagaEm ? `Paga em ${ddmm(item.pagaEm)}.` : 'Paga.'),
      colorId: CORES.paga,
    }, []);
  }
  if (item.situacao === 'atrasada') {
    return diaInteiro(item.chave, item.data, {
      summary: `⚠ Atrasada: ${titulo}`,
      description: texto(`Venceu em ${ddmm(item.data)} e ainda não foi paga.`, 'Quando pagar, marque como paga no Fluxo (Contas a pagar).'),
      colorId: CORES.atrasada,
    }, []);
  }
  return diaInteiro(item.chave, item.data, {
    summary: `Pagar: ${titulo}`,
    description: texto(`Vence em ${ddmm(item.data)}.`, 'Quando pagar, marque como paga no Fluxo (Contas a pagar).'),
    colorId: CORES.conta,
  }, avisos);
}

/** O alerta de um atraso: um evento com hora, no próximo "hoje às Xh", com aviso na hora. */
function alertaDoItem(item: Extract<ItemDaAgenda, { tipo: 'fatura' | 'conta' }>, agora: Date, hora: number): CorpoDoEvento {
  const quando = proximoAviso(agora, hora);
  const nome = item.tipo === 'fatura' ? `fatura do ${item.cartao}` : item.descricao;
  const valor = item.valor !== null ? ` · ${reais(item.valor)}` : '';
  return {
    summary: `⚠ Em atraso: ${nome}${valor} (venceu ${ddmm(item.data)})`,
    description: texto(
      `Venceu em ${ddmm(item.data)} e ainda não foi paga.`,
      'Este aviso volta todo dia, no mesmo horário, até o Fluxo ver o pagamento.',
    ),
    start: { dateTime: quando.inicio, timeZone: FUSO },
    end: { dateTime: quando.fim, timeZone: FUSO },
    colorId: CORES.atrasada,
    status: 'confirmed',
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { fluxo: '1', fluxoChave: `atraso:${item.chave}` } },
  };
}

/**
 * Os eventos que a agenda deve ter agora, cada um com a chave estável e o
 * hash do conteúdo. Ordem estável (pela chave) para o resultado não depender
 * da ordem em que os dados chegaram.
 */
export function eventosDesejados(itens: readonly ItemDaAgenda[], p: PreferenciasGoogle, janela: Janela, agora: Date): EventoDesejado[] {
  const avisos = lembretes(p);
  const corpos: CorpoDoEvento[] = [];
  for (const item of itens) {
    const ligado = item.tipo === 'conta' ? p.contas : p.cartao;
    if (!ligado) continue;
    if (dentro(item.data, janela)) corpos.push(eventoDoItem(item, avisos));
    if (p.atrasos && item.tipo !== 'fechamento' && item.situacao === 'atrasada') corpos.push(alertaDoItem(item, agora, p.hora));
  }
  const unicos = new Map(corpos.map((c) => [c.extendedProperties.private.fluxoChave, c]));
  return [...unicos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, corpo]) => ({ chave, hash: hashDoCorpo(corpo), corpo }));
}
