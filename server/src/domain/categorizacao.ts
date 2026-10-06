import { CATEGORIA_POR_ID, type GrupoCategoria } from './categorias';
import { normalizar } from './texto';
import type { Natureza, Sentido, Transacao } from './types';

export interface Regra {
  id: string;
  /** Trecho procurado na descrição/estabelecimento (sem diferenciar acento e caixa). */
  texto: string;
  categoriaId: string;
  sentido: Sentido | null;
  /** Menor número = testada primeiro. */
  prioridade: number;
}

type Padrao = readonly [RegExp, string];

/**
 * Estabelecimentos pela descrição do extrato. A ordem é a regra de desempate:
 * "amazon prime" precisa virar assinatura antes de "amazon" virar compra, e
 * "mercado livre" precisa virar compra antes de "mercado" virar supermercado,
 * e "posto" vira combustível antes de "carrefour" virar mercado.
 */
const DESCRICAO_DESPESA: readonly Padrao[] = [
  [/ifood|\b99 ?food\b|rappi|ze delivery|uber ?eats|aiqfome|james delivery/, 'delivery'],
  [/netflix|spotify|disney|hbo|\bmax\b|prime ?video|amazon prime|youtube premium|google one|google storage|deezer|apple\.com|icloud|chatgpt|openai|anthropic|claude\.ai|github|globoplay|paramount|crunchyroll|microsoft 365|adobe/, 'assinaturas'],
  [/\buber\b|\b99 ?(app|pop|taxi|ride|tecnologia)\b|cabify|\bmetro\b|bilhete unico|sptrans|recarga transporte/, 'transporte'],
  [/mercado ?livre|amazon|shopee|aliexpress|magalu|magazine luiza|americanas|shein|kabum|casas bahia|temu/, 'compras'],
  // Posto dentro de hipermercado ("Carrefour Posto") é combustível.
  [/\bposto\b/, 'carro'],
  [/supermercado|\bmercado\b|carrefour|pao de acucar|assai|atacadao|hortifruti|sacolao|makro|sonda/, 'mercado'],
  [/drogasil|droga raia|\braia\b|drogaria|farmacia|pague menos|panvel|laboratorio|clinica|hospital|dentista|unimed|hapvida|odonto/, 'saude'],
  [/shell|ipiranga|petrobras|br mania|estacionamento|sem parar|conectcar|veloe|pedagio|auto ?pecas|oficina|detran|departamento estadual de transito|ipva/, 'carro'],
  [/latam|gol linhas|azul linhas|airbnb|booking|hotel|decolar|123milhas|hurb|rodoviaria|buser/, 'viagem'],
  [/enel|sabesp|cemig|copel|comgas|\bvivo\b|\bclaro\b|\btim\b|oi fibra|\bsky\b|energia eletrica|agua e esgoto/, 'contas'],
  [/aluguel|condominio|quinto ?andar|imobiliaria|\biptu\b/, 'moradia'],
  [/restaurante|lanchonete|padaria|pizzaria|burger|\bbar\b|\bcafe\b|cafeteria|starbucks|mc ?donalds|subway|outback|churrascaria|sorveteria/, 'restaurantes'],
  [/cinema|cinemark|ingresso|sympla|eventim|steam|playstation|xbox|nintendo|smart ?fit|academia|gympass|wellhub|totalpass/, 'lazer'],
  [/escola|faculdade|universidade|\bcurso\b|udemy|alura|coursera|livraria/, 'educacao'],
  [/petz|cobasi|pet ?shop|veterinari/, 'pets'],
  [/renner|riachuelo|\bc&a\b|\bzara\b|hering|centauro|netshoes|\bnike\b|adidas/, 'vestuario'],
  [/barbearia|\bsalao\b|cabeleireir|manicure|boticario|\bnatura\b|sephora/, 'cuidados'],
  [/\biof\b|\bjuros\b|encargos|\bmulta\b/, 'juros'],
  [/tarifa|anuidade|imposto|\bdarf\b|ministerio da fazenda|receita federal/, 'taxas'],
  [/doacao|vakinha/, 'presentes'],
];

const DESCRICAO_RECEITA: readonly Padrao[] = [
  // Texto do Nubank, sempre no começo; no meio poderia ser mensagem de um Pix.
  [/^deposito de emprestimo/, 'emprestimo'],
  [/salario|folha de pagamento|proventos|vencimentos/, 'salario'],
  [/rendimento|juros sobre saldo|remuneracao|dividendos/, 'rendimentos'],
  [/estorno|reembolso|devolucao|cashback/, 'reembolsos'],
  [/pix recebido|transferencia recebida|ted recebida/, 'pix-recebido'],
];

/**
 * Categoria que a Pluggy dá (em inglês). A ordem de novo decide: "gas stations"
 * vira carro antes de "gas" (conta de gás) virar conta da casa; "bus tickets"
 * (rodoviária) vira viagem antes de "bus" virar transporte.
 */
const PROVEDOR_DESPESA: readonly Padrao[] = [
  [/food delivery|delivery/, 'delivery'],
  [/groceries|supermarket/, 'mercado'],
  [/eating out|restaurant|food and drinks|bakery/, 'restaurantes'],
  [/gas station|fuel|parking|toll|vehicle|automotive|car rental|traffic ticket/, 'carro'],
  [/airport|airline|accommodation|travel|mileage|bus tickets|lodging/, 'viagem'],
  [/taxi|ride.hailing|public transportation|bicycle|transportation/, 'transporte'],
  [/pharmacy|health|dentist|hospital|clinic|optometry|\blab/, 'saude'],
  [/loan|financing/, 'dividas'],
  [/education|school|university|course|bookstore/, 'educacao'],
  [/late payment|overdraft|interests charged|interest/, 'juros'],
  [/\btax|bank fee|account fee|credit card fee|wire transfer fee|\batm\b/, 'taxas'],
  [/streaming|digital service|gaming|software|subscription/, 'assinaturas'],
  [/\bpet/, 'pets'],
  [/clothing|apparel/, 'vestuario'],
  [/donation|charity/, 'presentes'],
  [/gambling|lottery|\bbet\b|tickets|leisure|entertainment|sport|wellness|fitness|\bgym/, 'lazer'],
  [/\brent\b|housing|houseware|urban land|property/, 'moradia'],
  [/utilities|water|electricity|\bgas\b|telecommunication|internet|mobile|\btv\b|insurance/, 'contas'],
  [/shopping|electronics|online|kids|toys|office|department/, 'compras'],
  [/beauty|personal care|cosmetic/, 'cuidados'],
  [/transfer|\bpix\b|\bted\b|\bdoc\b|third.party|boleto|bank slip/, 'pix-enviado'],
];

const PROVEDOR_RECEITA: readonly Padrao[] = [
  [/salary|wage|payroll/, 'salario'],
  [/proceeds|dividend|interest|investment income/, 'rendimentos'],
  [/refund|reimbursement|cashback/, 'reembolsos'],
  [/entrepreneurial|freelanc|self.employed/, 'renda-extra'],
  [/transfer|\bpix\b|\bted\b|\bdoc\b/, 'pix-recebido'],
];

function primeiro(padroes: readonly Padrao[], texto: string): string | null {
  if (!texto) return null;
  for (const [padrao, categoria] of padroes) if (padrao.test(texto)) return categoria;
  return null;
}

function grupoDa(natureza: Natureza): GrupoCategoria | null {
  if (natureza === 'DESPESA' || natureza === 'ESTORNO') return 'DESPESA';
  if (natureza === 'RECEITA') return 'RECEITA';
  return null;
}

/** Aplica as regras do usuário na ordem de prioridade; a primeira que casa vence. */
function porRegra(t: Transacao, grupo: GrupoCategoria, regras: readonly Regra[]): string | null {
  const alvo = normalizar(`${t.descricao} ${t.estabelecimento ?? ''} ${t.contraparteNome ?? ''}`);
  const ordenadas = [...regras].sort((a, b) => a.prioridade - b.prioridade);
  for (const regra of ordenadas) {
    if (regra.sentido && regra.sentido !== t.sentido) continue;
    if (CATEGORIA_POR_ID.get(regra.categoriaId)?.grupo !== grupo) continue;
    const trecho = normalizar(regra.texto);
    if (trecho && alvo.includes(trecho)) return regra.categoriaId;
  }
  return null;
}

/**
 * Categoria de um movimento: regra do usuário → estabelecimento conhecido →
 * categoria do provedor → "outros". Devolve null para o que não é gasto nem
 * ganho (fatura, caixinha, transferência entre contas suas).
 */
export function categorizar(t: Transacao, natureza: Natureza, regras: readonly Regra[], sugestao: string | null = null): string | null {
  const grupo = grupoDa(natureza);
  if (!grupo) return null;
  // O que o contexto sabe (ex.: dinheiro vindo de outra conta sua = salário) só perde para regra do usuário.
  const sugerida = sugestao && CATEGORIA_POR_ID.get(sugestao)?.grupo === grupo ? sugestao : null;

  const descricao = normalizar(`${t.descricao} ${t.estabelecimento ?? ''}`);
  const provedor = normalizar(t.categoriaProvedor);
  const despesa = grupo === 'DESPESA';

  return (
    porRegra(t, grupo, regras) ??
    sugerida ??
    primeiro(despesa ? DESCRICAO_DESPESA : DESCRICAO_RECEITA, descricao) ??
    primeiro(despesa ? PROVEDOR_DESPESA : PROVEDOR_RECEITA, provedor) ??
    (despesa ? 'outros' : 'outras-receitas')
  );
}
