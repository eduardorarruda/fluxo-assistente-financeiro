/** Texto de busca de um movimento: o que vai para o índice de palavras e de vetores. */

export interface MovimentoParaIndice {
  id: string;
  data: string;
  descricao: string;
  estabelecimento: string | null;
  contraparteNome: string | null;
  categoria: string;
  natureza: string;
  /** Centavos. */
  valor: number;
  sentido: 'ENTRADA' | 'SAIDA';
  conta: string;
  parcela: { numero: number; total: number } | null;
  nota: string | null;
}

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos inteiros → "R$ 1.234,56" (com espaço comum, que o tokenizador separa como qualquer outro). */
export function formatarReais(centavos: number): string {
  return REAIS.format(centavos / 100).replace(/\s/g, ' ');
}

export function textoDoMovimento(m: MovimentoParaIndice): string {
  const partes: (string | null)[] = [
    m.data,
    m.descricao.trim(),
    rotulado('Loja', m.estabelecimento),
    rotulado('Contraparte', m.contraparteNome),
    rotulado('Categoria', m.categoria),
    rotulado('Natureza', m.natureza),
    `${m.sentido === 'SAIDA' ? 'Saída' : 'Entrada'} de ${formatarReais(Math.abs(m.valor))}`,
    rotulado('Conta', m.conta),
    m.parcela ? `Parcela ${m.parcela.numero}/${m.parcela.total}` : null,
    rotulado('Nota', m.nota),
  ];
  return partes.filter((p): p is string => Boolean(p)).join(' · ');
}

function rotulado(rotulo: string, valor: string | null): string | null {
  const limpo = valor?.trim();
  return limpo ? `${rotulo}: ${limpo}` : null;
}
