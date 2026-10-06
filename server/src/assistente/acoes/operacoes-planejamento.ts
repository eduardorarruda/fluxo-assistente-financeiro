import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { diferencaEmMeses } from '../../domain/datas';
import type { Meta } from '../../domain/metas';
import { brl, exigirCategoria, mesBr, nomeDaCategoria, operacao, plural, type ContextoOperacoes, type Operacao, type Previa } from './operacoes';
import { ErroDeAcao } from './tipos-acoes';

/** Orçamento e metas: planos da pessoa. Mudam números de várias telas, então são sempre proposta. */

const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Centavos: inteiro, até R$ 100 milhões (o mesmo teto das rotas). */
const centavos = z.number().int().min(0).max(10_000_000_000);

// ---------------------------------------------------------------- orçamento

const orcamento = z.object({ categoriaId: z.string().min(1).max(60), limite: centavos });
type PayloadOrcamento = z.output<typeof orcamento>;

function conferirOrcamento(ctx: ContextoOperacoes, p: PayloadOrcamento): number | null {
  if (exigirCategoria(p.categoriaId) !== 'DESPESA') throw new ErroDeAcao('Orçamento é só para categorias de gasto.');
  const antes = ctx.leitura.limite(p.categoriaId);
  const nome = nomeDaCategoria(p.categoriaId);
  if ((antes ?? 0) === p.limite) throw new ErroDeAcao(p.limite ? `O limite de ${nome} já é ${brl(p.limite)}.` : `${nome} já está sem limite.`);
  return antes;
}

function previaOrcamento(ctx: ContextoOperacoes, p: PayloadOrcamento): Previa {
  const antes = conferirOrcamento(ctx, p);
  const nome = nomeDaCategoria(p.categoriaId);
  const mesAtual = ctx.financas.mesAtual();
  const o = ctx.financas.orcamento(mesAtual);
  const gasto = o.linhas.find((l) => l.categoriaId === p.categoriaId)?.gasto ?? o.semLimite.find((l) => l.categoriaId === p.categoriaId)?.gasto ?? 0;
  const descricao = !p.limite
    ? `Tirar o limite de ${nome} (era ${brl(antes ?? 0)} por mês).`
    : antes
      ? `Limite de ${nome}: ${brl(antes)} → ${brl(p.limite)} por mês.`
      : `Limite de ${brl(p.limite)} por mês para ${nome}.`;
  return {
    titulo: 'Orçamento',
    descricao,
    efeito: `Em ${mesBr(mesAtual)}, ${nome} já tem ${brl(gasto)} de gastos.`,
    exemplos: [],
  };
}

export function definirOrcamento(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'definir_orcamento',
    modo: 'proposta',
    payload: orcamento,
    prever: (p) => previaOrcamento(ctx, p),
    executar: (p) => {
      const antes = conferirOrcamento(ctx, p);
      ctx.repositorio.definirOrcamento(p.categoriaId, p.limite);
      return { inverso: { tipo: 'orcamento', categoriaId: p.categoriaId, antes, depois: ctx.leitura.limite(p.categoriaId) } };
    },
  });
}

// ---------------------------------------------------------------- metas

const novaMeta = z.object({
  nome: z.string().trim().min(1).max(60),
  alvo: centavos.min(1),
  prazo: mes.nullable(),
  caixinhaId: z.string().min(1).max(200).nullable(),
  valorManual: centavos,
});
type PayloadNovaMeta = z.output<typeof novaMeta>;

/** Os campos que a pessoa pode mudar numa meta pelo assistente (ícone e cor ficam com a tela). */
const mudancasMeta = novaMeta.partial();
const edicaoMeta = mudancasMeta.extend({ metaId: z.string().min(1).max(200) });
type PayloadEdicaoMeta = z.output<typeof edicaoMeta>;

const ICONE_PADRAO = 'alvo';
const COR_PADRAO = '#8B5CF6';

/** Nome para mostrar; caixinha que sumiu (o banco deixou de mandar) aparece como "uma caixinha que não existe mais". */
function nomeDaCaixinha(ctx: ContextoOperacoes, id: string | null): string | null {
  if (!id) return null;
  return ctx.financas.caixinhas().caixinhas.find((x) => x.id === id)?.nome ?? 'uma caixinha que não existe mais';
}

function exigirCaixinha(ctx: ContextoOperacoes, id: string | null): void {
  if (id && !ctx.financas.caixinhas().caixinhas.some((x) => x.id === id)) {
    throw new ErroDeAcao('Caixinha não encontrada. Use o nome que caixinhas_e_investimentos devolve.');
  }
}

function conferirMeta(ctx: ContextoOperacoes, m: Pick<Meta, 'prazo' | 'caixinhaId'>): void {
  if (m.prazo && m.prazo < ctx.financas.mesAtual()) throw new ErroDeAcao(`O prazo ${mesBr(m.prazo)} já passou.`);
  exigirCaixinha(ctx, m.caixinhaId);
}

function resumoMeta(ctx: ContextoOperacoes, m: Omit<Meta, 'id' | 'icone' | 'cor'>): string {
  const caixinha = nomeDaCaixinha(ctx, m.caixinhaId);
  const partes = [`juntar ${brl(m.alvo)}`, m.prazo ? `até ${mesBr(m.prazo)}` : 'sem prazo'];
  if (caixinha) partes.push(`contando o saldo da caixinha “${caixinha}”`);
  else if (m.valorManual) partes.push(`começando com ${brl(m.valorManual)}`);
  return partes.join(', ');
}

function porMes(ctx: ContextoOperacoes, m: Omit<Meta, 'id' | 'icone' | 'cor'>): string | null {
  if (!m.prazo) return null;
  const caixinha = m.caixinhaId ? ctx.financas.caixinhas().caixinhas.find((x) => x.id === m.caixinhaId)?.valor ?? 0 : m.valorManual;
  const falta = Math.max(0, m.alvo - caixinha);
  if (!falta) return 'A meta já está cumprida com o que tem hoje.';
  const meses = Math.max(1, diferencaEmMeses(ctx.financas.mesAtual(), m.prazo));
  return `Faltam ${brl(falta)}: dá ${brl(Math.ceil(falta / meses))} por mês em ${plural(meses, 'mês', 'meses')}.`;
}

export function criarMeta(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'criar_meta',
    modo: 'proposta',
    payload: novaMeta,
    prever: (p: PayloadNovaMeta) => {
      conferirMeta(ctx, p);
      return { titulo: 'Nova meta', descricao: `Meta “${p.nome}”: ${resumoMeta(ctx, p)}.`, efeito: porMes(ctx, p), exemplos: [] };
    },
    executar: (p) => {
      conferirMeta(ctx, p);
      const meta: Meta = { id: randomUUID(), ...p, icone: ICONE_PADRAO, cor: COR_PADRAO };
      ctx.repositorio.salvarMeta(meta);
      return { inverso: { tipo: 'meta', antes: null, depois: meta } };
    },
  });
}

function exigirMeta(ctx: ContextoOperacoes, id: string): Meta {
  const meta = ctx.leitura.meta(id);
  if (!meta) throw new ErroDeAcao('Meta não encontrada. Use o `id` que a ferramenta metas devolve.');
  return meta;
}

function diferencas(antes: Meta, depois: Meta, ctx: ContextoOperacoes): string[] {
  const d: string[] = [];
  if (antes.nome !== depois.nome) d.push(`nome “${antes.nome}” → “${depois.nome}”`);
  if (antes.alvo !== depois.alvo) d.push(`alvo ${brl(antes.alvo)} → ${brl(depois.alvo)}`);
  if (antes.prazo !== depois.prazo) d.push(`prazo ${antes.prazo ? mesBr(antes.prazo) : 'nenhum'} → ${depois.prazo ? mesBr(depois.prazo) : 'nenhum'}`);
  if (antes.caixinhaId !== depois.caixinhaId) d.push(`caixinha ${nomeDaCaixinha(ctx, antes.caixinhaId) ?? 'nenhuma'} → ${nomeDaCaixinha(ctx, depois.caixinhaId) ?? 'nenhuma'}`);
  if (antes.valorManual !== depois.valorManual) d.push(`valor guardado ${brl(antes.valorManual)} → ${brl(depois.valorManual)}`);
  return d;
}

function editada(ctx: ContextoOperacoes, p: PayloadEdicaoMeta): { antes: Meta; depois: Meta; mudou: string[] } {
  const antes = exigirMeta(ctx, p.metaId);
  const { metaId: _id, ...mudancas } = p;
  const depois: Meta = { ...antes, ...Object.fromEntries(Object.entries(mudancas).filter(([, v]) => v !== undefined)) };
  // Só confere o que mudou: renomear uma meta cujo prazo já passou continua valendo.
  conferirMeta(ctx, { prazo: mudancas.prazo !== undefined ? depois.prazo : null, caixinhaId: mudancas.caixinhaId !== undefined ? depois.caixinhaId : null });
  const mudou = diferencas(antes, depois, ctx);
  if (!mudou.length) throw new ErroDeAcao('A meta já está assim: nada a mudar.');
  return { antes, depois, mudou };
}

export function editarMeta(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'editar_meta',
    modo: 'proposta',
    payload: edicaoMeta,
    prever: (p) => {
      const { antes, depois, mudou } = editada(ctx, p);
      return { titulo: 'Editar meta', descricao: `Meta “${antes.nome}”: ${mudou.join('; ')}.`, efeito: porMes(ctx, depois), exemplos: [] };
    },
    executar: (p) => {
      const { antes, depois } = editada(ctx, p);
      ctx.repositorio.salvarMeta(depois);
      return { inverso: { tipo: 'meta', antes, depois } };
    },
  });
}

export function removerMeta(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'remover_meta',
    modo: 'proposta',
    payload: z.object({ metaId: z.string().min(1).max(200) }),
    prever: (p) => {
      const meta = exigirMeta(ctx, p.metaId);
      return {
        titulo: 'Apagar meta',
        descricao: `Apagar a meta “${meta.nome}” (${resumoMeta(ctx, meta)}).`,
        efeito: meta.caixinhaId ? 'A caixinha não é mexida: só a meta some.' : null,
        exemplos: [],
      };
    },
    executar: (p) => {
      const meta = exigirMeta(ctx, p.metaId);
      ctx.repositorio.removerMeta(meta.id);
      return { inverso: { tipo: 'meta', antes: meta, depois: null } };
    },
  });
}
