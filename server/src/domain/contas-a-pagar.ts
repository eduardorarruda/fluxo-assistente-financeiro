import { diaDoMes, diaNoMes, diasEntre, mesDe, somarDias, somarMeses } from './datas';
import { normalizar } from './texto';
import type { Centavos, Dia, Movimento } from './types';

/**
 * Contas a pagar: o que a pessoa avisa que vai vencer ("a luz de R$ 150 vence
 * dia 10"). As regras puras ficam aqui — situação, próxima ocorrência e a
 * conciliação com o extrato, que marca a conta como paga quando o débito cai.
 */

export type Repeticao = 'nao' | 'mensal' | 'anual';
export type SituacaoConta = 'aberta' | 'paga' | 'atrasada';

/** O mínimo de uma conta que a conciliação precisa conhecer. */
export interface ContaConciliavel {
  id: string;
  descricao: string;
  valor: Centavos;
  vencimento: Dia;
  /** Trecho que identifica o débito no extrato ("ENEL"); nulo = usa as palavras da descrição. */
  textoNoExtrato: string | null;
  pagaEm: Dia | null;
  movimentoId: string | null;
  /** Movimentos que a pessoa desligou desta conta: a conciliação automática não os escolhe de novo. */
  recusados: readonly string[];
}

export type MovimentoConciliavel = Pick<
  Movimento,
  'id' | 'data' | 'descricao' | 'estabelecimento' | 'contraparteNome' | 'valor' | 'natureza' | 'pendente' | 'tipoConta'
>;

export interface Ligacao {
  contaId: string;
  movimentoId: string;
  data: Dia;
}

/** Janela em que um débito ainda é desta conta: paga adiantada até 10 dias, atrasada até 15. */
export const DIAS_ANTES = 10;
export const DIAS_DEPOIS = 15;
/** Na escolha à mão, a janela é mais larga: a pessoa sabe o que pagou. */
const DIAS_AMPLO = 30;
/** Conta abaixo disto só casa com o valor exato: 10% de R$ 9,90 é troco, e assinatura pequena tem preço fixo. */
export const VALOR_PEQUENO: Centavos = 1000;
const TOLERANCIA = 0.1;

/**
 * Palavras que aparecem em qualquer conta e não identificam ninguém: "conta de
 * luz" não deve casar com "Pagamento de conta|Fulano".
 */
const GENERICAS = new Set([
  'conta', 'contas', 'pagamento', 'pagto', 'boleto', 'fatura', 'mensal', 'mensalidade', 'anual', 'anuidade',
  'assinatura', 'compra', 'debito', 'credito', 'automatico', 'valor', 'para', 'pelo', 'pela', 'com', 'plano',
  'servico', 'servicos', 'taxa', 'parcela', 'pix', 'enviado', 'enviada', 'transferencia', 'ted', 'doc', 'nubank',
]);
const TAMANHO_MINIMO = 3;

export function situacaoDaConta(c: { vencimento: Dia; pagaEm: Dia | null }, hoje: Dia): SituacaoConta {
  if (c.pagaEm) return 'paga';
  return c.vencimento < hoje ? 'atrasada' : 'aberta';
}

/**
 * Vencimento da ocorrência seguinte. `dia` é o dia combinado (o 31 de uma conta
 * que vence "todo dia 31"): fevereiro cai no 28/29 e março volta ao 31.
 */
export function proximoVencimento(vencimento: Dia, repete: Repeticao, dia: number = diaDoMes(vencimento)): Dia | null {
  if (repete === 'nao') return null;
  return diaNoMes(somarMeses(mesDe(vencimento), repete === 'mensal' ? 1 : 12), dia);
}

/** Quanto o débito pode diferir do valor da conta, em centavos, para cima ou para baixo. */
export function toleranciaDeValor(valor: Centavos): Centavos {
  return valor < VALOR_PEQUENO ? 0 : Math.floor(valor * TOLERANCIA);
}

/** Palavras que identificam a conta (sem acento, caixa, palavras curtas ou genéricas). */
export function palavrasSignificativas(texto: string | null | undefined): Set<string> {
  return new Set(
    normalizar(texto)
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= TAMANHO_MINIMO && !GENERICAS.has(p) && !/^\d+$/.test(p)),
  );
}

/** Mesmo alvo das regras de categoria (`porRegra`): descrição, estabelecimento e contraparte. */
function textoDoMovimento(m: MovimentoConciliavel): string {
  return normalizar(`${m.descricao} ${m.estabelecimento ?? ''} ${m.contraparteNome ?? ''}`);
}

export function textoCasa(conta: Pick<ContaConciliavel, 'descricao' | 'textoNoExtrato'>, m: MovimentoConciliavel): boolean {
  const alvo = textoDoMovimento(m);
  const trecho = normalizar(conta.textoNoExtrato);
  if (trecho) return alvo.includes(trecho);
  const doMovimento = palavrasSignificativas(alvo);
  for (const p of palavrasSignificativas(conta.descricao)) if (doMovimento.has(p)) return true;
  return false;
}

export function valorCasa(valorConta: Centavos, valorMovimento: Centavos): boolean {
  return Math.abs(valorMovimento - valorConta) <= toleranciaDeValor(valorConta);
}

/**
 * Só gasto de verdade paga conta: pagamento de fatura, transferência entre
 * contas suas e investimento nunca (movimento "ignorado" já chega como
 * transferência). Compra no cartão vale — assinatura cobrada no cartão é conta
 * paga. Pendente da conta é agendamento: ainda pode não acontecer.
 */
function podePagar(m: MovimentoConciliavel): boolean {
  if (m.natureza !== 'DESPESA') return false;
  return !(m.pendente && m.tipoConta !== 'CARTAO');
}

/**
 * Movimentos que podem ser o pagamento desta conta. 'estrito' (a conciliação
 * automática): texto E valor E janela, sem os recusados. 'amplo' (a pessoa
 * escolhendo): texto OU valor, janela maior, recusados de volta — ordenados
 * pelo mais provável (texto pesa mais que valor; depois o mais perto do vencimento).
 */
export function candidatosDaConta<M extends MovimentoConciliavel>(
  conta: ContaConciliavel,
  movimentos: readonly M[],
  ligadosAOutras: ReadonlySet<string>,
  modo: 'estrito' | 'amplo' = 'estrito',
): M[] {
  const antes = modo === 'estrito' ? DIAS_ANTES : DIAS_AMPLO;
  const depois = modo === 'estrito' ? DIAS_DEPOIS : DIAS_AMPLO;
  const inicio = somarDias(conta.vencimento, -antes);
  const fim = somarDias(conta.vencimento, depois);
  const recusados = new Set(conta.recusados);
  const pontuados: { m: M; pontos: number; distancia: number }[] = [];
  for (const m of movimentos) {
    if (m.data < inicio || m.data > fim || !podePagar(m)) continue;
    if (ligadosAOutras.has(m.id)) continue;
    const texto = textoCasa(conta, m);
    const valor = valorCasa(conta.valor, m.valor);
    if (modo === 'estrito' ? !(texto && valor) || recusados.has(m.id) : !(texto || valor)) continue;
    pontuados.push({ m, pontos: (texto ? 2 : 0) + (valor ? 1 : 0), distancia: Math.abs(diasEntre(conta.vencimento, m.data)) });
  }
  return pontuados.sort((a, b) => b.pontos - a.pontos || a.distancia - b.distancia).map((p) => p.m);
}

/**
 * Liga as contas abertas aos débitos que as pagaram. Só liga quando não há
 * dúvida: a conta tem um único candidato e esse movimento não é candidato de
 * nenhuma outra conta aberta. Na dúvida, a conta fica aberta e a pessoa
 * escolhe (ver `candidatosDaConta` no modo amplo).
 */
export function conciliarContas(contas: readonly ContaConciliavel[], movimentos: readonly MovimentoConciliavel[]): Ligacao[] {
  const ligados = new Set(contas.filter((c) => c.movimentoId).map((c) => c.movimentoId!));
  const abertas = contas.filter((c) => !c.pagaEm);
  const candidatos = new Map(abertas.map((c) => [c.id, candidatosDaConta(c, movimentos, ligados)]));
  const disputa = new Map<string, number>();
  for (const lista of candidatos.values()) for (const m of lista) disputa.set(m.id, (disputa.get(m.id) ?? 0) + 1);
  const ligacoes: Ligacao[] = [];
  const ordenadas = [...abertas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  for (const c of ordenadas) {
    const lista = candidatos.get(c.id)!;
    if (lista.length !== 1 || disputa.get(lista[0]!.id) !== 1) continue;
    ligacoes.push({ contaId: c.id, movimentoId: lista[0]!.id, data: lista[0]!.data });
  }
  return ligacoes;
}

// ------------------------------------------------------------------ cartão

/** Uma fatura de cartão a pagar, só para mostrar ao lado das contas (nunca guardada como conta). */
export interface VencimentoDeCartao {
  contaId: string;
  cartao: string;
  /** Mês da fatura (o do vencimento). */
  mes: string;
  /** Dia em que fecha; estimado pelo ciclo do cartão quando o banco ainda não disse. */
  fechamento: Dia | null;
  vencimento: Dia;
  /** Quanto falta pagar (total − pago). Na fatura aberta, o que já entrou até agora. */
  valor: Centavos;
  situacao: 'ABERTA' | 'FECHADA';
}

interface FaturaParaVencimento {
  contaId: string;
  mes: string;
  vencimento: Dia;
  total: Centavos;
  pago: Centavos;
  situacao: 'PAGA' | 'FECHADA' | 'ABERTA' | 'FUTURA';
}

/**
 * As faturas que ainda vão ser cobradas: as fechadas que faltam pagar e a
 * aberta. O fechamento vem do banco quando ele mandou a fatura; senão, do ciclo
 * do cartão (quantos dias antes do vencimento ele costuma fechar).
 */
export function vencimentosDeCartao(
  cartoes: readonly { contaId: string; nome: string; faturas: readonly FaturaParaVencimento[] }[],
  ciclos: ReadonlyMap<string, { fechamento: Dia | null; vencimento: Dia | null }>,
  fechamentosDoBanco: ReadonlyMap<string, Dia>,
  hoje: Dia,
): VencimentoDeCartao[] {
  const saida: VencimentoDeCartao[] = [];
  for (const c of cartoes) {
    const ciclo = ciclos.get(c.contaId);
    const antecedencia = ciclo?.fechamento && ciclo.vencimento ? diasEntre(ciclo.fechamento, ciclo.vencimento) : null;
    for (const f of c.faturas) {
      if (f.situacao !== 'ABERTA' && f.situacao !== 'FECHADA') continue;
      const valor = Math.max(0, f.total - f.pago);
      if (f.situacao === 'FECHADA' && valor === 0) continue;
      // Fechada esquecida há meses já rolou para a seguinte: não é vencimento de verdade.
      if (f.situacao === 'FECHADA' && diasEntre(f.vencimento, hoje) > 40) continue;
      const fechamento = fechamentosDoBanco.get(`${c.contaId}|${f.mes}`)
        ?? (antecedencia !== null && antecedencia > 0 && antecedencia < 28 ? somarDias(f.vencimento, -antecedencia) : null);
      saida.push({ contaId: c.contaId, cartao: c.nome, mes: f.mes, fechamento, vencimento: f.vencimento, valor, situacao: f.situacao });
    }
  }
  return saida.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}
