import { z } from 'zod';
import { CATEGORIAS } from '../../domain/categorias';
import type { FaturaMes } from '../../domain/cartao';
import { intervaloDeMeses, somarMeses } from '../../domain/datas';
import { normalizar } from '../../domain/texto';
import type { Mes } from '../../domain/types';
import type { Financas } from '../../servicos/financas';
import type { RepositorioAssistente } from '../dados/repositorio-assistente';
import { definir, ErroDeFerramenta, type ContextoFerramenta, type Definicao } from './definicao';
import { gerarImagem, type GeradorDeImagens } from './ferramenta-imagem';
import { ferramentasDeAcao } from './ferramentas-acoes';
import { ferramentasDeContas } from './ferramentas-contas';
import type { ServicoDeAcoes } from '../acoes/servico-acoes';
import {
  categoriaPorTexto, mesLegivel, movimentoParaAgente, nomeCategoria, nomesDeCategorias, reais, totaisPorCategoria,
} from './formato';

export { ErroDeFerramenta };
export type { ContextoFerramenta, Definicao };
export type { EntradaGerarImagem, GeradorDeImagens, ImagemCriada } from './ferramenta-imagem';

/**
 * O catálogo de ferramentas do agente. As de leitura ficam aqui; as que mudam
 * dados (ações diretas e propostas, ver `ferramentas-acoes.ts`) e as contas a
 * pagar (`ferramentas-contas.ts`) entram no fim, e `gerar_imagem` só cria um
 * anexo nesta conversa. As descrições são o manual que o modelo lê para
 * decidir o que chamar — por isso dizem o que cada uma devolve e quando usar.
 */

export interface ResultadoDeBusca {
  fonte: 'movimento' | 'anexo';
  refId: string;
  escopo: string;
  texto: string;
  pontuacao: number;
}

export interface Buscador {
  buscar(consulta: string, opcoes: { escopos: string[]; limite: number }): Promise<ResultadoDeBusca[]>;
  /** 'hibrido' com os vetores ativos; 'palavras' só com o índice de palavras. */
  modo(): 'hibrido' | 'palavras';
}

export interface TextosDeAnexos {
  /** Texto extraído de um anexo (PDF, CSV…), ou null se não houver. */
  texto(anexoId: string): string | null;
}

export interface Dependencias {
  financas: Financas;
  assistente: RepositorioAssistente;
  buscador: Buscador;
  textos: TextosDeAnexos;
  /** Sem ele (testes, Fluxo sem o módulo de imagens), `gerar_imagem` responde que não está disponível. */
  imagens?: GeradorDeImagens;
  /** Sem ele, as ferramentas de ação respondem que só dá para ler. */
  acoes?: ServicoDeAcoes;
}

const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM');
const dia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'data no formato AAAA-MM-DD');
const NATUREZAS = ['DESPESA', 'RECEITA', 'ESTORNO', 'PAGAMENTO_FATURA', 'TRANSFERENCIA', 'INVESTIMENTO'] as const;
const SERIE_MAXIMA = 36;
const LIMITE_ANEXO = 50_000;

export function criarCatalogo(deps: Dependencias): Definicao[] {
  return [
    panorama(deps), resumoDoMes(deps), serieMensal(deps), buscarMovimentos(deps), buscaSemantica(deps),
    cartoesEFaturas(deps), itensDaFatura(deps), orcamento(deps), metas(deps), recorrencias(deps),
    caixinhasEInvestimentos(deps), insights(deps), categorias(), anexos(deps), lerAnexo(deps), gerarImagem(deps.imagens, pedidosDe(deps.assistente)),
    ...ferramentasDeAcao(deps), ...ferramentasDeContas(deps),
  ];
}

/** A última mensagem que a pessoa escreveu na conversa (para `gerar_imagem` saber se ela pediu uma imagem). */
function pedidosDe(assistente: RepositorioAssistente) {
  return {
    ultimaPergunta: (conversaId: string) => assistente.mensagens(conversaId).filter((m) => m.papel === 'usuario').at(-1)?.texto ?? null,
  };
}

const resumoCurto = (r: { receitas: number; despesas: number; guardado: number; resultado: number }) => ({
  receitas: reais(r.receitas), despesas: reais(r.despesas), guardado: reais(r.guardado), resultado: reais(r.resultado),
});

const fatura = (f: FaturaMes) => ({
  mes: f.mes, vencimento: f.vencimento, total: reais(f.total), pago: reais(f.pago), situacao: f.situacao, compras: f.quantidade,
});

function panorama({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'panorama',
    descricao:
      'Situação financeira de hoje: data de hoje, mês atual, meses com dados, saldos das contas e caixinhas, patrimônio ' +
      '(contas + caixinhas + investimentos − fatura aberta), cartões (limite, disponível, fatura aberta), o resumo do mês ' +
      'atual, as próximas contas recorrentes e os alertas. Use primeiro, para se situar antes de qualquer análise.',
    entrada: z.object({}),
    rotulo: () => 'Panorama das finanças',
    executar: () => {
      const mesAtual = financas.mesAtual();
      const v = financas.visaoGeral(mesAtual);
      const e = financas.estado(false, () => false);
      return {
        hoje: e.hoje,
        mesAtual,
        mesesComDados: { primeiro: e.mesesDisponiveis.at(-1) ?? mesAtual, ultimo: e.mesesDisponiveis[0] ?? mesAtual, quantidade: e.mesesDisponiveis.length },
        contas: v.contas.map((c) => ({ nome: c.nome, tipo: c.tipo, saldo: reais(c.saldo) })),
        caixinhas: v.caixinhas.map((c) => ({ nome: c.nome, valor: reais(c.valor) })),
        patrimonio: {
          total: reais(v.patrimonio.total), contas: reais(v.patrimonio.contas), caixinhas: reais(v.patrimonio.caixinhas),
          investimentos: reais(v.patrimonio.investimentos), faturaAberta: reais(v.patrimonio.faturaAberta),
        },
        cartoes: v.cartoes.map((c) => ({
          contaId: c.contaId, nome: c.nome, limite: c.limite === null ? null : reais(c.limite),
          disponivel: c.disponivel === null ? null : reais(c.disponivel), faturaAberta: c.faturaAberta ? fatura(c.faturaAberta) : null,
          parcelasFuturas: reais(c.compromissoFuturo),
        })),
        mesAtualAteAgora: resumoCurto(v.resumo),
        proximasContas: v.proximas.map((r) => ({ nome: r.nome, valor: reais(r.valorTipico), data: r.proximaData })),
        alertas: v.alertas.map((a) => ({ gravidade: a.gravidade, titulo: a.titulo, detalhe: a.detalhe })),
        conexoes: e.conexoes.map((c) => ({ banco: c.nome, situacao: c.situacao, ultimaSincronizacao: c.ultimaSincronizacao })),
      };
    },
  });
}

function resumoDoMes({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'resumo_do_mes',
    descricao:
      'Receitas, despesas, quanto foi guardado (caixinhas/investimentos) e o resultado de um mês, por competência (a parcela de ' +
      'uma compra parcelada conta no mês dela; pagamento de fatura e transferência entre contas próprias não contam). Traz os ' +
      'gastos e as receitas por categoria (valor, quantidade, % do total) e o mês anterior para comparar. Sem `mes`, usa o atual.',
    entrada: z.object({ mes: mes.optional() }),
    rotulo: (e) => `Resumo de ${mesLegivel(e.mes ?? financas.mesAtual())}`,
    executar: (e) => {
      const alvo = e.mes ?? financas.mesAtual();
      const r = financas.resumo(alvo);
      return {
        mes: alvo,
        ...resumoCurto(r),
        gastosPorCategoria: totaisPorCategoria(r.porCategoria, r.despesas),
        receitasPorCategoria: totaisPorCategoria(r.receitasPorCategoria, r.receitas),
        mesAnterior: { mes: somarMeses(alvo, -1), ...resumoCurto(financas.resumo(somarMeses(alvo, -1))) },
        mesEmAndamento: alvo === financas.mesAtual(),
      };
    },
  });
}

function serieMensal({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'serie_mensal',
    descricao:
      `Receitas, despesas, guardado e resultado mês a mês num intervalo (no máximo ${SERIE_MAXIMA} meses). Use para tendências, ` +
      'médias e comparações entre períodos. Sem `de`/`ate`, devolve os últimos 12 meses.',
    entrada: z.object({ de: mes.optional(), ate: mes.optional() }),
    rotulo: (e) => (e.de && e.ate ? `Série de ${mesLegivel(e.de)} a ${mesLegivel(e.ate)}` : 'Série dos últimos 12 meses'),
    executar: (e) => {
      const ate = e.ate ?? financas.mesAtual();
      const de = e.de ?? somarMeses(ate, -11);
      if (de > ate) throw new ErroDeFerramenta('`de` precisa ser antes de `ate`.');
      const meses = intervaloDeMeses(de, ate);
      if (meses.length > SERIE_MAXIMA) throw new ErroDeFerramenta(`Intervalo grande demais: no máximo ${SERIE_MAXIMA} meses.`);
      return { de, ate, meses: meses.map((m) => ({ mes: m, ...resumoCurto(financas.resumo(m)) })) };
    },
  });
}

const filtroMovimentos = z.object({
  mes: mes.optional().describe('Mês de competência (AAAA-MM).'),
  de: dia.optional().describe('Data inicial (inclusive).'),
  ate: dia.optional().describe('Data final (inclusive).'),
  categoria: z.string().max(60).optional().describe('Id ou nome da categoria.'),
  natureza: z.enum(NATUREZAS).optional(),
  sentido: z.enum(['ENTRADA', 'SAIDA']).optional(),
  texto: z.string().max(100).optional().describe('Trecho da descrição, loja, contraparte ou nota.'),
  conta: z.string().max(80).optional().describe('Nome (ou parte) da conta/cartão.'),
  valorMin: z.number().min(0).optional().describe('Em reais.'),
  valorMax: z.number().min(0).optional().describe('Em reais.'),
  ordem: z.enum(['data', 'valor']).default('data').describe('data: mais recentes primeiro; valor: maiores primeiro.'),
  limite: z.number().int().min(1).max(200).default(50),
});

function buscarMovimentos({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'buscar_movimentos',
    descricao:
      'Lista movimentos (compras, Pix, salários, pagamentos…) com filtros combináveis: mês de competência, intervalo de datas, ' +
      'categoria, natureza (DESPESA, RECEITA, ESTORNO, PAGAMENTO_FATURA, TRANSFERENCIA, INVESTIMENTO), sentido, texto, conta e ' +
      'faixa de valor em reais. Devolve o total encontrado, a soma dos gastos (natureza DESPESA) e das receitas (RECEITA e ' +
      'ESTORNO) do conjunto inteiro, e até `limite` itens. Para nomes de loja que você não sabe ao certo, use busca_semantica.',
    entrada: filtroMovimentos,
    rotulo: (e) => rotuloDaBusca(e),
    executar: (e) => {
      const categoriaId = e.categoria ? categoriaPorTexto(e.categoria) : null;
      if (e.categoria && !categoriaId) throw new ErroDeFerramenta(`Categoria desconhecida. As válidas são: ${nomesDeCategorias()}.`);
      const texto = normalizar(e.texto);
      const conta = normalizar(e.conta);
      const filtrados = financas.todosOsMovimentos().filter((m) =>
        (!e.mes || m.competencia === e.mes) && (!e.de || m.data >= e.de) && (!e.ate || m.data <= e.ate) &&
        (!categoriaId || m.categoriaId === categoriaId) && (!e.natureza || m.natureza === e.natureza) &&
        (!e.sentido || m.sentido === e.sentido) && (!conta || normalizar(m.conta).includes(conta)) &&
        (e.valorMin === undefined || m.valor >= Math.round(e.valorMin * 100)) &&
        (e.valorMax === undefined || m.valor <= Math.round(e.valorMax * 100)) &&
        (!texto || normalizar(`${m.descricao} ${m.estabelecimento ?? ''} ${m.contraparteNome ?? ''} ${m.nota ?? ''}`).includes(texto)));
      const ordenados = [...filtrados].sort((a, b) =>
        e.ordem === 'valor' ? b.valor - a.valor || b.data.localeCompare(a.data) : b.data.localeCompare(a.data) || b.id.localeCompare(a.id));
      const somar = (f: (n: string) => boolean) => reais(filtrados.filter((m) => f(m.natureza)).reduce((s, m) => s + m.valor, 0));
      return {
        total: filtrados.length,
        totalGastos: somar((n) => n === 'DESPESA'),
        totalReceitas: somar((n) => n === 'RECEITA' || n === 'ESTORNO'),
        mostrando: Math.min(e.limite, filtrados.length),
        itens: ordenados.slice(0, e.limite).map(movimentoParaAgente),
      };
    },
  });
}

function rotuloDaBusca(e: z.output<typeof filtroMovimentos>): string {
  const partes = [e.texto ? `“${e.texto}”` : null, e.categoria ? (nomeCategoria(categoriaPorTexto(e.categoria)) ?? e.categoria) : null,
    e.mes ? mesLegivel(e.mes) : null, e.de || e.ate ? `${e.de ?? '…'} a ${e.ate ?? '…'}` : null].filter(Boolean);
  return partes.length ? `Movimentos: ${partes.join(' · ')}` : 'Movimentos';
}

function buscaSemantica({ financas, buscador }: Dependencias): Definicao {
  return definir({
    nome: 'busca_semantica',
    descricao:
      'Busca por significado e por palavra nos movimentos e no texto dos anexos desta conversa. Use quando não souber o nome ' +
      'exato da loja ou da categoria ("comida fora de casa", "gastos com o carro", "academia") ou para achar um trecho de um ' +
      'anexo. Movimentos encontrados vêm completos; trechos de anexo vêm com o id do anexo (leia mais com ler_anexo).',
    entrada: z.object({
      consulta: z.string().trim().min(2).max(300),
      fontes: z.array(z.enum(['movimentos', 'anexos'])).min(1).default(['movimentos', 'anexos']),
      limite: z.number().int().min(1).max(30).default(10),
    }),
    rotulo: (e) => `Busca: “${e.consulta}”`,
    executar: async (e, ctx) => {
      const escopos = [...(e.fontes.includes('movimentos') ? ['movimentos'] : []), ...(e.fontes.includes('anexos') ? [`conversa:${ctx.conversaId}`] : [])];
      const achados = await buscador.buscar(e.consulta, { escopos, limite: e.limite });
      const porId = new Map(financas.todosOsMovimentos().map((m) => [m.id, m]));
      return {
        modo: buscador.modo() === 'hibrido' ? 'significado e palavras' : 'só palavras (busca inteligente desligada nos Ajustes)',
        resultados: achados.map((a) => {
          const m = a.fonte === 'movimento' ? porId.get(a.refId) : undefined;
          return m ? { fonte: a.fonte, movimento: movimentoParaAgente(m) } : { fonte: a.fonte, anexoId: a.refId, trecho: a.texto };
        }),
      };
    },
  });
}

function cartoesEFaturas({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'cartoes_e_faturas',
    descricao:
      'Cartões de crédito: limite, usado, disponível, fatura atual, as faturas mês a mês (total, pago, situação PAGA/FECHADA/' +
      'ABERTA/FUTURA, vencimento, gastos por categoria) e as compras parceladas em andamento (parcela atual, quanto falta).',
    entrada: z.object({}),
    rotulo: () => 'Cartões e faturas',
    executar: () => ({
      cartoes: financas.cartoes().map((c) => ({
        contaId: c.contaId, nome: c.nome, limite: c.limite === null ? null : reais(c.limite), usado: c.usado === null ? null : reais(c.usado),
        disponivel: c.disponivel === null ? null : reais(c.disponivel), faturaAtual: c.faturaAtual, parcelasFuturas: reais(c.compromissoFuturo),
        faturas: c.faturas.slice(-14).map((f) => ({ ...fatura(f), porCategoria: totaisPorCategoria(f.porCategoria, f.somaItens) })),
        parcelamentos: c.parcelamentos.map((p) => ({
          descricao: p.descricao, categoria: nomeCategoria(p.categoriaId), parcela: `${p.parcelaAtual}/${p.totalParcelas}`,
          valorParcela: reais(p.valorParcela), restante: reais(p.restante), valorTotal: reais(p.valorTotal), ultimaFatura: p.ultimaFatura,
        })),
      })),
    }),
  });
}

function itensDaFatura({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'itens_da_fatura',
    descricao: 'As compras e créditos de uma fatura de cartão (pelo contaId do cartão, de cartoes_e_faturas, e o mês da fatura).',
    entrada: z.object({ contaId: z.string().min(1).max(200), mes }),
    rotulo: (e) => `Fatura de ${mesLegivel(e.mes)}`,
    executar: (e) => {
      const cartao = financas.cartoes().find((c) => c.contaId === e.contaId);
      if (!cartao) throw new ErroDeFerramenta('Cartão não encontrado. Use o contaId devolvido por cartoes_e_faturas.');
      const porId = new Map(financas.todosOsMovimentos().map((m) => [m.id, m]));
      const itens = financas.itensDaFatura(e.contaId, e.mes).map((m) => movimentoParaAgente(porId.get(m.id) ?? { ...m, conta: cartao.nome }));
      const total = itens.reduce((s, i) => s + (i.sentido === 'SAIDA' ? i.valor : -i.valor), 0);
      return { cartao: cartao.nome, mes: e.mes, total: Math.round(total * 100) / 100, itens };
    },
  });
}

function orcamento({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'orcamento',
    descricao: 'Limites de gasto por categoria que a pessoa definiu × quanto já foi gasto no mês, projeção até o fim do mês e situação. Sem `mes`, o atual.',
    entrada: z.object({ mes: mes.optional() }),
    rotulo: (e) => `Orçamento de ${mesLegivel(e.mes ?? financas.mesAtual())}`,
    executar: (e) => {
      const o = financas.orcamento(e.mes ?? financas.mesAtual());
      return {
        mes: o.mes, totalLimite: reais(o.totalLimite), totalGasto: reais(o.totalGasto), receitas: reais(o.receitas),
        linhas: o.linhas.map((l) => ({
          categoria: nomeCategoria(l.categoriaId), limite: reais(l.limite), gasto: reais(l.gasto), restante: reais(l.restante),
          percentual: Math.round(l.percentual * 1000) / 10, situacao: l.situacao, projecaoFimDoMes: reais(l.projecao),
        })),
        categoriasSemLimite: o.semLimite.map((s) => ({ categoria: nomeCategoria(s.categoriaId), gasto: reais(s.gasto), sugestao: reais(s.sugestao) })),
      };
    },
  });
}

function metas({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'metas',
    descricao: 'Metas de economia: alvo, quanto já tem, quanto falta, prazo, quanto guardar por mês para chegar no prazo e o ritmo real.',
    entrada: z.object({}),
    rotulo: () => 'Metas',
    executar: () => ({
      metas: financas.metas().map((m) => ({
        id: m.id, nome: m.nome, alvo: reais(m.alvo), prazo: m.prazo, caixinha: m.caixinhaNome, atual: reais(m.progresso.atual),
        falta: reais(m.progresso.falta), percentual: Math.round(m.progresso.percentual * 1000) / 10, concluida: m.progresso.concluida,
        porMesParaOPrazo: m.progresso.porMes === null ? null : reais(m.progresso.porMes),
        ritmoMensal: m.progresso.ritmoMensal === null ? null : reais(m.progresso.ritmoMensal),
        previsao: m.progresso.previsao, noRitmo: m.progresso.noRitmo,
      })),
    }),
  });
}

function recorrencias({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'recorrencias',
    descricao: 'Assinaturas e contas que se repetem todo mês (detectadas pelo histórico): valor típico, último valor, próxima data, custo anual, aumentos recentes.',
    entrada: z.object({}),
    rotulo: () => 'Assinaturas e contas fixas',
    executar: () => {
      const r = financas.recorrencias();
      return {
        custoMensal: reais(r.mensal), custoAnual: reais(r.anual),
        itens: r.itens.map((i) => ({
          nome: i.nome, categoria: nomeCategoria(i.categoriaId), valorTipico: reais(i.valorTipico), ultimoValor: reais(i.ultimoValor),
          ultimaData: i.ultimaData, proximaData: i.proximaData, meses: i.meses, custoAnual: reais(i.custoAnual), ativa: i.ativa,
          aumento: i.aumento ? { de: reais(i.aumento.de), para: reais(i.aumento.para) } : null,
        })),
      };
    },
  });
}

function caixinhasEInvestimentos({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'caixinhas_e_investimentos',
    descricao: 'Caixinhas (reservas) e investimentos: valores, indexador, rendimento mensal estimado e a evolução das caixinhas nos últimos 12 meses.',
    entrada: z.object({}),
    rotulo: () => 'Caixinhas e investimentos',
    executar: () => {
      const c = financas.caixinhas();
      return {
        totalCaixinhas: reais(c.total), totalInvestimentos: reais(c.investimentos), rendimentoEstimadoMes: reais(c.rendimentoEstimadoMes),
        caixinhas: c.caixinhas.map((x) => ({
          nome: x.nome, valor: reais(x.valor), indexador: x.indexador, percentualIndexador: x.percentualIndexador,
          evolucao: x.serie.map((p) => ({ mes: p.mes, valor: p.valor === null ? null : reais(p.valor) })),
        })),
        investimentos: c.listaInvestimentos.filter((i) => !i.duplicado).map((i) => ({
          nome: i.nome, tipo: i.tipo, subtipo: i.subtipo, saldo: reais(i.saldo), vencimento: i.vencimento, indexador: i.indexador,
        })),
      };
    },
  });
}

function insights({ financas }: Dependencias): Definicao {
  return definir({
    nome: 'insights',
    descricao: 'Análise de um mês: categorias que mais subiram/caíram contra a média dos 3 meses anteriores, maiores gastos, onde mais gastou, gasto por dia da semana, ticket médio e média diária.',
    entrada: z.object({ mes: mes.optional() }),
    rotulo: (e) => `Insights de ${mesLegivel(e.mes ?? financas.mesAtual())}`,
    executar: (e) => {
      const i = financas.insights(e.mes ?? financas.mesAtual());
      const semana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
      return {
        mes: i.mes, quantidade: i.quantidade, ticketMedio: reais(i.ticketMedio), mediaDiaria: reais(i.mediaDiaria),
        variacoes: i.variacoes.map((v) => ({ categoria: nomeCategoria(v.categoriaId), atual: reais(v.atual), media3Meses: reais(v.media3), diferenca: reais(v.delta) })),
        maioresGastos: i.maioresGastos.map((g) => ({ data: g.data, descricao: g.descricao, valor: reais(g.valor), categoria: nomeCategoria(g.categoriaId) })),
        ondeMaisGastou: i.estabelecimentos.map((g) => ({ nome: g.nome, total: reais(g.total), vezes: g.vezes })),
        porDiaDaSemana: i.porDiaDaSemana.map((v, n) => ({ dia: semana[n], valor: reais(v) })),
      };
    },
  });
}

function categorias(): Definicao {
  return definir({
    nome: 'categorias',
    descricao: 'As categorias que o Fluxo usa (id, nome e se é de gasto ou de receita).',
    entrada: z.object({}),
    rotulo: () => 'Categorias',
    executar: () => ({ categorias: CATEGORIAS.map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo })) }),
  });
}

function anexos({ assistente }: Dependencias): Definicao {
  return definir({
    nome: 'anexos',
    descricao: 'Os arquivos que a pessoa anexou nesta conversa (id, nome, tipo e se o texto já foi extraído).',
    entrada: z.object({}),
    rotulo: () => 'Anexos da conversa',
    executar: (_e, ctx) => ({
      anexos: assistente.anexosDaConversa(ctx.conversaId).map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, tamanhoBytes: a.tamanho, situacao: a.situacao })),
    }),
  });
}

function lerAnexo({ assistente, textos }: Dependencias): Definicao {
  return definir({
    nome: 'ler_anexo',
    descricao:
      `Lê o texto extraído de um anexo desta conversa (PDF, CSV, OFX, TXT…), em páginas de até ${LIMITE_ANEXO} caracteres: ` +
      'passe `inicio` para continuar de onde parou (veja `temMais`). Imagens não têm texto aqui.',
    entrada: z.object({
      anexoId: z.string().min(1).max(100),
      inicio: z.number().int().min(0).default(0),
      limite: z.number().int().min(100).max(LIMITE_ANEXO).default(20_000),
    }),
    rotulo: (e) => `Leu o anexo ${nomeDoAnexo(assistente, e.anexoId)}`,
    executar: (e, ctx) => {
      const anexo = assistente.anexo(e.anexoId);
      if (!anexo || anexo.conversaId !== ctx.conversaId) throw new ErroDeFerramenta('Anexo não encontrado nesta conversa. Veja a ferramenta anexos.');
      const texto = textos.texto(anexo.id);
      if (texto === null) throw new ErroDeFerramenta(anexo.tipo === 'imagem' ? 'É uma imagem: não há texto extraído.' : `O texto deste anexo não está disponível (situação: ${anexo.situacao}).`);
      const fim = Math.min(texto.length, e.inicio + e.limite);
      return { nome: anexo.nome, tipo: anexo.tipo, totalCaracteres: texto.length, inicio: e.inicio, fim, temMais: fim < texto.length, texto: texto.slice(e.inicio, fim) };
    },
  });
}

function nomeDoAnexo(assistente: RepositorioAssistente, id: string): string {
  const nome = assistente.anexo(id)?.nome;
  return nome ? `“${nome}”` : '';
}

export type { Mes };
