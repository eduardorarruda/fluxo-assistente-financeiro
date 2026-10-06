import { z } from 'zod';
import { agir, categoriaDaFerramenta, centavos, chamar, dia, propor, servico, type DependenciasDeAcao } from './ferramentas-acoes';
import { definir, ErroDeFerramenta, type Definicao } from './definicao';
import { nomeCategoria, reais } from './formato';

/**
 * Contas a pagar pelo assistente ("a luz de R$ 150 vence dia 15"). Ler, criar,
 * editar e marcar como paga são diretas; apagar é proposta.
 */

const REPETE = ['nao', 'mensal', 'anual'] as const;

function contas(deps: DependenciasDeAcao) {
  const c = servico(deps).contas();
  if (!c) throw new ErroDeFerramenta('As contas a pagar não estão disponíveis neste Fluxo.');
  return c;
}

function listarContas(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'contas_a_pagar',
    descricao:
      'As contas a pagar que a pessoa cadastrou (luz, aluguel, boletos…): id, descrição, valor em reais, vencimento, se repete, situação ' +
      '(aberta, paga, atrasada), quando foi paga. Filtros opcionais por situação e período de vencimento. Use antes de editar, marcar ' +
      'como paga ou apagar uma conta, e para responder "o que vence esta semana".',
    entrada: z.object({
      situacao: z.enum(['aberta', 'paga', 'atrasada']).optional(),
      de: dia.optional().describe('Vencimento a partir de (inclusive).'),
      ate: dia.optional().describe('Vencimento até (inclusive).'),
    }),
    rotulo: (e) => (e.situacao ? `Contas a pagar (${e.situacao === 'paga' ? 'pagas' : `${e.situacao}s`})` : 'Contas a pagar'),
    executar: (e) => chamar(() => {
      const lista = contas(deps).listar({ ...(e.situacao ? { situacao: e.situacao } : {}), ...(e.de ? { de: e.de } : {}), ...(e.ate ? { ate: e.ate } : {}) });
      return {
        total: lista.length,
        somaEmAberto: reais(lista.filter((c) => c.situacao !== 'paga').reduce((s, c) => s + c.valor, 0)),
        contas: lista.map((c) => ({
          id: c.id, descricao: c.descricao, valor: reais(c.valor), vencimento: c.vencimento, repete: c.repete, situacao: c.situacao,
          categoria: nomeCategoria(c.categoriaId), pagaEm: c.pagaEm, criadaPor: c.origem, nota: c.nota,
        })),
      };
    }),
  });
}

const camposConta = {
  descricao: z.string().trim().min(1).max(80).describe('Nome curto: "Conta de luz", "Aluguel".'),
  valor: z.number().positive().max(100_000_000).describe('Em reais.'),
  vencimento: dia,
  repete: z.enum(REPETE).describe("'nao' (uma vez), 'mensal' ou 'anual'."),
  categoria: z.string().max(60).nullable().describe('Id ou nome de uma categoria de gasto.'),
  textoNoExtrato: z.string().trim().max(60).nullable().describe('Como o débito aparece no extrato (ex.: "ENEL"), para o Fluxo achar o pagamento sozinho.'),
  nota: z.string().trim().max(500).nullable(),
};

/** Reais → centavos e nome de categoria → id; só o que veio. */
function paraPayload(e: Partial<{ [K in keyof typeof camposConta]: z.output<(typeof camposConta)[K]> }>): Record<string, unknown> {
  return {
    ...(e.descricao !== undefined ? { descricao: e.descricao } : {}),
    ...(e.valor !== undefined ? { valor: centavos(e.valor) } : {}),
    ...(e.vencimento !== undefined ? { vencimento: e.vencimento } : {}),
    ...(e.repete !== undefined ? { repete: e.repete } : {}),
    ...(e.categoria !== undefined ? { categoriaId: e.categoria === null ? null : categoriaDaFerramenta(e.categoria) } : {}),
    ...(e.textoNoExtrato !== undefined ? { textoNoExtrato: e.textoNoExtrato || null } : {}),
    ...(e.nota !== undefined ? { nota: e.nota || null } : {}),
  };
}

const AVISO_DIRETA = 'AÇÃO DIRETA: muda na hora e aparece no chat com "Desfazer". Use quando a PESSOA pedir.';

function criarConta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'criar_conta_a_pagar',
    efeito: 'escrita',
    descricao:
      `${AVISO_DIRETA} Cadastra uma conta a pagar ("a luz de R$ 150 vence dia 15", "aluguel todo dia 5"). Vencimento como data completa: se a ` +
      'pessoa disser só o dia, use o próximo dia com esse número a partir de hoje. Conta fixa todo mês = `repete: mensal`. Se o pagamento já ' +
      'estiver no extrato, o Fluxo marca como paga sozinho.',
    entrada: z.object({
      ...camposConta,
      repete: camposConta.repete.optional(),
      categoria: camposConta.categoria.optional(),
      textoNoExtrato: camposConta.textoNoExtrato.optional(),
      nota: camposConta.nota.optional(),
    }),
    rotulo: (e) => `Criou a conta “${e.descricao}”`,
    executar: (e, ctx) => agir(deps, ctx, 'criar_conta_a_pagar', paraPayload(e)),
  });
}

function editarConta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'editar_conta_a_pagar',
    efeito: 'destrutiva',
    descricao: `${AVISO_DIRETA} Muda uma conta a pagar (o \`id\` vem de contas_a_pagar): valor, vencimento, nome, repetição, categoria, texto no extrato ou nota. Mande só o que muda.`,
    entrada: z.object({ contaId: z.string().min(1).max(200), ...z.object(camposConta).partial().shape }),
    rotulo: () => 'Editou uma conta a pagar',
    executar: (e, ctx) => {
      const { contaId, ...resto } = e;
      return agir(deps, ctx, 'editar_conta_a_pagar', { contaId, ...paraPayload(resto) });
    },
  });
}

function marcarPaga(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'marcar_conta_paga',
    efeito: 'destrutiva',
    descricao:
      `${AVISO_DIRETA} Marca uma conta a pagar como paga (o \`id\` vem de contas_a_pagar), com a data (padrão: hoje) e, se souber, o movimento ` +
      'do extrato que pagou (id de buscar_movimentos). Conta que repete ganha a próxima ocorrência.',
    entrada: z.object({ contaId: z.string().min(1).max(200), data: dia.optional(), movimentoId: z.string().min(1).max(200).optional() }),
    rotulo: () => 'Marcou uma conta como paga',
    executar: (e, ctx) => agir(deps, ctx, 'marcar_conta_paga', {
      contaId: e.contaId, ...(e.data ? { data: e.data } : {}), ...(e.movimentoId ? { movimentoId: e.movimentoId } : {}),
    }),
  });
}

function removerConta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'remover_conta_a_pagar',
    efeito: 'escrita',
    descricao: 'PROPOSTA: não muda nada — mostra um cartão com Aprovar/Recusar. Apaga uma conta a pagar (o `id` vem de contas_a_pagar). Depois, peça a confirmação em uma frase curta.',
    entrada: z.object({ contaId: z.string().min(1).max(200) }),
    rotulo: () => 'Propôs apagar uma conta a pagar',
    executar: (e, ctx) => propor(deps, ctx, 'remover_conta_a_pagar', { contaId: e.contaId }),
  });
}

export function ferramentasDeContas(deps: DependenciasDeAcao): Definicao[] {
  return [listarContas(deps), criarConta(deps), editarConta(deps), marcarPaga(deps), removerConta(deps)];
}
