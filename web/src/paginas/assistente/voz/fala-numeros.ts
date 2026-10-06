/**
 * Números do jeito que se falam. A voz natural (Piper, pelo espeak-ng) lê
 * "R$ 1.234,56" como "erre cifrão um ponto duzentos…"; aqui o texto vira
 * "mil duzentos e trinta e quatro reais e cinquenta e seis centavos" ANTES de
 * ir para a síntese. A legenda continua com o texto original. Para a voz do
 * navegador também não atrapalha: ela lê as palavras como estão.
 *
 * Cobre o que o assistente costuma dizer: dinheiro (R$, com "mil"/"milhões"),
 * porcentagem, datas (05/09, 05/09/2026, 2026-09-05, 09/2026, set/2026),
 * parcelas (3/10, 10x), horas (14h30), ordinais (1º, 2ª) e números soltos.
 */

export type Genero = 'm' | 'f';

const UNIDADES_M = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS_M = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

const ORDINAIS_UNIDADE = ['', 'primeir', 'segund', 'terceir', 'quart', 'quint', 'sext', 'sétim', 'oitav', 'non'];
const ORDINAIS_DEZENA = ['', 'décim', 'vigésim', 'trigésim', 'quadragésim', 'quinquagésim', 'sexagésim', 'septuagésim', 'octogésim', 'nonagésim'];

/** Palavras femininas comuns nas respostas: "2 compras" → "duas compras". */
const FEMININAS = /^(compras?|parcelas?|vez|vezes|transaç(?:ão|ões)|faturas?|contas?|semanas?|horas?|assinaturas?|categorias?|metas?|pessoas?|despesas?|receitas?|movimentaç(?:ão|ões)|caixinhas?|cobranças?|mensalidades?|notas?)\b/i;

const feminino = (palavra: string, genero: Genero) => {
  if (genero === 'm') return palavra;
  if (palavra === 'um') return 'uma';
  if (palavra === 'dois') return 'duas';
  return palavra.endsWith('entos') ? palavra.replace(/entos$/, 'entas') : palavra;
};

/** 0–999 por extenso. */
function ate999(n: number, genero: Genero): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(feminino(CENTENAS_M[c] ?? '', genero));
  if (resto) {
    if (resto < 20) partes.push(feminino(UNIDADES_M[resto] ?? '', genero));
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${feminino(UNIDADES_M[u] ?? '', genero)}` : (DEZENAS[d] ?? ''));
    }
  }
  return partes.join(' e ');
}

const ESCALAS: [number, string, string][] = [
  [1e12, 'trilhão', 'trilhões'],
  [1e9, 'bilhão', 'bilhões'],
  [1e6, 'milhão', 'milhões'],
];

/** Inteiro ≥ 0 por extenso, em português do Brasil ("mil duzentos e trinta e quatro"). */
export function porExtenso(n: number, genero: Genero = 'm'): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n >= 1e15) return String(n);
  if (n === 0) return 'zero';
  /** `nucleo`: o 1–999 que multiplica a escala do grupo. */
  const grupos: { nucleo: number; texto: string }[] = [];
  let resto = n;
  for (const [escala, singular, plural] of ESCALAS) {
    const q = Math.floor(resto / escala);
    if (q) grupos.push({ nucleo: q, texto: `${ate999(q, 'm')} ${q === 1 ? singular : plural}` });
    resto %= escala;
  }
  const milhares = Math.floor(resto / 1000);
  if (milhares) grupos.push({ nucleo: milhares, texto: milhares === 1 ? 'mil' : `${ate999(milhares, genero)} mil` });
  const final = resto % 1000;
  if (final) grupos.push({ nucleo: final, texto: ate999(final, genero) });
  // "e" antes do último grupo quando ele é menor que cem ou centena redonda:
  // "mil e vinte", "mil e quinhentos", "dois milhões e quinhentos mil" — mas "mil duzentos e trinta".
  const ultimo = grupos.at(-1);
  if (grupos.length > 1 && ultimo && (ultimo.nucleo < 100 || ultimo.nucleo % 100 === 0)) ultimo.texto = `e ${ultimo.texto}`;
  return grupos.map((g) => g.texto).join(' ');
}

/** "1.234" / "1234" → 1234; null se não for número inteiro. */
const inteiroDe = (s: string): number | null => {
  const limpo = s.replace(/\./g, '');
  return /^\d+$/.test(limpo) ? Number(limpo) : null;
};

/** Parte decimal falada: "5" → "cinco", "05" → "zero cinco". */
function decimais(s: string): string {
  const zeros = s.match(/^0+/)?.[0].length ?? 0;
  const resto = s.slice(zeros);
  return [...Array<string>(zeros).fill('zero'), ...(resto ? [porExtenso(Number(resto))] : [])].join(' ');
}

/** "12,5" → "doze vírgula cinco"; "1.234" → "mil duzentos e trinta e quatro". */
function numeroFalado(texto: string, genero: Genero = 'm'): string | null {
  const [inteira = '', fracao] = texto.split(',');
  const n = inteiroDe(inteira);
  if (n === null) return null;
  return fracao ? `${porExtenso(n, genero)} vírgula ${decimais(fracao)}` : porExtenso(n, genero);
}

const MULTIPLICADORES: Record<string, number> = { mil: 1e3, milhão: 1e6, milhões: 1e6, mi: 1e6, bilhão: 1e9, bilhões: 1e9, bi: 1e9 };

/** Valor em reais → fala. `centavos` inteiros (0–99). */
export function reaisPorExtenso(inteiro: number, centavos = 0): string {
  const partes: string[] = [];
  if (inteiro > 0 || centavos === 0) {
    // "um milhão de reais", "dois bilhões de reais" (redondo em milhão leva "de").
    const de = inteiro >= 1e6 && inteiro % 1e6 === 0 ? ' de' : '';
    partes.push(`${porExtenso(inteiro)}${de} ${inteiro === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${porExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ');
}

const NUMERO = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?`;
const MENOS = String.raw`[-−–]`;
const ANTES = String.raw`(?<![\p{L}\p{N}])`;
const DEPOIS = String.raw`(?![\p{L}\p{N}])`;

function dinheiro(texto: string): string {
  const re = new RegExp(String.raw`(${MENOS}\s?)?R\$\s?(${MENOS}\s?)?(${NUMERO})(?:\s?(mil|milhão|milhões|mi|bilhão|bilhões|bi)${DEPOIS})?`, 'giu');
  return texto.replace(re, (original, menos1: string | undefined, menos2: string | undefined, valor: string, escala: string | undefined) => {
    const [inteira = '', fracao = ''] = valor.split(',');
    const base = inteiroDe(inteira);
    if (base === null) return original;
    const menos = menos1 || menos2 ? 'menos ' : '';
    if (escala) {
      const total = Math.round(Number(`${base}.${fracao || '0'}`) * (MULTIPLICADORES[escala.toLowerCase()] ?? 1));
      return `${menos}${reaisPorExtenso(total)}`;
    }
    const centavos = fracao ? Number(fracao.padEnd(2, '0').slice(0, 2)) : 0;
    return `${menos}${reaisPorExtenso(base, centavos)}`;
  });
}

function porcentagem(texto: string): string {
  const re = new RegExp(String.raw`${ANTES}(${MENOS})?(${NUMERO})\s?%`, 'gu');
  return texto.replace(re, (original, menos: string | undefined, valor: string) => {
    const falado = numeroFalado(valor);
    return falado ? `${menos ? 'menos ' : ''}${falado} por cento` : original;
  });
}

const dia = (d: number) => (d === 1 ? 'primeiro' : porExtenso(d));
const ano = (texto: string) => porExtenso(texto.length === 2 ? 2000 + Number(texto) : Number(texto));
const dataValida = (d: number, m: number) => d >= 1 && d <= 31 && m >= 1 && m <= 12;

function datas(texto: string): string {
  return texto
    // 2026-09-05
    .replace(new RegExp(String.raw`${ANTES}(\d{4})-(\d{2})-(\d{2})${DEPOIS}`, 'gu'), (o, a: string, m: string, d: string) =>
      dataValida(Number(d), Number(m)) ? `${dia(Number(d))} de ${MESES[Number(m) - 1]} de ${ano(a)}` : o)
    // 05/09/2026, 5/9/26
    .replace(new RegExp(String.raw`${ANTES}(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})${DEPOIS}`, 'gu'), (o, d: string, m: string, a: string) =>
      dataValida(Number(d), Number(m)) ? `${dia(Number(d))} de ${MESES[Number(m) - 1]} de ${ano(a)}` : o)
    // 09/2026 (mês/ano)
    .replace(new RegExp(String.raw`${ANTES}(\d{1,2})/(\d{4})${DEPOIS}`, 'gu'), (o, m: string, a: string) =>
      Number(m) >= 1 && Number(m) <= 12 ? `${MESES[Number(m) - 1]} de ${ano(a)}` : o)
    // set/2026, set/26
    .replace(new RegExp(String.raw`${ANTES}(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?/(\d{4}|\d{2})${DEPOIS}`, 'giu'), (_o, m: string, a: string) =>
      `${MESES[(MESES_CURTOS[m.toLowerCase()] ?? 1) - 1]} de ${ano(a)}`)
    // 05/09 — só com dois dígitos dos dois lados ("3/10" é parcela, não data)
    .replace(new RegExp(String.raw`${ANTES}(\d{2})/(\d{2})${DEPOIS}`, 'gu'), (o, d: string, m: string) =>
      dataValida(Number(d), Number(m)) ? `${dia(Number(d))} de ${MESES[Number(m) - 1]}` : o);
}

function parcelas(texto: string): string {
  return texto
    .replace(/\b(parcelas?)\s+(\d{1,3})\s?(?:\/|de)\s?(\d{1,3})\b/giu, (_o, p: string, k: string, n: string) => `${p} ${porExtenso(Number(k), 'f')} de ${porExtenso(Number(n), 'f')}`)
    .replace(new RegExp(String.raw`${ANTES}(\d{1,3})/(\d{1,3})${DEPOIS}`, 'gu'), (o, k: string, n: string) =>
      Number(k) <= Number(n) && !(k.length === 2 && n.length === 2) ? `${porExtenso(Number(k), 'f')} de ${porExtenso(Number(n), 'f')}` : o)
    .replace(new RegExp(String.raw`${ANTES}(\d{1,3})\s?x${DEPOIS}`, 'giu'), (_o, n: string) => `${porExtenso(Number(n), 'f')} ${n === '1' ? 'vez' : 'vezes'}`);
}

function horas(texto: string): string {
  return texto.replace(new RegExp(String.raw`${ANTES}(\d{1,2})h(\d{2})?${DEPOIS}`, 'gu'), (o, h: string, m: string | undefined) => {
    const hora = Number(h);
    if (hora > 23 || (m && Number(m) > 59)) return o;
    const falada = `${porExtenso(hora, 'f')} ${hora === 1 ? 'hora' : 'horas'}`;
    return m && Number(m) ? `${falada} e ${porExtenso(Number(m))}` : falada;
  });
}

function ordinal(n: number, genero: Genero): string {
  const fim = genero === 'f' ? 'a' : 'o';
  const d = Math.floor(n / 10);
  const u = n % 10;
  return [d ? `${ORDINAIS_DEZENA[d]}${fim}` : '', u ? `${ORDINAIS_UNIDADE[u]}${fim}` : ''].filter(Boolean).join(' ');
}

function ordinais(texto: string): string {
  return texto.replace(new RegExp(String.raw`${ANTES}(\d{1,2})\s?([ºª°])`, 'gu'), (_o, n: string, marca: string) => ordinal(Number(n), marca === 'ª' ? 'f' : 'm'));
}

function soltos(texto: string): string {
  // A palavra seguinte só é olhada (lookahead), não consumida: "3 4 5" converte os três.
  const re = new RegExp(String.raw`${ANTES}(${MENOS})?(${NUMERO})${DEPOIS}(?=\s+(\S+)|)`, 'gu');
  return texto.replace(re, (original, menos: string | undefined, valor: string, seguinte: string | undefined) => {
    // Sequência longa (código, telefone, cartão) fica como está.
    if (valor.replace(/\D/g, '').length > 12) return original;
    const genero: Genero = seguinte && FEMININAS.test(seguinte) ? 'f' : 'm';
    const falado = numeroFalado(valor, genero);
    return falado ? `${menos ? 'menos ' : ''}${falado}` : original;
  });
}

/** O texto de uma frase, pronto para a síntese de voz. */
export function normalizarParaFala(texto: string): string {
  let t = texto;
  t = dinheiro(t);
  t = porcentagem(t);
  t = datas(t);
  t = parcelas(t);
  t = horas(t);
  t = ordinais(t);
  t = soltos(t);
  return t.replace(/\s+/g, ' ').trim();
}
