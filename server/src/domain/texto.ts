/** Minúsculas, sem acento e com espaços colapsados — para comparar textos de banco. */
export function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chave estável de um estabelecimento/descrição: tira números de parcela,
 * datas, códigos e sufixos que mudam a cada cobrança ("NETFLIX.COM 12/08",
 * "Uber *Trip HELP.UBER", "Parcela 3/10") para agrupar a mesma coisa.
 */
export function chaveDeDescricao(texto: string | null | undefined): string {
  return normalizar(texto)
    .replace(/\bparcela\s*\d+\s*(de|\/)\s*\d+\b/g, ' ')
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/g, ' ')
    .replace(/[*#]+\s*[a-z0-9]*/g, ' ')
    .replace(/\b(pagamento|compra|debito|credito|no|em|de|da|do)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function apenasDigitosEMascara(documento: string | null | undefined): string {
  return (documento ?? '').replace(/[^0-9*]/g, '');
}
