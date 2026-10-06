import { CATEGORIA_POR_ID } from './categorias';
import { categorizar, type Regra } from './categorizacao';
import { classificar, ehDividaReapresentada, ehParaSiMesmo, ehPixNoCreditoNaConta, mesmoDocumento, type ContextoClassificacao } from './classificacao';
import { competencia } from './competencia';
import { diaDoMes, diaNoMes, diasEntre, mesDe, somarMeses } from './datas';
import { apenasDigitosEMascara, chaveDeDescricao, normalizar } from './texto';
import type { Centavos, Dia, Movimento, Natureza, Transacao } from './types';

/** O que o usuário mudou à mão numa transação. Vence qualquer automação. */
export interface Ajuste {
  natureza: Natureza | null;
  categoriaId: string | null;
  nota: string | null;
  ignorar: boolean;
}

/**
 * Transforma transações cruas em movimentos prontos para as telas. Movimentos
 * marcados como "ignorar" somem de todas as contas (mas continuam no extrato
 * para o usuário poder desfazer — quem filtra é `contaveis`).
 */
export function montarMovimentos(
  transacoes: readonly Transacao[],
  ctx: ContextoClassificacao,
  regras: readonly Regra[],
  ajustes: ReadonlyMap<string, Ajuste>,
): Movimento[] {
  const comDatas = inferirDatasDeCompra(transacoes);
  // Pix no crédito só se reconhece olhando a conta e o cartão juntos.
  const comPix = { ...ctx, cobrancasPixNoCredito: ctx.cobrancasPixNoCredito ?? parearPixNoCredito(comDatas) };
  // Entre contas suas: o que vem de (ou vai para) uma conta fora do Fluxo conta.
  const ctxCompleto = { ...comPix, transferenciasDeFora: ctx.transferenciasDeFora ?? transferenciasDeFora(comDatas, comPix) };
  return comDatas.map((t) => {
    const ajuste = ajustes.get(t.id);
    const natureza = ajuste?.natureza ?? classificar(t, ctxCompleto);
    const automatica = categorizar(t, natureza, regras, rendaPropria(t, ctxCompleto) ? 'salario' : null);
    // Categoria manual só vale se for do mesmo grupo da natureza atual: "mercado"
    // escolhido quando era gasto não pode virar fonte de receita depois.
    const grupoAtual = automatica ? CATEGORIA_POR_ID.get(automatica)?.grupo : undefined;
    const manual = ajuste?.categoriaId && CATEGORIA_POR_ID.get(ajuste.categoriaId)?.grupo === grupoAtual ? ajuste.categoriaId : null;
    const categoriaId = automatica === null ? null : (manual ?? automatica);
    return {
      ...t,
      natureza: ajuste?.ignorar ? naturezaIgnorada(natureza) : natureza,
      categoriaId,
      competencia: competencia(t),
      nota: ajuste?.nota ?? null,
      editado: Boolean(ajuste && (ajuste.natureza || ajuste.categoriaId || ajuste.ignorar)),
      ignorado: Boolean(ajuste?.ignorar),
    };
  });
}

/**
 * Parcelas sem data de compra (alguns bancos não mandam): olha as irmãs — mesma
 * conta, mesma loja, mesmo valor e número de parcelas. Se duas ou mais têm a
 * mesma data, aquela é a data da compra. Se estão espalhadas mês a mês, a
 * compra foi na data da primeira, recuada o número dela menos um. Parcela
 * sozinha fica como veio.
 */
export function inferirDatasDeCompra(transacoes: readonly Transacao[]): Transacao[] {
  const grupos = new Map<string, Transacao[]>();
  for (const t of transacoes) {
    if (!t.parcela || t.parcela.dataCompra || t.parcela.total <= 1) continue;
    const chave = [t.contaId, chaveDeDescricao(t.descricao), t.parcela.total, t.valor].join('|');
    grupos.set(chave, [...(grupos.get(chave) ?? []), t]);
  }
  const dataPorId = new Map<string, string>();
  for (const irmas of grupos.values()) {
    if (irmas.length < 2) continue;
    const porData = new Map<string, Transacao[]>();
    for (const t of irmas) porData.set(t.data, [...(porData.get(t.data) ?? []), t]);
    const repetidas = [...porData.entries()].filter(([, ts]) => ts.length >= 2);
    if (repetidas.length > 0) {
      for (const [data, ts] of repetidas) for (const t of ts) dataPorId.set(t.id, data);
      continue;
    }
    const primeira = irmas.reduce((a, b) => (b.parcela!.numero < a.parcela!.numero ? b : a));
    const recuada = diaNoMes(somarMeses(mesDe(primeira.data), -(primeira.parcela!.numero - 1)), diaDoMes(primeira.data));
    for (const t of irmas) dataPorId.set(t.id, recuada);
  }
  if (dataPorId.size === 0) return [...transacoes];
  return transacoes.map((t) => (dataPorId.has(t.id) ? { ...t, parcela: { ...t.parcela!, dataCompra: dataPorId.get(t.id)! } } : t));
}

/** Instante de compra à meia-noite UTC cravada é só o dia: não separa duas compras do mesmo dia. */
const INSTANTE_SEM_HORA = /T00:00:00(\.0+)?Z$/;

/**
 * Chave de cada compra parcelada (id → chave), para juntar as parcelas dela.
 * Mesma compra = mesmo instante (com hora) e mesmo número de parcelas: descrição
 * e centavos mudam entre parcelas, e duas compras no mesmo dia têm horas
 * diferentes. Se o instante não tem hora, ou alguma irmã (mesma conta, dia e
 * número de parcelas) veio sem ele, vale a chave antiga — descrição + valor
 * total + dia —, senão a parcela sem instante viraria uma compra fantasma.
 */
export function chavesDasCompras(transacoes: readonly Transacao[]): Map<string, string> {
  const irmas = new Map<string, Transacao[]>();
  for (const t of transacoes) {
    if (!t.parcela || t.parcela.total <= 1) continue;
    const chave = [t.contaId, t.parcela.dataCompra ?? '', t.parcela.total].join('|');
    irmas.set(chave, [...(irmas.get(chave) ?? []), t]);
  }
  const chaves = new Map<string, string>();
  for (const grupo of irmas.values()) {
    const peloInstante = grupo.every((t) => t.parcela!.instanteCompra && !INSTANTE_SEM_HORA.test(t.parcela!.instanteCompra));
    for (const t of grupo) {
      const p = t.parcela!;
      chaves.set(t.id, peloInstante
        ? [t.contaId, p.instanteCompra, p.total].join('|')
        : [t.contaId, chaveDeDescricao(t.descricao), p.total, p.valorTotal ?? t.valor * p.total, p.dataCompra ?? ''].join('|'));
    }
  }
  return chaves;
}

/**
 * Teto da cobrança sobre o valor posto na conta. Nos dados reais: 1,10–1,13 à
 * vista e 1,25 em 3x; IOF + juros de um parcelamento longo ficam abaixo disso.
 */
const TETO_COBRANCA_PIX_NO_CREDITO = 1.5;

/**
 * Pix no crédito: o Nubank põe o valor na conta ("Valor adicionado na conta
 * por cartão de crédito", texto do banco, que ninguém forja) e cobra no cartão,
 * no mesmo dia, esse valor + IOF/juros — com o texto que quiser (o nome de quem
 * recebeu, "Pagamento de pix"…). Devolve os ids das cobranças do cartão que têm
 * esse par, com todas as parcelas da compra. Cada lado pareia uma vez só; a
 * cobrança mais próxima do valor ganha. Igual ao valor não serve: sempre há
 * IOF, e uma compra comum de mesmo preço no mesmo dia não é o Pix.
 */
export function parearPixNoCredito(transacoes: readonly Transacao[]): Set<string> {
  const adicionados = transacoes.filter(ehPixNoCreditoNaConta);
  if (adicionados.length === 0) return new Set();
  const chaves = chavesDasCompras(transacoes);
  // Uma compra por chave: o dia é o da compra e o valor é o total cobrado (todas as parcelas).
  const compras = new Map<string, { dia: Dia | null; cobrado: Centavos; ids: string[] }>();
  for (const t of transacoes) {
    if (t.tipoConta !== 'CARTAO' || t.sentido !== 'SAIDA' || ehDividaReapresentada(t)) continue;
    const p = t.parcela && t.parcela.total > 1 ? t.parcela : null;
    // Parcela sem data de compra: só a primeira cai no dia da compra.
    const dia = p ? (p.dataCompra ?? (p.numero === 1 ? t.data : null)) : t.data;
    const cobrado = p ? (p.valorTotal ?? t.valor * p.total) : t.valor;
    const chave = chaves.get(t.id) ?? t.id;
    const compra = compras.get(chave);
    if (!compra) compras.set(chave, { dia, cobrado, ids: [t.id] });
    else {
      compra.ids.push(t.id);
      compra.dia ??= dia;
      compra.cobrado = Math.max(compra.cobrado, cobrado);
    }
  }
  const candidatos: { adicionado: string; compra: string; razao: number }[] = [];
  for (const a of adicionados) {
    for (const [chave, c] of compras) {
      if (c.dia !== a.data || c.cobrado <= a.valor || c.cobrado > a.valor * TETO_COBRANCA_PIX_NO_CREDITO) continue;
      candidatos.push({ adicionado: a.id, compra: chave, razao: c.cobrado / a.valor });
    }
  }
  candidatos.sort((x, y) => x.razao - y.razao);
  const adicionadosUsados = new Set<string>();
  const comprasUsadas = new Set<string>();
  const pareadas = new Set<string>();
  for (const { adicionado, compra } of candidatos) {
    if (adicionadosUsados.has(adicionado) || comprasUsadas.has(compra)) continue;
    adicionadosUsados.add(adicionado);
    comprasUsadas.add(compra);
    for (const id of compras.get(compra)!.ids) pareadas.add(id);
  }
  return pareadas;
}

/** Dias de folga para uma ida-e-volta entre contas suas (manda e recebe o mesmo valor). */
const JANELA_IDA_E_VOLTA = 5;

/**
 * Transferências para si mesmo, na conta, que NÃO têm o outro lado no Fluxo.
 * O Fluxo só vê as contas conectadas: o salário que cai em outro banco (ou na
 * conta da empresa, em nome da pessoa) e é passado para o Nubank é renda do ponto de vista
 * dele — e o que sai para uma conta fora, gasto. Só fica neutro o que se
 * cancela: o mesmo valor saindo e entrando em até 5 dias, na mesma conta (ida
 * e volta) ou em duas contas conectadas. O pareamento é um para um, do par
 * mais próximo no tempo para o mais distante.
 */
export function transferenciasDeFora(transacoes: readonly Transacao[], ctx: ContextoClassificacao): Set<string> {
  const proprias = transacoes.filter(
    (t) => t.tipoConta === 'CONTA' && !ehPixNoCreditoNaConta(t) && ehParaSiMesmo(t, ctx) && classificar(t, ctx) === 'TRANSFERENCIA',
  );
  const entradas = proprias.filter((t) => t.sentido === 'ENTRADA');
  const saidas = proprias.filter((t) => t.sentido === 'SAIDA');
  const pares: { entrada: string; saida: string; distancia: number }[] = [];
  for (const e of entradas) {
    for (const s of saidas) {
      if (s.valor !== e.valor || s.id === e.id) continue;
      const distancia = Math.abs(diasEntre(s.data, e.data));
      if (distancia <= JANELA_IDA_E_VOLTA) pares.push({ entrada: e.id, saida: s.id, distancia });
    }
  }
  pares.sort((a, b) => a.distancia - b.distancia);
  const pareadas = new Set<string>();
  for (const p of pares) {
    if (pareadas.has(p.entrada) || pareadas.has(p.saida)) continue;
    pareadas.add(p.entrada);
    pareadas.add(p.saida);
  }
  return new Set(proprias.filter((t) => !pareadas.has(t.id)).map((t) => t.id));
}

/**
 * Dinheiro da própria pessoa entrando: de outra conta dela fora do Fluxo, ou
 * da empresa dela (CNPJ com o nome do titular, como "12.345.678 FULANO DE TAL").
 * Vira "Salário" — a não ser que uma regra do usuário diga outra coisa.
 */
function rendaPropria(t: Transacao, ctx: ContextoClassificacao): boolean {
  if (t.tipoConta !== 'CONTA' || t.sentido !== 'ENTRADA') return false;
  if (ctx.transferenciasDeFora?.has(t.id)) return true;
  const documento = apenasDigitosEMascara(t.contraparteDocumento);
  if (documento.length !== 14 || ctx.documentosDoTitular.some((d) => mesmoDocumento(t.contraparteDocumento, d))) return false;
  const nome = normalizar(t.contraparteNome);
  return ctx.nomesDoTitular.some((titular) => titular.length > 0 && nome.includes(titular));
}

/**
 * Ignorar = tratar como dinheiro seu trocando de lugar. Reaproveita
 * TRANSFERENCIA para não criar um caso especial em cada soma.
 */
function naturezaIgnorada(_n: Natureza): Natureza {
  return 'TRANSFERENCIA';
}

/** Sinal do movimento no resultado do mês: receita soma, despesa subtrai, estorno devolve. */
export function efeitoNoResultado(m: Movimento): number {
  switch (m.natureza) {
    case 'RECEITA':
      return m.valor;
    case 'DESPESA':
      return -m.valor;
    case 'ESTORNO':
      return m.valor;
    default:
      return 0;
  }
}

/** Valor que o movimento soma aos gastos de uma categoria (estorno abate). */
export function valorDeGasto(m: Movimento): number {
  if (m.natureza === 'DESPESA') return m.valor;
  if (m.natureza === 'ESTORNO') return -m.valor;
  return 0;
}
