import { NaoEncontrado } from '../../dados/repositorio';
import type { Meta } from '../../domain/metas';
import { brl, nomeDaCategoria, plural, type ContextoOperacoes } from './operacoes';
import { desfazerConta } from './operacoes-contas';
import { mesmoAjuste } from './operacoes-movimentos';
import { ErroDeAcao, type Inverso } from './tipos-acoes';

/**
 * Desfaz uma ação a partir do que ela guardou (`Inverso`). Nunca desfaz por
 * cima de uma mudança feita depois: se o estado não é mais o que a ação
 * deixou (`depois`), recusa — ou, nos movimentos, desfaz só os que não
 * mudaram e avisa quais ficaram.
 *
 * Devolve um aviso para a pessoa (ou null quando voltou tudo).
 */
export function desfazer(ctx: ContextoOperacoes, inverso: Inverso): string | null {
  switch (inverso.tipo) {
    case 'ajustes':
      return desfazerAjustes(ctx, inverso.itens);
    case 'regra_criada':
      if (!ctx.leitura.regra(inverso.regra.id)) throw new ErroDeAcao('Essa regra já foi removida.');
      ctx.repositorio.removerRegra(inverso.regra.id);
      return null;
    case 'regra_removida':
      if (ctx.leitura.regra(inverso.regra.id)) throw new ErroDeAcao('Essa regra já existe de novo.');
      ctx.repositorio.restaurarRegra(inverso.regra);
      return null;
    case 'orcamento': {
      const atual = ctx.leitura.limite(inverso.categoriaId);
      if (atual !== inverso.depois) {
        throw new ErroDeAcao(`O limite de ${nomeDaCategoria(inverso.categoriaId)} foi mudado depois (agora ${atual ? brl(atual) : 'sem limite'}); ajuste pela tela de Orçamento.`);
      }
      ctx.repositorio.definirOrcamento(inverso.categoriaId, inverso.antes ?? 0);
      return null;
    }
    case 'meta':
      return desfazerMeta(ctx, inverso.antes, inverso.depois);
    case 'conta_a_pagar':
      desfazerConta(ctx, inverso.antes, inverso.depois);
      return null;
  }
}

const VAZIO = { natureza: null, categoriaId: null, nota: null, ignorar: false };

function desfazerAjustes(ctx: ContextoOperacoes, itens: Extract<Inverso, { tipo: 'ajustes' }>['itens']): string | null {
  let desfeitos = 0;
  let mudados = 0;
  for (const item of itens) {
    if (!mesmoAjuste(ctx.leitura.ajuste(item.transacaoId), item.depois)) {
      mudados++;
      continue;
    }
    try {
      ctx.repositorio.salvarAjuste(item.transacaoId, item.antes ?? VAZIO);
      desfeitos++;
    } catch (e) {
      if (!(e instanceof NaoEncontrado)) throw e;
      mudados++;
    }
  }
  if (!desfeitos && mudados) {
    throw new ErroDeAcao(itens.length === 1
      ? 'Esse movimento foi mudado depois (ou não existe mais); ajuste pelo Extrato.'
      : 'Esses movimentos foram mudados depois (ou não existem mais); nada foi desfeito.');
  }
  return mudados ? `${plural(mudados, 'movimento foi mudado', 'movimentos foram mudados')} depois e ${mudados === 1 ? 'ficou' : 'ficaram'} como ${mudados === 1 ? 'está' : 'estão'}.` : null;
}

function mesmaMeta(a: Meta | undefined, b: Meta): boolean {
  if (!a) return false;
  return (['nome', 'alvo', 'prazo', 'caixinhaId', 'valorManual', 'icone', 'cor'] as const).every((k) => (a[k] ?? null) === (b[k] ?? null));
}

function desfazerMeta(ctx: ContextoOperacoes, antes: Meta | null, depois: Meta | null): null {
  const id = (depois ?? antes)!.id;
  const atual = ctx.leitura.meta(id);
  if (depois && !mesmaMeta(atual, depois)) {
    throw new ErroDeAcao(atual ? 'A meta foi mudada depois; ajuste pela tela de Metas.' : 'Essa meta já foi apagada.');
  }
  if (!depois && atual) throw new ErroDeAcao('Essa meta já existe de novo.');
  if (antes) ctx.repositorio.salvarMeta(antes);
  else ctx.repositorio.removerMeta(id);
  return null;
}
