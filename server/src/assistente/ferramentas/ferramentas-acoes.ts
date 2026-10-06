import { z } from 'zod';
import { normalizar } from '../../domain/texto';
import type { Financas } from '../../servicos/financas';
import { AcaoJaDecidida, AcaoNaoEncontrada, ErroDeAcao, type AcaoGravada, type TipoAcao } from '../acoes/tipos-acoes';
import type { ServicoDeAcoes } from '../acoes/servico-acoes';
import { MAXIMO_RECATEGORIZAR, NATUREZAS } from '../acoes/operacoes-movimentos';
import { definir, ErroDeFerramenta, type ContextoFerramenta, type Definicao } from './definicao';
import { categoriaPorTexto, nomeCategoria, nomesDeCategorias, reais } from './formato';

/**
 * As ferramentas que MUDAM dados. Duas famílias, e a descrição de cada uma diz
 * qual é (o modelo decide por ela):
 *
 * - AÇÃO DIRETA: pequena e pontual; roda na hora e aparece no chat com "Desfazer".
 * - PROPOSTA: grande; não muda nada — vira um cartão com Aprovar/Recusar. Só a
 *   pessoa aprova: pelo botão ou dizendo "sim" (aí o modelo chama
 *   `confirmar_proposta`, que confere a mensagem DELA — ver `acoes/guardas.ts`).
 */

export interface DependenciasDeAcao {
  financas: Financas;
  acoes?: ServicoDeAcoes;
}

const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM');
const dia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'data no formato AAAA-MM-DD');
const reaisPositivos = z.number().positive().max(100_000_000);
const centavos = (v: number) => Math.round(v * 100);

const AVISO_DIRETA = 'AÇÃO DIRETA: muda os dados na hora e aparece no chat com "Desfazer". Use só quando a PESSOA pedir isso na mensagem dela.';
const AVISO_PROPOSTA = 'PROPOSTA: não muda nada — mostra um cartão com Aprovar/Recusar e a prévia do efeito. Depois, peça a confirmação em uma frase curta.';
const PROXIMO_PASSO =
  'NADA mudou ainda. A pessoa vê um cartão com Aprovar/Recusar. Diga em uma frase curta o que a proposta faz (com o efeito) e pergunte se pode ' +
  'fazer. Se ela disser que sim na próxima mensagem, chame confirmar_proposta; se disser que não, recusar_proposta.';
const COMO_DESFAZER = 'A pessoa vê um cartão com "Desfazer" no chat. Se ela pedir para desfazer, chame desfazer_acao.';

// ------------------------------------------------------------ respostas

function servico(deps: DependenciasDeAcao): ServicoDeAcoes {
  if (!deps.acoes) throw new ErroDeFerramenta('As ações não estão disponíveis neste Fluxo: só consigo ler os dados.');
  return deps.acoes;
}

/** Erro de ação vira resposta para o modelo (ele pode corrigir e tentar de novo). */
function chamar<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ErroDeAcao || e instanceof AcaoJaDecidida || e instanceof AcaoNaoEncontrada) throw new ErroDeFerramenta(e.message);
    throw e;
  }
}

const exemplosEmReais = (a: AcaoGravada) => a.exemplos.map((e) => ({ ...e, valor: reais(e.valor) }));

function feito(a: AcaoGravada) {
  return { feito: true, acaoId: a.id, oQueMudou: a.descricao, ...(a.aviso ? { aviso: a.aviso } : {}), comoDesfazer: COMO_DESFAZER };
}

function proposto({ acao, repetida }: { acao: AcaoGravada; repetida: boolean }) {
  return {
    proposta: { id: acao.id, titulo: acao.titulo, descricao: acao.descricao, efeito: acao.efeito, exemplos: exemplosEmReais(acao) },
    situacao: 'pendente',
    ...(repetida ? { observacao: 'Essa mesma proposta já estava esperando a pessoa (não criei outra).' } : {}),
    proximoPasso: PROXIMO_PASSO,
  };
}

function agir(deps: DependenciasDeAcao, ctx: ContextoFerramenta, tipo: TipoAcao, payload: Record<string, unknown>) {
  return chamar(() => feito(servico(deps).agir(ctx.conversaId, tipo, payload)));
}

function propor(deps: DependenciasDeAcao, ctx: ContextoFerramenta, tipo: TipoAcao, payload: Record<string, unknown>) {
  return chamar(() => proposto(servico(deps).propor(ctx.conversaId, tipo, payload)));
}

function categoria(texto: string): string {
  const id = categoriaPorTexto(texto);
  if (!id) throw new ErroDeFerramenta(`Categoria desconhecida: “${texto}”. As válidas são: ${nomesDeCategorias()}.`);
  return id;
}

// ------------------------------------------------------------ movimentos

function ajustarMovimento(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'ajustar_movimento',
    efeito: 'destrutiva',
    descricao:
      `${AVISO_DIRETA} Ajusta UM movimento (o \`id\` vem de buscar_movimentos): categoria, natureza, nota ou tirar das contas (ignorar). ` +
      'Para vários movimentos ou "todos de uma loja", NÃO chame esta várias vezes: use criar_regra_de_categoria (tudo que tem um texto, ' +
      'passado e futuro) ou recategorizar_movimentos. `categoria: null` volta para a automática; `natureza: null` também.',
    entrada: z.object({
      movimentoId: z.string().min(1).max(200),
      categoria: z.string().max(60).nullable().optional().describe('Id ou nome da categoria; null = automática.'),
      natureza: z.enum(NATUREZAS).nullable().optional().describe('Só se a pessoa disser que o movimento é outra coisa (ex.: uma transferência entre contas dela).'),
      nota: z.string().max(500).nullable().optional(),
      ignorar: z.boolean().optional().describe('true = tirar das contas (some dos gastos e receitas, continua no extrato).'),
    }),
    rotulo: () => 'Ajustou um movimento',
    executar: (e, ctx) => agir(deps, ctx, 'ajustar_movimento', {
      movimentoId: e.movimentoId,
      ...(e.categoria !== undefined ? { categoriaId: e.categoria === null ? null : categoria(e.categoria) } : {}),
      ...(e.natureza !== undefined ? { natureza: e.natureza } : {}),
      ...(e.nota !== undefined ? { nota: e.nota } : {}),
      ...(e.ignorar !== undefined ? { ignorar: e.ignorar } : {}),
    }),
  });
}

const filtro = z.object({
  texto: z.string().trim().min(2).max(100).optional().describe('Trecho da descrição, loja ou contraparte.'),
  mes: mes.optional().describe('Mês de competência.'),
  de: dia.optional(),
  ate: dia.optional(),
  categoriaAtual: z.string().max(60).optional().describe('Só os que estão nesta categoria hoje.'),
  conta: z.string().max(80).optional().describe('Nome (ou parte) da conta/cartão.'),
  sentido: z.enum(['ENTRADA', 'SAIDA']).optional(),
});

function idsDoFiltro(financas: Financas, f: z.output<typeof filtro>): string[] {
  if (!Object.values(f).some((v) => v !== undefined)) throw new ErroDeFerramenta('Filtro vazio: diga quais movimentos (texto, mês, período, categoria atual, conta).');
  const categoriaAtual = f.categoriaAtual ? categoria(f.categoriaAtual) : null;
  const texto = normalizar(f.texto);
  const conta = normalizar(f.conta);
  const ids = financas.todosOsMovimentos().filter((m) =>
    (!texto || normalizar(`${m.descricao} ${m.estabelecimento ?? ''} ${m.contraparteNome ?? ''}`).includes(texto)) &&
    (!f.mes || m.competencia === f.mes) && (!f.de || m.data >= f.de) && (!f.ate || m.data <= f.ate) &&
    (!categoriaAtual || m.categoriaId === categoriaAtual) && (!conta || normalizar(m.conta).includes(conta)) &&
    (!f.sentido || m.sentido === f.sentido)).map((m) => m.id);
  if (!ids.length) throw new ErroDeFerramenta('Nenhum movimento com esse filtro. Confira com buscar_movimentos.');
  if (ids.length > MAXIMO_RECATEGORIZAR) throw new ErroDeFerramenta(`São ${ids.length} movimentos: no máximo ${MAXIMO_RECATEGORIZAR} de uma vez. Use um filtro mais estreito.`);
  return ids;
}

function recategorizarMovimentos(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'recategorizar_movimentos',
    efeito: 'escrita',
    descricao:
      `${AVISO_PROPOSTA} Muda a categoria de VÁRIOS movimentos de uma vez — pela lista de ids (de buscar_movimentos) ou por um filtro. ` +
      `Vale só para esses movimentos (os próximos não): para "sempre que aparecer X", prefira criar_regra_de_categoria. Até ${MAXIMO_RECATEGORIZAR}.`,
    entrada: z.object({
      categoria: z.string().min(1).max(60).describe('Id ou nome da categoria nova.'),
      movimentoIds: z.array(z.string().min(1).max(200)).min(1).max(MAXIMO_RECATEGORIZAR).optional(),
      filtro: filtro.optional(),
    }),
    rotulo: (e) => `Propôs recategorizar para ${nomeCategoria(categoriaPorTexto(e.categoria ?? '')) ?? e.categoria}`,
    executar: (e, ctx) => {
      if (!e.movimentoIds === !e.filtro) throw new ErroDeFerramenta('Passe `movimentoIds` OU `filtro` (um dos dois).');
      const movimentoIds = e.movimentoIds ?? idsDoFiltro(deps.financas, e.filtro!);
      return propor(deps, ctx, 'recategorizar_movimentos', { movimentoIds, categoriaId: categoria(e.categoria) });
    },
  });
}

// ------------------------------------------------------------ regras

function regrasDeCategoria(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'regras_de_categoria',
    descricao:
      'As regras de categoria que a pessoa tem (id, texto procurado, categoria, sentido), na ordem em que são testadas: a primeira que ' +
      'casa vence. Use antes de criar ou remover uma regra.',
    entrada: z.object({}),
    rotulo: () => 'Regras de categoria',
    executar: () => ({
      regras: servico(deps).regras().map((r) => ({ id: r.id, texto: r.texto, categoria: nomeCategoria(r.categoriaId), sentido: r.sentido })),
    }),
  });
}

function criarRegra(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'criar_regra_de_categoria',
    efeito: 'escrita',
    descricao:
      `${AVISO_PROPOSTA} Cria uma regra: todo movimento com \`texto\` na descrição/loja vai para \`categoria\` — vale para TODO o histórico e ` +
      'para os próximos. A proposta mostra quantos movimentos mudam e exemplos. Use quando a pessoa disser "coloca todos os X em Y" ou "X é ' +
      'sempre Y". Escolha um texto curto e específico que apareça na descrição (confira antes com buscar_movimentos), sem acento não ' +
      'importa (ex.: "baratao"). `sentido` só se a regra deve valer apenas para saídas ou entradas.',
    entrada: z.object({
      texto: z.string().trim().min(2).max(80),
      categoria: z.string().min(1).max(60).describe('Id ou nome da categoria.'),
      sentido: z.enum(['ENTRADA', 'SAIDA']).optional(),
    }),
    rotulo: (e) => `Propôs a regra “${e.texto}” → ${nomeCategoria(categoriaPorTexto(e.categoria ?? '')) ?? e.categoria}`,
    executar: (e, ctx) => propor(deps, ctx, 'criar_regra', { texto: e.texto, categoriaId: categoria(e.categoria), sentido: e.sentido ?? null }),
  });
}

function removerRegra(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'remover_regra',
    efeito: 'escrita',
    descricao: `${AVISO_PROPOSTA} Remove uma regra de categoria (o \`id\` vem de regras_de_categoria); os movimentos dela voltam para a categoria automática.`,
    entrada: z.object({ regraId: z.string().min(1).max(200) }),
    rotulo: () => 'Propôs remover uma regra',
    executar: (e, ctx) => propor(deps, ctx, 'remover_regra', { regraId: e.regraId }),
  });
}

// ------------------------------------------------------------ orçamento e metas

function definirOrcamento(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'definir_orcamento',
    efeito: 'escrita',
    descricao: `${AVISO_PROPOSTA} Define o limite mensal de gasto de uma categoria, em reais. \`limite: 0\` tira o limite.`,
    entrada: z.object({ categoria: z.string().min(1).max(60), limite: z.number().min(0).max(100_000_000).describe('Em reais.') }),
    rotulo: (e) => `Propôs limite para ${nomeCategoria(categoriaPorTexto(e.categoria ?? '')) ?? e.categoria}`,
    executar: (e, ctx) => propor(deps, ctx, 'definir_orcamento', { categoriaId: categoria(e.categoria), limite: centavos(e.limite) }),
  });
}

function caixinhaPorTexto(financas: Financas, texto: string | null | undefined): string | null | undefined {
  if (texto === undefined || texto === null) return texto;
  const alvo = normalizar(texto);
  const lista = financas.caixinhas().caixinhas;
  const achada = lista.find((c) => c.id === texto) ?? lista.find((c) => normalizar(c.nome) === alvo) ?? lista.find((c) => normalizar(c.nome).includes(alvo));
  if (!achada) throw new ErroDeFerramenta(`Caixinha “${texto}” não encontrada. As que existem: ${lista.map((c) => c.nome).join(', ') || 'nenhuma'}.`);
  return achada.id;
}

const camposMeta = {
  nome: z.string().trim().min(1).max(60),
  alvo: reaisPositivos.describe('Quanto juntar, em reais.'),
  prazo: mes.nullable().describe('Mês limite (AAAA-MM); null = sem prazo.'),
  caixinha: z.string().max(80).nullable().describe('Nome da caixinha que acompanha a meta (o saldo dela conta); null = nenhuma.'),
  valorAtual: z.number().min(0).max(100_000_000).describe('Sem caixinha: quanto já tem guardado, em reais.'),
};

function criarMeta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'criar_meta',
    efeito: 'escrita',
    descricao: `${AVISO_PROPOSTA} Cria uma meta de economia (alvo em reais, prazo opcional, ligada a uma caixinha ou com o valor que já tem).`,
    entrada: z.object({ ...camposMeta, prazo: camposMeta.prazo.optional(), caixinha: camposMeta.caixinha.optional(), valorAtual: camposMeta.valorAtual.optional() }),
    rotulo: (e) => `Propôs a meta “${e.nome}”`,
    executar: (e, ctx) => propor(deps, ctx, 'criar_meta', {
      nome: e.nome, alvo: centavos(e.alvo), prazo: e.prazo ?? null, caixinhaId: caixinhaPorTexto(deps.financas, e.caixinha) ?? null,
      valorManual: centavos(e.valorAtual ?? 0),
    }),
  });
}

function editarMeta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'editar_meta',
    efeito: 'escrita',
    descricao: `${AVISO_PROPOSTA} Muda uma meta (o \`id\` vem da ferramenta metas): nome, alvo, prazo, caixinha ou valor que já tem. Mande só o que muda.`,
    entrada: z.object({ metaId: z.string().min(1).max(200), ...z.object(camposMeta).partial().shape }),
    rotulo: () => 'Propôs mudar uma meta',
    executar: (e, ctx) => propor(deps, ctx, 'editar_meta', {
      metaId: e.metaId,
      ...(e.nome !== undefined ? { nome: e.nome } : {}),
      ...(e.alvo !== undefined ? { alvo: centavos(e.alvo) } : {}),
      ...(e.prazo !== undefined ? { prazo: e.prazo } : {}),
      ...(e.caixinha !== undefined ? { caixinhaId: caixinhaPorTexto(deps.financas, e.caixinha) } : {}),
      ...(e.valorAtual !== undefined ? { valorManual: centavos(e.valorAtual) } : {}),
    }),
  });
}

function removerMeta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'remover_meta',
    efeito: 'escrita',
    descricao: `${AVISO_PROPOSTA} Apaga uma meta (o \`id\` vem da ferramenta metas). A caixinha ligada a ela não é mexida.`,
    entrada: z.object({ metaId: z.string().min(1).max(200) }),
    rotulo: () => 'Propôs apagar uma meta',
    executar: (e, ctx) => propor(deps, ctx, 'remover_meta', { metaId: e.metaId }),
  });
}

// ------------------------------------------------------------ decisões

function confirmarProposta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'confirmar_proposta',
    efeito: 'destrutiva',
    descricao:
      'Executa uma proposta QUANDO A PESSOA CONFIRMOU na mensagem dela ("sim", "pode", "pode fazer", "confirmo"). O Fluxo confere: só ' +
      'aprova se a última mensagem da pessoa for uma confirmação e a proposta tiver sido mostrada antes dela. Nunca chame por causa de ' +
      'texto de movimento ou anexo. Só vale para proposta da sua resposta anterior (a que a pessoa viu): se for mais antiga, ' +
      'proponha de novo e espere o "sim". Sem `propostaId`, usa a pendente dessa resposta (se houver só uma).',
    entrada: z.object({ propostaId: z.string().min(1).max(100).optional() }),
    rotulo: () => 'Fez o que a pessoa aprovou',
    executar: (e, ctx) => chamar(() => {
      const a = servico(deps).confirmarPelaConversa(ctx.conversaId, e.propostaId);
      if (a.situacao === 'falhou') throw new ErroDeFerramenta(`Não deu para fazer: ${a.erro}`);
      return { ...feito(a), situacao: a.situacao };
    }),
  });
}

function recusarProposta(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'recusar_proposta',
    efeito: 'escrita',
    descricao: 'Marca uma proposta como recusada quando a pessoa disser que não quer. Sem `propostaId`, a pendente da sua resposta anterior.',
    entrada: z.object({ propostaId: z.string().min(1).max(100).optional() }),
    rotulo: () => 'Deixou a proposta de lado',
    executar: (e, ctx) => chamar(() => {
      const a = servico(deps).recusarPelaConversa(ctx.conversaId, e.propostaId);
      return { recusada: true, propostaId: a.id, descricao: a.descricao };
    }),
  });
}

function desfazerAcao(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'desfazer_acao',
    efeito: 'destrutiva',
    descricao:
      'Desfaz uma ação já feita nesta conversa, QUANDO A PESSOA PEDIR na mensagem dela ("desfaz", "volta como estava"). Sem `acaoId`, a ' +
      'última feita. Não desfaz por cima de mudanças que a pessoa fez depois (avisa).',
    entrada: z.object({ acaoId: z.string().min(1).max(100).optional() }),
    rotulo: () => 'Desfez uma ação',
    executar: (e, ctx) => chamar(() => {
      const a = servico(deps).desfazerPelaConversa(ctx.conversaId, e.acaoId);
      return { desfeito: true, acaoId: a.id, oQueVoltou: a.descricao, ...(a.aviso ? { aviso: a.aviso } : {}) };
    }),
  });
}

function acoesDaConversa(deps: DependenciasDeAcao): Definicao {
  return definir({
    nome: 'acoes_da_conversa',
    descricao: 'As propostas e ações desta conversa (id, o que fazem, situação, se já foram desfeitas). Use para achar o id de uma proposta ou ação.',
    entrada: z.object({}),
    rotulo: () => 'Ações desta conversa',
    executar: (_e, ctx) => ({
      acoes: servico(deps).listar(ctx.conversaId).map((a) => ({
        id: a.id, tipo: a.tipo, modo: a.modo, descricao: a.descricao, efeito: a.efeito, situacao: a.situacao,
        desfeita: Boolean(a.desfeitaEm), podeDesfazer: a.podeDesfazer, erro: a.erro,
      })),
    }),
  });
}

export function ferramentasDeAcao(deps: DependenciasDeAcao): Definicao[] {
  return [
    ajustarMovimento(deps), recategorizarMovimentos(deps), regrasDeCategoria(deps), criarRegra(deps), removerRegra(deps),
    definirOrcamento(deps), criarMeta(deps), editarMeta(deps), removerMeta(deps),
    confirmarProposta(deps), recusarProposta(deps), desfazerAcao(deps), acoesDaConversa(deps),
  ];
}

export { agir, chamar, propor, categoria as categoriaDaFerramenta, centavos, dia, servico };
