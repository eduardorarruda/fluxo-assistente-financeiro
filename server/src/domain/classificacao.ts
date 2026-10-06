import { apenasDigitosEMascara, normalizar } from './texto';
import type { Natureza, Transacao } from './types';

export interface ContextoClassificacao {
  /** CPF/CNPJ do titular, só dígitos. */
  documentosDoTitular: readonly string[];
  /** Nome do titular normalizado (ver `normalizar`). */
  nomesDoTitular: readonly string[];
  /** Cobranças do cartão pareadas com um Pix no crédito na conta (ver `parearPixNoCredito`). */
  cobrancasPixNoCredito?: ReadonlySet<string>;
  /**
   * Transferências para si mesmo que cruzam a fronteira do Fluxo: vêm de (ou vão
   * para) uma conta sua que NÃO está conectada — o salário que cai em outro banco
   * ou na conta da empresa e é passado para o Nubank. Essas contam como entrada/saída; as que
   * têm o outro lado numa conta conectada (ou voltam logo) seguem neutras.
   * Ver `transferenciasDeFora` em movimentos.ts.
   */
  transferenciasDeFora?: ReadonlySet<string>;
}

/*
 * As palavras-chave casam só no COMEÇO da descrição: é assim que o próprio
 * Nubank escreve os lançamentos dele ("Pagamento de fatura", "Aplicação RDB").
 * No meio do texto elas poderiam vir da mensagem de um Pix de outra pessoa —
 * e um Pix "aplicacao rdb" de um estranho não pode sumir dos gastos.
 */
const FATURA_NA_CONTA = /^(pagamento|pgto|pag)\.?\s*(de\s+|da\s+)?fatura|^pagamento_fatura/;
const FATURA_NO_CARTAO = /^(pagamento recebido|pagamento de fatura|pagamento_fatura|pgto\.? fatura)/;
const CAIXINHA = /^((aplicacao|resgate)\s+(rdb|cdb|caixinha)|dinheiro\s+(guardado|resgatado)|caixinha|aplicacao automatica|resgate automatico)/;
const RENDIMENTO = /^(rendimento|juros sobre saldo|remuneracao)/;

/*
 * Textos que o próprio Nubank escreve. Na conta a Pluggy monta a descrição como
 * "<operação do Nubank>|<nome da contraparte>": o começo é do banco, nunca da
 * mensagem do Pix — por isso estes valem mesmo em Pix/TED com terceiro.
 */
// Parcelar a fatura: o crédito zera a fatura antiga e as parcelas a cobram de novo.
const PARCELAMENTO_FATURA = /^parcelamento de fatura/;
const CREDITO_PARCELAMENTO = /^credito de parcelamento/;
// Pix no crédito: o cartão põe o valor na conta, de onde sai o Pix (e cobra valor + IOF/juros).
const PIX_NO_CREDITO_NA_CONTA = /^valor adicionado na conta por cartao de credito/;
const REEMBOLSO_PIX = /^reembolso recebido pelo pix/;
/** Sufixo de parcela que o cartão põe depois do nome ("Fulano 3/3"). */
const SUFIXO_PARCELA = /^( \d{1,3}\/\d{1,3})?$/;

/** Categorias de investimento da Pluggy (família 03), menos proventos (0306), que são receita. */
const INVESTIMENTO_PROVEDOR = /automatic investment|fixed income|variable income|mutual fund|pension|^investments?$|^margin/;
const PROVENTOS_PROVEDOR = /proceeds|interests and dividends|dividend/;

const MEIOS_ENTRE_PESSOAS = new Set(['PIX', 'TED', 'DOC', 'TEF']);

/**
 * CPF que o Open Finance manda mascarado ("***.456.789-**") casa com o do
 * titular quando todos os dígitos visíveis batem na mesma posição — e há
 * pelo menos quatro deles, para uma máscara quase total não casar com todo mundo.
 */
export function mesmoDocumento(a: string | null | undefined, doTitular: string): boolean {
  const doc = apenasDigitosEMascara(a);
  if (doc.length === 0 || doc.length !== doTitular.length) return false;
  let visiveis = 0;
  for (let i = 0; i < doc.length; i++) {
    const c = doc[i];
    if (c === '*') continue;
    if (c !== doTitular[i]) return false;
    visiveis++;
  }
  return visiveis >= 4;
}

export function ehParaSiMesmo(t: Transacao, ctx: ContextoClassificacao): boolean {
  if (normalizar(t.categoriaProvedor).includes('same person')) return true;
  if (ctx.documentosDoTitular.some((d) => mesmoDocumento(t.contraparteDocumento, d))) return true;
  const nome = normalizar(t.contraparteNome);
  return nome.length > 0 && ctx.nomesDoTitular.includes(nome);
}

/** Pix/TED com outra pessoa: a descrição pode ter texto escrito por ela. */
function comTerceiro(t: Transacao, ctx: ContextoClassificacao): boolean {
  const entrePessoas = MEIOS_ENTRE_PESSOAS.has((t.meioPagamento ?? '').toUpperCase()) || Boolean(t.contraparteNome);
  return entrePessoas && !ehParaSiMesmo(t, ctx);
}

/**
 * Pix no crédito para a própria conta sem o outro lado na conta (histórico mais
 * antigo que o da conta): o cartão descreve a cobrança só com o nome do
 * recebedor. O nome inteiro precisa bater — "Fulano Doces" é loja — e não pode
 * haver loja por trás (estabelecimento/CNPJ), porque no cartão o texto é dela.
 */
function cartaoPagouOTitular(t: Transacao, descricao: string, ctx: ContextoClassificacao): boolean {
  if (t.estabelecimento || t.cnpjEstabelecimento) return false;
  return ctx.nomesDoTitular.some((nome) => nome.length > 0 && descricao.startsWith(nome) && SUFIXO_PARCELA.test(descricao.slice(nome.length)));
}

/** O "Valor adicionado na conta por cartão de crédito": o lado da conta de um Pix no crédito. */
export function ehPixNoCreditoNaConta(t: Transacao): boolean {
  return t.tipoConta !== 'CARTAO' && t.sentido === 'ENTRADA' && PIX_NO_CREDITO_NA_CONTA.test(normalizar(t.descricao));
}

/** Rotativo e parcelamento da fatura: o cartão reapresenta dívida antiga, não compra nada. */
export function ehDividaReapresentada(t: Transacao): boolean {
  if (t.tipoConta !== 'CARTAO' || t.sentido !== 'SAIDA') return false;
  // O Nubank manda o parcelamento como OTHER, então o texto dele também vale.
  return t.outroCredito === 'REVOLVING_CREDIT' || t.outroCredito === 'BILL_INSTALLMENT' || PARCELAMENTO_FATURA.test(normalizar(t.descricao));
}

/**
 * O que é um crédito (entrada) no cartão. Não depende do usuário nem do
 * titular: a fatura usa isto para saber o que o banco abate.
 */
export function creditoNoCartao(t: Transacao): 'PAGAMENTO_FATURA' | 'TRANSFERENCIA' | 'ESTORNO' {
  const descricao = normalizar(t.descricao);
  // Antes da categoria: o parcelamento pode vir marcado como "credit card payment" e não é pagamento.
  if (CREDITO_PARCELAMENTO.test(descricao)) return 'TRANSFERENCIA';
  if (FATURA_NO_CARTAO.test(descricao) || normalizar(t.categoriaProvedor).includes('credit card payment')) return 'PAGAMENTO_FATURA';
  return 'ESTORNO';
}

function ehInvestimentoNoProvedor(t: Transacao): boolean {
  const id = t.categoriaProvedorId ?? '';
  if (id.startsWith('03')) return !id.startsWith('0306');
  return INVESTIMENTO_PROVEDOR.test(normalizar(t.categoriaProvedor));
}

function ehProventoNoProvedor(t: Transacao): boolean {
  return (t.categoriaProvedorId ?? '').startsWith('0306') || PROVENTOS_PROVEDOR.test(normalizar(t.categoriaProvedor));
}

/**
 * Decide o que um movimento *é*. A ordem das perguntas importa: pagamento de
 * fatura e caixinha vêm antes de "é para mim mesmo?", porque o Nubank às vezes
 * preenche o próprio titular como contraparte desses.
 */
export function classificar(t: Transacao, ctx: ContextoClassificacao): Natureza {
  const descricao = normalizar(t.descricao);
  const categoria = normalizar(t.categoriaProvedor);

  if (t.tipoConta === 'CARTAO') {
    if (t.sentido === 'ENTRADA') return creditoNoCartao(t);
    // As compras da dívida reapresentada já contaram.
    if (ehDividaReapresentada(t)) return 'TRANSFERENCIA';
    // Pix no crédito: o gasto é contado no Pix que sai da conta, com a categoria de quem recebeu.
    // A cobrança é reconhecida pelo par na conta, não pelo texto — no cartão o texto é da loja.
    if (ctx.cobrancasPixNoCredito?.has(t.id) || cartaoPagouOTitular(t, descricao, ctx)) return 'TRANSFERENCIA';
    return 'DESPESA';
  }

  if (t.sentido === 'ENTRADA') {
    // A Pluggy põe o recebedor final do Pix no crédito como pagador: não é renda, é o cartão.
    if (PIX_NO_CREDITO_NA_CONTA.test(descricao)) return 'TRANSFERENCIA';
    // "Depósito de empréstimo" segue a regra geral (receita): as parcelas pagas saem como despesa,
    // então o principal entra e sai uma vez. Tirar a entrada contaria o principal como gasto a mais.
    if (REEMBOLSO_PIX.test(descricao)) return 'ESTORNO';
  }

  const terceiro = comTerceiro(t, ctx);

  if (t.sentido === 'SAIDA' && (categoria.includes('credit card payment') || (!terceiro && FATURA_NA_CONTA.test(descricao)))) {
    return 'PAGAMENTO_FATURA';
  }

  if (ehProventoNoProvedor(t) || (!terceiro && RENDIMENTO.test(descricao))) {
    return t.sentido === 'ENTRADA' ? 'RECEITA' : 'DESPESA';
  }

  if (ehInvestimentoNoProvedor(t) || (!terceiro && CAIXINHA.test(descricao))) return 'INVESTIMENTO';

  // Entre contas suas: só é neutra quando as duas pontas estão no Fluxo.
  if (ehParaSiMesmo(t, ctx) && !ctx.transferenciasDeFora?.has(t.id)) return 'TRANSFERENCIA';

  return t.sentido === 'ENTRADA' ? 'RECEITA' : 'DESPESA';
}
