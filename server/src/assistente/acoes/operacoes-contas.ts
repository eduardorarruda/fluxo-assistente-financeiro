import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { NaoEncontrado, type LinhaContaAPagar } from '../../dados/repositorio';
import { normalizar } from '../../domain/texto';
import type { ContasAPagar, DadosContaAPagar } from '../../servicos/contas-a-pagar';
import { brl, curto, dataBr, exigirCategoria, nomeDaCategoria, operacao, type ContextoOperacoes, type Operacao, type Previa } from './operacoes';
import { ErroDeAcao } from './tipos-acoes';

/**
 * Contas a pagar ("a luz de R$ 150 vence dia 15"). Criar, editar e marcar
 * como paga são diretas (pontuais e fáceis de desfazer); apagar é proposta.
 * Tudo passa pelo serviço `ContasAPagar` (que valida, concilia com o extrato e
 * avisa a Agenda); o "antes" para desfazer é a linha crua do banco.
 */

const dia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const REPETE = { nao: '', mensal: ', todo mês', anual: ', todo ano' } as const;

/** Os campos que a pessoa edita (o resto — pagamento, conciliação — é do sistema). */
const EDITAVEIS = ['descricao', 'valor', 'vencimento', 'repete', 'categoriaId', 'textoNoExtrato', 'nota'] as const;

const campos = {
  descricao: z.string().trim().min(1).max(80),
  valor: z.number().int().min(1).max(10_000_000_000),
  vencimento: dia,
  repete: z.enum(['nao', 'mensal', 'anual']),
  categoriaId: z.string().min(1).max(60).nullable(),
  textoNoExtrato: z.string().trim().max(60).nullable(),
  nota: z.string().trim().max(500).nullable(),
};

function servico(ctx: ContextoOperacoes): ContasAPagar {
  if (!ctx.contas) throw new ErroDeAcao('As contas a pagar não estão disponíveis neste Fluxo.');
  return ctx.contas;
}

/** O serviço fala HTTP (400/404); aqui vira mensagem para o modelo ou a tela. */
function comServico<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof NaoEncontrado) throw new ErroDeAcao('Conta a pagar não encontrada. Use o `id` que a ferramenta contas_a_pagar devolve.');
    if (e instanceof HttpException) throw new ErroDeAcao(e.message);
    throw e;
  }
}

function linha(ctx: ContextoOperacoes, id: string): LinhaContaAPagar {
  const l = ctx.repositorio.contaAPagar(id);
  if (!l) throw new ErroDeAcao('Conta a pagar não encontrada. Use o `id` que a ferramenta contas_a_pagar devolve.');
  return l;
}

function resumo(l: Pick<LinhaContaAPagar, 'descricao' | 'valor' | 'vencimento' | 'repete'>): string {
  return `“${curto(l.descricao)}” (${brl(l.valor)}, vence em ${dataBr(l.vencimento)}${REPETE[l.repete]})`;
}

export function mesmosCampos(a: Partial<LinhaContaAPagar> | null, b: Partial<LinhaContaAPagar> | null): boolean {
  return Boolean(a && b) && EDITAVEIS.every((k) => (a![k] ?? null) === (b![k] ?? null));
}

// ---------------------------------------------------------------- criar

const nova = z.object({
  ...campos,
  repete: campos.repete.default('nao'),
  categoriaId: campos.categoriaId.default(null),
  textoNoExtrato: campos.textoNoExtrato.default(null),
  nota: campos.nota.default(null),
});
type PayloadNova = z.output<typeof nova>;

function previaNova(ctx: ContextoOperacoes, p: PayloadNova): Previa {
  if (p.categoriaId && exigirCategoria(p.categoriaId) !== 'DESPESA') throw new ErroDeAcao('Conta a pagar usa uma categoria de gasto.');
  const repetida = servico(ctx).listar().find((c) =>
    c.situacao !== 'paga' && c.vencimento === p.vencimento && normalizar(c.descricao) === normalizar(p.descricao));
  if (repetida) throw new ErroDeAcao(`Já existe essa conta: ${resumo(repetida)}. Para mudar algo nela, use editar_conta_a_pagar.`);
  const categoria = p.categoriaId ? ` · ${nomeDaCategoria(p.categoriaId)}` : '';
  return { titulo: 'Conta a pagar criada', descricao: `${resumo(p)}${categoria}.`, efeito: null, exemplos: [] };
}

export function criarContaAPagar(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'criar_conta_a_pagar',
    modo: 'direta',
    payload: nova,
    prever: (p) => previaNova(ctx, p),
    executar: (p) => {
      previaNova(ctx, p);
      const dados: DadosContaAPagar = { ...p, origem: 'assistente' };
      const conta = comServico(() => servico(ctx).criar(dados));
      const depois = linha(ctx, conta.id);
      // A conciliação roda ao criar: se o pagamento já está no extrato, a conta nasce paga.
      const aviso = depois.pagaEm ? `O pagamento já está no extrato (${dataBr(depois.pagaEm)}): a conta foi marcada como paga.` : null;
      return { inverso: { tipo: 'conta_a_pagar', antes: null, depois }, aviso };
    },
  });
}

// ---------------------------------------------------------------- editar

const edicao = z.object({ contaId: z.string().min(1).max(200), ...z.object(campos).partial().shape });
type PayloadEdicao = z.output<typeof edicao>;

function mudancasDa(ctx: ContextoOperacoes, p: PayloadEdicao): { atual: LinhaContaAPagar; mudancas: Partial<DadosContaAPagar>; texto: string[] } {
  const atual = linha(ctx, p.contaId);
  const { contaId: _id, ...resto } = p;
  const mudancas = Object.fromEntries(Object.entries(resto).filter(([k, v]) => v !== undefined && (atual[k as keyof LinhaContaAPagar] ?? null) !== v));
  const texto = Object.entries(mudancas).map(([k, v]) => descreverCampo(k, atual[k as keyof LinhaContaAPagar], v));
  if (!texto.length) throw new ErroDeAcao('Essa conta já está assim: nada a mudar.');
  return { atual, mudancas: mudancas as Partial<DadosContaAPagar>, texto };
}

function descreverCampo(campo: string, de: unknown, para: unknown): string {
  const f = (v: unknown) => {
    if (v === null || v === undefined || v === '') return 'nenhum';
    if (campo === 'valor') return brl(Number(v));
    if (campo === 'vencimento') return dataBr(String(v));
    if (campo === 'categoriaId') return nomeDaCategoria(String(v));
    if (campo === 'repete') return { nao: 'não repete', mensal: 'todo mês', anual: 'todo ano' }[String(v)] ?? String(v);
    return `“${curto(String(v), 40)}”`;
  };
  const nome = { descricao: 'nome', valor: 'valor', vencimento: 'vencimento', repete: 'repetição', categoriaId: 'categoria', textoNoExtrato: 'texto no extrato', nota: 'nota' }[campo] ?? campo;
  return `${nome} ${f(de)} → ${f(para)}`;
}

export function editarContaAPagar(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'editar_conta_a_pagar',
    modo: 'direta',
    payload: edicao,
    prever: (p) => {
      const { atual, texto } = mudancasDa(ctx, p);
      return { titulo: 'Conta a pagar editada', descricao: `“${curto(atual.descricao)}”: ${texto.join('; ')}.`, efeito: null, exemplos: [] };
    },
    executar: (p) => {
      const { atual, mudancas } = mudancasDa(ctx, p);
      comServico(() => servico(ctx).atualizar(p.contaId, mudancas));
      return { inverso: { tipo: 'conta_a_pagar', antes: atual, depois: linha(ctx, p.contaId) } };
    },
  });
}

// ---------------------------------------------------------------- pagar

const pagamento = z.object({ contaId: z.string().min(1).max(200), data: dia.optional(), movimentoId: z.string().min(1).max(200).optional() });
type PayloadPagamento = z.output<typeof pagamento>;

function conferirPagamento(ctx: ContextoOperacoes, p: PayloadPagamento): LinhaContaAPagar {
  const atual = linha(ctx, p.contaId);
  if (atual.pagaEm) throw new ErroDeAcao(`Essa conta já está paga (em ${dataBr(atual.pagaEm)}).`);
  return atual;
}

export function marcarContaPaga(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'marcar_conta_paga',
    modo: 'direta',
    payload: pagamento,
    prever: (p) => {
      const atual = conferirPagamento(ctx, p);
      const movimento = p.movimentoId ? ctx.financas.movimento(p.movimentoId) : undefined;
      if (p.movimentoId && !movimento) throw new ErroDeAcao('Movimento não encontrado. Use o `id` que buscar_movimentos devolve.');
      const como = movimento ? ` com o movimento “${curto(movimento.descricao, 40)}” de ${dataBr(movimento.data)}` : '';
      const quando = p.data ?? movimento?.data ?? ctx.hoje();
      return { titulo: 'Conta marcada como paga', descricao: `${resumo(atual)} paga em ${dataBr(quando)}${como}.`, efeito: null, exemplos: [] };
    },
    executar: (p) => {
      const antes = conferirPagamento(ctx, p);
      const existentes = new Set(ctx.repositorio.contasAPagar().map((c) => c.id));
      comServico(() => servico(ctx).marcarPaga(p.contaId, { movimentoId: p.movimentoId ?? null, ...(p.data ? { data: p.data } : {}) }));
      const proxima = ctx.repositorio.contasAPagar().find((c) => !existentes.has(c.id) && c.anteriorId === p.contaId);
      const aviso = proxima ? `A próxima (${dataBr(proxima.vencimento)}) já está na lista.` : null;
      return { inverso: { tipo: 'conta_a_pagar', antes, depois: linha(ctx, p.contaId) }, aviso };
    },
  });
}

// ---------------------------------------------------------------- apagar

export function removerContaAPagar(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'remover_conta_a_pagar',
    modo: 'proposta',
    payload: z.object({ contaId: z.string().min(1).max(200) }),
    prever: (p) => {
      const atual = linha(ctx, p.contaId);
      return {
        titulo: 'Apagar conta a pagar',
        descricao: `Apagar ${resumo(atual)}.`,
        efeito: atual.repete !== 'nao' ? 'Ela se repete: apagando, as próximas também deixam de aparecer.' : null,
        exemplos: [],
      };
    },
    executar: (p) => {
      const antes = linha(ctx, p.contaId);
      comServico(() => servico(ctx).remover(p.contaId));
      return { inverso: { tipo: 'conta_a_pagar', antes, depois: null } };
    },
  });
}

// ---------------------------------------------------------------- desfazer

/** Volta uma conta a pagar ao que era. Recusa se a pessoa mexeu nela depois. */
export function desfazerConta(ctx: ContextoOperacoes, antes: LinhaContaAPagar | null, depois: LinhaContaAPagar | null): void {
  const contas = servico(ctx);
  const id = (depois ?? antes)!.id;
  const atual = ctx.repositorio.contaAPagar(id) ?? null;
  if (!antes) {
    // Foi criada: apaga (e a próxima que o pagamento dela gerou, se ninguém mexeu).
    if (!atual) throw new ErroDeAcao('Essa conta já foi apagada.');
    // Paga depois (à mão ou pela conciliação) também conta como mudança: apagar perderia o pagamento.
    if (!mesmosCampos(atual, depois) || atual.pagaEm !== depois!.pagaEm || atual.movimentoId !== depois!.movimentoId) {
      throw new ErroDeAcao('A conta foi mudada (ou paga) depois; apague pela tela de Contas a pagar se quiser.');
    }
    for (const gerada of ctx.repositorio.contasAPagar().filter((c) => c.anteriorId === id && !c.pagaEm)) comServico(() => contas.remover(gerada.id));
    comServico(() => contas.remover(id));
    return;
  }
  if (!depois) {
    // Foi apagada: volta igual, com o mesmo id; `atualizar` sem mudanças só avisa quem acompanha (a Agenda).
    if (atual) throw new ErroDeAcao('Essa conta já existe de novo.');
    ctx.repositorio.salvarContasAPagar([antes]);
    comServico(() => contas.atualizar(id, {}));
    return;
  }
  if (!atual) throw new ErroDeAcao('Essa conta foi apagada depois.');
  if (!mesmosCampos(atual, depois) || atual.pagaEm !== depois.pagaEm) throw new ErroDeAcao('A conta foi mudada depois; ajuste pela tela de Contas a pagar.');
  if (!antes.pagaEm && depois.pagaEm) {
    // Foi marcada como paga: reabre (some a próxima gerada) e devolve a lista de recusados de antes.
    comServico(() => contas.reabrir(id));
    const reaberta = ctx.repositorio.contaAPagar(id);
    if (reaberta && reaberta.recusados !== antes.recusados) ctx.repositorio.salvarContasAPagar([{ ...reaberta, recusados: antes.recusados }]);
    return;
  }
  const campos = Object.fromEntries(EDITAVEIS.map((k) => [k, antes[k]])) as Partial<DadosContaAPagar>;
  comServico(() => contas.atualizar(id, campos));
}
