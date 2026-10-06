import { z } from 'zod';
import { reais, reaisCompacto } from '../../../util/formato';

/**
 * O gráfico que o assistente escreve na resposta: um bloco ```grafico com
 * JSON. O texto vem de um modelo (e, por tabela, de descrições de terceiros),
 * então tudo é validado e limitado antes de desenhar.
 */

export const MAXIMO_ROTULOS = 60;
export const MAXIMO_SERIES = 8;
const MAXIMO_CARACTERES = 50_000;

export const TIPOS_GRAFICO = ['barras', 'barras_empilhadas', 'linhas', 'area', 'pizza'] as const;
export const CORES_GRAFICO = ['entrada', 'saida', 'guardado', 'marca', 'info', 'atencao'] as const;
export type CorGrafico = (typeof CORES_GRAFICO)[number];
export type UnidadeGrafico = 'reais' | 'numero' | 'percentual';

const serie = z.object({
  nome: z.string().trim().min(1).max(60),
  valores: z.array(z.number()).max(MAXIMO_ROTULOS),
  cor: z.enum(CORES_GRAFICO).optional(),
});

export const esquemaGrafico = z
  .object({
    tipo: z.enum(TIPOS_GRAFICO),
    titulo: z.string().trim().min(1).max(120),
    subtitulo: z.string().trim().max(200).optional(),
    unidade: z.enum(['reais', 'numero', 'percentual']).default('reais'),
    rotulos: z.array(z.string().trim().max(40)).min(1).max(MAXIMO_ROTULOS),
    series: z.array(serie).min(1).max(MAXIMO_SERIES),
  })
  .superRefine((g, ctx) => {
    g.series.forEach((s, i) => {
      if (s.valores.length !== g.rotulos.length) {
        ctx.addIssue({ code: 'custom', path: ['series', i, 'valores'], message: `“${s.nome}” tem ${s.valores.length} valores para ${g.rotulos.length} rótulos` });
      }
    });
    if (g.tipo !== 'pizza') return;
    if (g.series.length !== 1) ctx.addIssue({ code: 'custom', path: ['series'], message: 'pizza tem uma série só' });
    const valores = g.series[0]?.valores ?? [];
    if (valores.some((v) => v < 0)) ctx.addIssue({ code: 'custom', path: ['series', 0, 'valores'], message: 'pizza não aceita valores negativos' });
    else if (!valores.some((v) => v > 0)) ctx.addIssue({ code: 'custom', path: ['series', 0, 'valores'], message: 'pizza sem nenhum valor positivo' });
  });

export type EspecGrafico = z.infer<typeof esquemaGrafico>;

export type LeituraGrafico =
  | { tipo: 'ok'; espec: EspecGrafico }
  /** JSON que ainda não fechou (normal enquanto a resposta chega) ou quebrado. */
  | { tipo: 'json'; motivo: string }
  | { tipo: 'invalido'; motivo: string };

export function lerGrafico(texto: string): LeituraGrafico {
  if (texto.length > MAXIMO_CARACTERES) return { tipo: 'invalido', motivo: 'o bloco é grande demais' };
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { tipo: 'json', motivo: 'o JSON está incompleto ou quebrado' };
  }
  const r = esquemaGrafico.safeParse(bruto);
  if (r.success) return { tipo: 'ok', espec: r.data };
  const motivo = r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'gráfico'}: ${i.message}`).join('; ');
  return { tipo: 'invalido', motivo };
}

// ---------- cores (só tokens: os dois temas já resolvem)

const COR_DO_TOKEN: Record<CorGrafico, string> = {
  entrada: 'var(--entrada)',
  saida: 'var(--saida)',
  guardado: 'var(--guardado)',
  marca: 'var(--marca)',
  info: 'var(--info)',
  atencao: 'var(--atencao)',
};

export const PALETA = ['var(--marca)', 'var(--info)', 'var(--entrada)', 'var(--saida)', 'var(--guardado)', 'var(--atencao)', 'var(--cartao)', 'var(--critico)'];

export function corDaSerie(s: { cor?: CorGrafico }, indice: number): string {
  return s.cor ? COR_DO_TOKEN[s.cor] : PALETA[indice % PALETA.length]!;
}

// ---------- números

const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const numeroCompacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const paraCentavos = (v: number) => Math.round(v * 100);

export function formatarValor(v: number, unidade: UnidadeGrafico): string {
  if (unidade === 'reais') return reais(paraCentavos(v));
  if (unidade === 'percentual') return `${numero.format(v)}%`;
  return numero.format(v);
}

export function formatarEixo(v: number, unidade: UnidadeGrafico): string {
  // Eixo uniforme: "R$ 500", "R$ 1 mil", "R$ 1,5 mil" (sem centavos abaixo de mil, como os milhares).
  if (unidade === 'reais') return Math.abs(v) < 1000 ? `${v < 0 ? '-' : ''}R$ ${Math.round(Math.abs(v))}` : reaisCompacto(paraCentavos(v));
  if (unidade === 'percentual') return `${numeroCompacto.format(v)}%`;
  return numeroCompacto.format(v);
}

// ---------- texto para leitor de tela e CSV

const NOME_DO_TIPO: Record<EspecGrafico['tipo'], string> = {
  barras: 'barras',
  barras_empilhadas: 'barras empilhadas',
  linhas: 'linhas',
  area: 'área',
  pizza: 'pizza',
};

export function resumoAcessivel(g: EspecGrafico): string {
  const series = g.series.map((s) => s.nome).join(', ');
  return `${g.titulo}. Gráfico de ${NOME_DO_TIPO[g.tipo]} com ${g.rotulos.length} ${g.rotulos.length === 1 ? 'item' : 'itens'} (${g.rotulos[0]} a ${g.rotulos.at(-1)}) e ${g.series.length === 1 ? 'a série' : 'as séries'} ${series}. A tabela com os dados está logo abaixo.`;
}

/** Célula de texto no CSV: aspas quando precisa, e nada que uma planilha execute como fórmula. */
function celula(texto: string): string {
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Número no CSV do jeito da planilha em português: vírgula decimal, sem separador de milhar. */
const numeroCsv = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

export function paraCsv(g: EspecGrafico): string {
  const cabecalho = ['Rótulo', ...g.series.map((s) => s.nome)].map(celula).join(';');
  const linhas = g.rotulos.map((r, i) => [celula(r), ...g.series.map((s) => numeroCsv(s.valores[i] ?? 0))].join(';'));
  return [cabecalho, ...linhas].join('\n');
}
