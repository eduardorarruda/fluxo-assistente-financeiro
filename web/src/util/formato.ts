import type { Centavos, Dia, Mes } from '../api/tipos';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompacto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const numero = new Intl.NumberFormat('pt-BR');
const porcento = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const porcento1 = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** Com o sinal de menos tipográfico (−) em vez do hífen, que some ao lado do R$. */
export const reais = (c: Centavos) => (c < 0 ? `− ${brl.format(-c / 100)}` : brl.format(c / 100));
export const reaisCompacto = (c: Centavos) => (Math.abs(c) < 100_000 ? brl.format(Math.round(c / 100)) : brlCompacto.format(c / 100));
export const reaisSemCentavos = (c: Centavos) => brl.format(Math.round(c / 100)).replace(/,00$/, '');
export const inteiro = (n: number) => numero.format(n);
export const pct = (x: number) => porcento.format(x);
export const pct1 = (x: number) => porcento1.format(x);

export function comSinal(c: Centavos): string {
  if (c === 0) return reais(0);
  return `${c > 0 ? '+' : '−'} ${reais(Math.abs(c))}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function partes(mes: Mes) {
  return { ano: Number(mes.slice(0, 4)), m: Number(mes.slice(5, 7)) - 1 };
}

export const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const nomeDoMes = (mes: Mes) => `${MESES[partes(mes).m]} de ${partes(mes).ano}`;
export const mesCurto = (mes: Mes) => `${MESES_CURTOS[partes(mes).m]}/${String(partes(mes).ano).slice(2)}`;
export const mesSemAno = (mes: Mes) => MESES[partes(mes).m]!;
export const mesCurtoSemAno = (mes: Mes) => MESES_CURTOS[partes(mes).m]!;

export function somarMeses(mes: Mes, n: number): Mes {
  const { ano, m } = partes(mes);
  const i = ano * 12 + m + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

function dataLocal(dia: Dia) {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(a, m - 1, d);
}

export const diaEMes = (dia: Dia) => `${Number(dia.slice(8, 10))} ${MESES_CURTOS[Number(dia.slice(5, 7)) - 1]}`;
export const dataCurta = (dia: Dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(2, 4)}`;
export const diaDaSemana = (dia: Dia) => SEMANA[dataLocal(dia).getDay()]!;

export function diasAte(de: Dia, ate: Dia): number {
  return Math.round((dataLocal(ate).getTime() - dataLocal(de).getTime()) / 86_400_000);
}

/** "hoje", "ontem", "quinta, 12 set" */
export function diaAmigavel(dia: Dia, hoje: Dia): string {
  const d = diasAte(dia, hoje);
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Ontem';
  const semana = diaDaSemana(dia);
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)}, ${diaEMes(dia)}`;
}

export function haQuantoTempo(iso: string | null, agora = new Date()): string {
  if (!iso) return 'nunca';
  const s = Math.round((agora.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export function emQuantosDias(de: Dia, ate: Dia): string {
  const d = diasAte(de, ate);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d < 0) return `há ${-d} dia${d === -1 ? '' : 's'}`;
  return `em ${d} dias`;
}

/** Entrada de dinheiro digitada ("1.234,56", "1234.5", "R$ 12") → centavos. */
export function lerReais(texto: string): Centavos | null {
  const limpo = texto.replace(/[R$\s]/g, '');
  if (!limpo) return null;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
