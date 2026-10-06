import type { Dia, Mes } from './types';

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MES = /^(\d{4})-(\d{2})$/;

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Data de calendário local. `toISOString()` converteria para UTC e, no Brasil,
 * uma compra às 22h viraria o dia seguinte.
 */
export function paraDia(data: Date | string): Dia {
  if (typeof data === 'string') {
    if (DIA.test(data)) return data;
    const prefixo = data.slice(0, 10);
    if (DIA.test(prefixo) && data.length > 10 && /T00:00:00(\.000)?Z$/.test(data)) {
      // Datas "puras" que o provedor serializa como meia-noite UTC.
      return prefixo;
    }
    data = new Date(data);
  }
  if (Number.isNaN(data.getTime())) throw new Error('Data inválida');
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

export function mesDe(dia: Dia): Mes {
  return dia.slice(0, 7);
}

export function hoje(agora: Date = new Date()): Dia {
  return paraDia(agora);
}

export function partesDoMes(mes: Mes): { ano: number; mes: number } {
  const m = MES.exec(mes);
  if (!m) throw new Error(`Mês inválido: ${mes}`);
  return { ano: Number(m[1]), mes: Number(m[2]) };
}

export function somarMeses(mes: Mes, n: number): Mes {
  const { ano, mes: m } = partesDoMes(mes);
  const indice = ano * 12 + (m - 1) + n;
  return `${Math.floor(indice / 12)}-${doisDigitos((indice % 12) + 1)}`;
}

export function diferencaEmMeses(de: Mes, ate: Mes): number {
  const a = partesDoMes(de);
  const b = partesDoMes(ate);
  return (b.ano - a.ano) * 12 + (b.mes - a.mes);
}

export function diasNoMes(mes: Mes): number {
  const { ano, mes: m } = partesDoMes(mes);
  return new Date(ano, m, 0).getDate();
}

/** Dia do mês com o dia limitado ao último dia daquele mês (31 → 28/29/30). */
export function diaNoMes(mes: Mes, dia: number): Dia {
  return `${mes}-${doisDigitos(Math.min(dia, diasNoMes(mes)))}`;
}

export function diaDoMes(dia: Dia): number {
  return Number(dia.slice(8, 10));
}

export function somarDias(dia: Dia, n: number): Dia {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return paraDia(new Date(a, m - 1, d + n));
}

export function diasEntre(de: Dia, ate: Dia): number {
  const [a1, m1, d1] = de.split('-').map(Number) as [number, number, number];
  const [a2, m2, d2] = ate.split('-').map(Number) as [number, number, number];
  // Date.UTC evita a hora a mais/a menos de horário de verão.
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

export function intervaloDeMeses(de: Mes, ate: Mes): Mes[] {
  const meses: Mes[] = [];
  for (let m = de; m <= ate; m = somarMeses(m, 1)) meses.push(m);
  return meses;
}
