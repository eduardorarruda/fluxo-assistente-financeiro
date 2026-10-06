import { CATEGORIA_POR_ID, CATEGORIAS } from '../../domain/categorias';
import { normalizar } from '../../domain/texto';
import type { Centavos, Mes, Movimento } from '../../domain/types';

/**
 * O que as ferramentas devolvem é lido por um modelo de linguagem: valores em
 * reais (nunca centavos — o modelo confunde), nomes de categoria em vez de
 * ids, nada de campos internos.
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function reais(centavos: Centavos): number {
  return Math.round(centavos) / 100;
}

/** '2026-09' → 'set/2026'. */
export function mesLegivel(mes: Mes): string {
  const [ano, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

export function nomeCategoria(id: string | null | undefined): string | null {
  return id ? (CATEGORIA_POR_ID.get(id)?.nome ?? id) : null;
}

/** Jeitos comuns de falar de uma categoria que não são o nome dela ("Combustível" é "Carro e combustível"). */
const APELIDOS: Readonly<Record<string, string>> = {
  combustivel: 'carro', gasolina: 'carro', etanol: 'carro', posto: 'carro', supermercado: 'mercado', feira: 'mercado',
  farmacia: 'saude', remedio: 'saude', remedios: 'saude', luz: 'contas', energia: 'contas', agua: 'contas', internet: 'contas',
  aluguel: 'moradia', condominio: 'moradia', roupa: 'vestuario', streaming: 'assinaturas', academia: 'lazer', pet: 'pets',
  restaurante: 'restaurantes', viagem: 'viagem', presente: 'presentes', imposto: 'taxas', impostos: 'taxas',
};

/**
 * Aceita o id ("mercado"), o nome ("Mercado", "Contas da casa"), um apelido
 * ("combustível", "luz") ou uma palavra que só um nome tem ("combustível" em
 * "Carro e combustível") e devolve o id. Ambíguo ou desconhecido: null.
 */
export function categoriaPorTexto(texto: string): string | null {
  const alvo = normalizar(texto);
  const exata = CATEGORIAS.find((c) => c.id === texto || normalizar(c.id) === alvo || normalizar(c.nome) === alvo);
  if (exata) return exata.id;
  if (!alvo) return null;
  if (APELIDOS[alvo]) return APELIDOS[alvo];
  const palavra = new RegExp(`\\b${alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const parecidas = CATEGORIAS.filter((c) => palavra.test(normalizar(c.nome)));
  return parecidas.length === 1 ? parecidas[0]!.id : null;
}

export function nomesDeCategorias(): string {
  return CATEGORIAS.map((c) => c.nome).join(', ');
}

export interface MovimentoParaAgente {
  id: string;
  data: string;
  competencia: string;
  descricao: string;
  estabelecimento: string | null;
  contraparte: string | null;
  valor: number;
  sentido: 'ENTRADA' | 'SAIDA';
  natureza: string;
  categoria: string | null;
  conta: string;
  tipoConta: string;
  parcela: string | null;
  pendente: boolean;
  nota: string | null;
  ignorado: boolean;
}

export function movimentoParaAgente(m: Movimento & { conta: string }): MovimentoParaAgente {
  return {
    id: m.id,
    data: m.data,
    competencia: m.competencia,
    descricao: m.descricao,
    estabelecimento: m.estabelecimento,
    contraparte: m.contraparteNome,
    valor: reais(m.valor),
    sentido: m.sentido,
    natureza: m.natureza,
    categoria: nomeCategoria(m.categoriaId),
    conta: m.conta,
    tipoConta: m.tipoConta,
    parcela: m.parcela ? `${m.parcela.numero}/${m.parcela.total}` : null,
    pendente: m.pendente,
    nota: m.nota,
    ignorado: m.ignorado,
  };
}

export function totaisPorCategoria(linhas: readonly { categoriaId: string; valor: Centavos; quantidade?: number }[], total: Centavos) {
  return linhas.map((l) => ({
    categoria: nomeCategoria(l.categoriaId),
    valor: reais(l.valor),
    ...(l.quantidade !== undefined ? { quantidade: l.quantidade } : {}),
    percentual: total ? Math.round((l.valor / total) * 1000) / 10 : 0,
  }));
}
