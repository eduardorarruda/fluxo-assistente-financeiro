import { z } from 'zod';
import { NaoEncontrado } from '../../dados/repositorio';
import type { Ajuste } from '../../domain/movimentos';
import type { Movimento, Natureza } from '../../domain/types';
import {
  brl, curto, dataBr, exigirCategoria, grupoDaNatureza, nomeDaCategoria, operacao, plural, type ContextoOperacoes, type Operacao, type Previa,
} from './operacoes';
import { ErroDeAcao, type ExemploAcao } from './tipos-acoes';

/** Ações sobre movimentos: um só (direta) ou vários de uma vez (proposta). */

export const NATUREZAS = ['DESPESA', 'RECEITA', 'ESTORNO', 'PAGAMENTO_FATURA', 'TRANSFERENCIA', 'INVESTIMENTO'] as const;

const ROTULO_NATUREZA: Record<Natureza, string> = {
  DESPESA: 'gasto', RECEITA: 'receita', ESTORNO: 'estorno', PAGAMENTO_FATURA: 'pagamento de fatura',
  TRANSFERENCIA: 'transferência entre contas suas', INVESTIMENTO: 'caixinha/investimento',
};

/** Quantos movimentos mudam de uma vez numa proposta de recategorização. */
export const MAXIMO_RECATEGORIZAR = 500;
const EXEMPLOS = 5;

export function exemplo(m: Movimento, para: string | null): ExemploAcao {
  return { data: m.data, descricao: curto(m.descricao, 60), valor: m.valor, de: nomeDaCategoria(m.categoriaId), para };
}

/** Os mais recentes primeiro: é o que a pessoa reconhece. */
export function exemplos(lista: readonly Movimento[], para: (m: Movimento) => string | null): ExemploAcao[] {
  return [...lista].sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id)).slice(0, EXEMPLOS).map((m) => exemplo(m, para(m)));
}

export function periodo(lista: readonly Movimento[]): string {
  if (!lista.length) return '';
  const datas = lista.map((m) => m.data).sort();
  const [de, ate] = [datas[0]!, datas.at(-1)!];
  return de === ate ? `em ${dataBr(de)}` : `de ${dataBr(de)} a ${dataBr(ate)}`;
}

export const somaDe = (lista: readonly Movimento[]) => lista.reduce((s, m) => s + m.valor, 0);

/** Um ajuste vazio e a falta de ajuste são a mesma coisa (o `Repositorio` apaga a linha vazia). */
export function mesmoAjuste(a: Ajuste | null, b: Ajuste | null): boolean {
  const x = a ?? { natureza: null, categoriaId: null, nota: null, ignorar: false };
  const y = b ?? { natureza: null, categoriaId: null, nota: null, ignorar: false };
  return (x.natureza ?? null) === (y.natureza ?? null) && (x.categoriaId ?? null) === (y.categoriaId ?? null)
    && (x.nota ?? null) === (y.nota ?? null) && Boolean(x.ignorar) === Boolean(y.ignorar);
}

// ------------------------------------------------------------ um movimento

const ajuste = z.object({
  movimentoId: z.string().min(1).max(200),
  /** null = volta para a categoria automática. */
  categoriaId: z.string().min(1).max(60).nullable().optional(),
  /** null = volta para a natureza automática. */
  natureza: z.enum(NATUREZAS).nullable().optional(),
  nota: z.string().max(500).nullable().optional(),
  ignorar: z.boolean().optional(),
});
type PayloadAjuste = z.output<typeof ajuste>;

function previaDoAjuste(ctx: ContextoOperacoes, p: PayloadAjuste): Previa {
  const m = ctx.financas.movimento(p.movimentoId);
  if (!m) throw new ErroDeAcao('Movimento não encontrado. Use o `id` que buscar_movimentos devolve.');
  const mudancas = [p.categoriaId, p.natureza, p.nota, p.ignorar].filter((v) => v !== undefined);
  if (!mudancas.length) throw new ErroDeAcao('Diga o que mudar: categoria, natureza, nota ou ignorar.');
  const natureza = p.natureza ?? m.natureza;
  if (p.categoriaId) {
    const grupo = exigirCategoria(p.categoriaId);
    const doMovimento = grupoDaNatureza(natureza);
    if (!doMovimento) {
      throw new ErroDeAcao(`Movimento de ${ROTULO_NATUREZA[natureza]} não tem categoria (não conta como gasto nem receita). Se ele for um gasto, mude a natureza junto (natureza: DESPESA).`);
    }
    if (doMovimento !== grupo) {
      const tipo = grupo === 'DESPESA' ? 'gasto' : 'receita';
      throw new ErroDeAcao(`“${nomeDaCategoria(p.categoriaId)}” é categoria de ${tipo}, mas este movimento é ${ROTULO_NATUREZA[natureza]}. Se ele for mesmo ${tipo}, mude a natureza junto.`);
    }
  }
  const partes: string[] = [];
  if (p.natureza !== undefined && p.natureza !== m.natureza) {
    partes.push(`natureza ${ROTULO_NATUREZA[m.natureza]} → ${p.natureza ? ROTULO_NATUREZA[p.natureza] : 'automática'}`);
  }
  if (p.categoriaId !== undefined && p.categoriaId !== m.categoriaId) {
    partes.push(`${nomeDaCategoria(m.categoriaId)} → ${p.categoriaId ? nomeDaCategoria(p.categoriaId) : 'categoria automática'}`);
  }
  if (p.nota !== undefined && (p.nota?.trim() || null) !== m.nota) partes.push(p.nota?.trim() ? `nota “${curto(p.nota, 60)}”` : 'sem nota');
  if (p.ignorar !== undefined && p.ignorar !== m.ignorado) partes.push(p.ignorar ? 'fora das contas' : 'de volta às contas');
  if (!partes.length) throw new ErroDeAcao('Esse movimento já está assim: nada a mudar.');
  return {
    titulo: 'Movimento ajustado',
    descricao: `“${curto(m.descricao)}” (${dataBr(m.data)}, ${brl(m.valor)}): ${partes.join('; ')}.`,
    efeito: null,
    exemplos: [],
  };
}

export function ajustarMovimento(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'ajustar_movimento',
    modo: 'direta',
    payload: ajuste,
    prever: (p) => previaDoAjuste(ctx, p),
    executar: (p) => {
      previaDoAjuste(ctx, p);
      const antes = ctx.leitura.ajuste(p.movimentoId);
      const parcial: Partial<Ajuste> = {
        ...(p.categoriaId !== undefined ? { categoriaId: p.categoriaId } : {}),
        ...(p.natureza !== undefined ? { natureza: p.natureza } : {}),
        ...(p.nota !== undefined ? { nota: p.nota?.trim() || null } : {}),
        ...(p.ignorar !== undefined ? { ignorar: p.ignorar } : {}),
      };
      try {
        ctx.repositorio.salvarAjuste(p.movimentoId, parcial);
      } catch (e) {
        if (e instanceof NaoEncontrado) throw new ErroDeAcao('Esse movimento não existe mais (o banco pode ter trocado o registro).');
        throw e;
      }
      return { inverso: { tipo: 'ajustes', itens: [{ transacaoId: p.movimentoId, antes, depois: ctx.leitura.ajuste(p.movimentoId) }] } };
    },
  });
}

// ------------------------------------------------------- vários movimentos

const recategorizar = z.object({
  movimentoIds: z.array(z.string().min(1).max(200)).min(1).max(MAXIMO_RECATEGORIZAR),
  categoriaId: z.string().min(1).max(60),
});
type PayloadRecategorizar = z.output<typeof recategorizar>;

interface Separacao {
  mudam: Movimento[];
  jaEstao: number;
  outroTipo: number;
  sumiram: number;
}

function separar(ctx: ContextoOperacoes, p: PayloadRecategorizar): Separacao {
  const grupo = exigirCategoria(p.categoriaId);
  const porId = new Map(ctx.financas.todosOsMovimentos().map((m) => [m.id, m]));
  const s: Separacao = { mudam: [], jaEstao: 0, outroTipo: 0, sumiram: 0 };
  for (const id of new Set(p.movimentoIds)) {
    const m = porId.get(id);
    if (!m) s.sumiram++;
    else if (m.categoriaId === p.categoriaId) s.jaEstao++;
    else if (grupoDaNatureza(m.natureza) !== grupo) s.outroTipo++;
    else s.mudam.push(m);
  }
  return s;
}

function avisos(s: Separacao, categoria: string): string[] {
  return [
    s.jaEstao ? `${plural(s.jaEstao, 'já estava', 'já estavam')} em ${categoria}` : '',
    s.outroTipo ? `${plural(s.outroTipo, 'é', 'são')} de outro tipo (receita, transferência…) e ${s.outroTipo === 1 ? 'fica como está' : 'ficam como estão'}` : '',
    s.sumiram ? `${plural(s.sumiram, 'não existe', 'não existem')} mais` : '',
  ].filter(Boolean);
}

function previaRecategorizar(ctx: ContextoOperacoes, p: PayloadRecategorizar): Previa {
  const s = separar(ctx, p);
  const categoria = nomeDaCategoria(p.categoriaId);
  const outros = avisos(s, categoria);
  if (!s.mudam.length) throw new ErroDeAcao(`Nenhum desses movimentos mudaria: ${outros.join('; ') || 'lista vazia'}.`);
  const n = s.mudam.length;
  return {
    titulo: 'Recategorizar movimentos',
    descricao: `${plural(n, 'movimento passa', 'movimentos passam')} para ${categoria}.`,
    efeito: `Muda ${plural(n, 'movimento', 'movimentos')} (${brl(somaDe(s.mudam))}), ${periodo(s.mudam)}.${outros.length ? ` Fora disso: ${outros.join('; ')}.` : ''}`,
    exemplos: exemplos(s.mudam, () => categoria),
  };
}

export function recategorizarMovimentos(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'recategorizar_movimentos',
    modo: 'proposta',
    payload: recategorizar,
    prever: (p) => previaRecategorizar(ctx, p),
    // Só os que vão mudar: o que já estava na categoria ou é de outro tipo não entra na proposta.
    refinar: (p) => ({ ...p, movimentoIds: separar(ctx, p).mudam.map((m) => m.id) }),
    executar: (p) => {
      const s = separar(ctx, p);
      if (!s.mudam.length) throw new ErroDeAcao('Nenhum desses movimentos precisa mudar mais (já mudaram ou sumiram).');
      const itens = s.mudam.map((m) => {
        const antes = ctx.leitura.ajuste(m.id);
        ctx.repositorio.salvarAjuste(m.id, { categoriaId: p.categoriaId });
        return { transacaoId: m.id, antes, depois: ctx.leitura.ajuste(m.id) };
      });
      const pulados = s.jaEstao + s.outroTipo + s.sumiram;
      return { inverso: { tipo: 'ajustes', itens }, aviso: pulados ? `${plural(pulados, 'movimento ficou como estava', 'movimentos ficaram como estavam')}.` : null };
    },
  });
}
