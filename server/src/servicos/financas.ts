import { Inject, Injectable } from '@nestjs/common';
import { gerarAlertas, type Alerta } from '../domain/alertas';
import { entraNaFatura, visaoDoCartao, type VisaoCartao } from '../domain/cartao';
import { CATEGORIA_POR_ID, CATEGORIAS } from '../domain/categorias';
import type { ContextoClassificacao } from '../domain/classificacao';
import { cicloDoCartao, mesDaFatura } from '../domain/competencia';
import { vencimentosDeCartao, type VencimentoDeCartao } from '../domain/contas-a-pagar';
import { diasEntre, intervaloDeMeses, mesDe, somarMeses } from '../domain/datas';
import { caixinhasNoFimDosMeses, saldoNoFimDosMeses, ultimoValorAte } from '../domain/evolucao';
import { gerarInsights } from '../domain/insights';
import { progressoDaMeta } from '../domain/metas';
import { montarMovimentos } from '../domain/movimentos';
import { avaliarOrcamento } from '../domain/orcamento';
import { calcularPatrimonio } from '../domain/patrimonio';
import { detectarRecorrencias, type Recorrencia } from '../domain/recorrencias';
import { fluxoDeCaixa, resumoDoMes, type ResumoMes } from '../domain/resumo';
import { montarSankey } from '../domain/sankey';
import { apenasDigitosEMascara, normalizar } from '../domain/texto';
import type { Mes, Movimento, Natureza } from '../domain/types';
import { Repositorio, type Instantaneo } from '../dados/repositorio';
import { RELOGIO, type Relogio } from '../relogio';

/**
 * CDI de um mês, bruto (antes do IR) e aproximado, para estimar quanto as
 * caixinhas rendem. 1,12% ≈ 14,3% ao ano: é o que os lotes reais de CDB do
 * Nubank renderam em 2026 (tirando os 115% do CDI). A Pluggy não entrega o
 * CDI e as caixinhas chegam somadas, sem data de aplicação — por isso é fixo.
 */
const CDI_MENSAL_ESTIMADO = 0.0112;

interface Base {
  versao: number;
  hoje: string;
  inst: Instantaneo;
  movimentos: Movimento[];
  recorrencias: Recorrencia[];
}

export interface FiltroMovimentos {
  mes?: Mes;
  por?: 'data' | 'competencia';
  contaId?: string;
  categoriaId?: string;
  natureza?: Natureza;
  busca?: string;
  editados?: boolean;
  pagina?: number;
  tamanho?: number;
}

/**
 * O lado de leitura: pega o que está no banco, passa pelo domínio e entrega
 * cada tela pronta. As contas são refeitas só quando o banco muda (a versão
 * do repositório) ou o dia vira.
 */
@Injectable()
export class Financas {
  private cache: Base | null = null;
  /** Alertas de fora das finanças (ex.: o Google Agenda pedindo reconexão), registrados por quem os conhece. */
  private readonly fontesDeAlertas = new Set<() => Alerta[]>();

  constructor(
    private readonly repositorio: Repositorio,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  private base(): Base {
    const hoje = this.relogio.hoje();
    if (this.cache && this.cache.versao === this.repositorio.versao && this.cache.hoje === hoje) return this.cache;
    const inst = this.repositorio.instantaneo();
    const movimentos = montarMovimentos(inst.transacoes, contextoDoTitular(inst), inst.regras, inst.ajustes);
    this.cache = {
      versao: this.repositorio.versao,
      hoje,
      inst,
      movimentos,
      recorrencias: detectarRecorrencias(movimentos, hoje),
    };
    return this.cache;
  }

  mesAtual(): Mes {
    return mesDe(this.relogio.hoje());
  }

  // ---------------------------------------------------------------- estado

  estado(pluggyConfigurada: boolean, sincronizando: (id: string) => boolean) {
    const { inst, movimentos, hoje } = this.base();
    const meses = movimentos.map((m) => m.competencia).filter((m) => m <= somarMeses(mesDe(hoje), 12));
    const primeiro = meses.length ? meses.reduce((a, b) => (a < b ? a : b)) : mesDe(hoje);
    return {
      hoje,
      mesAtual: mesDe(hoje),
      mesesDisponiveis: intervaloDeMeses(primeiro, mesDe(hoje)).reverse(),
      pluggyConfigurada,
      demonstracao: inst.conexoes.some((c) => c.provedor === 'demo'),
      configuracoes: inst.configuracoes,
      conexoes: inst.conexoes.map((c) => ({
        id: c.id,
        provedor: c.provedor,
        nome: c.nome,
        logoUrl: c.logoUrl,
        cor: c.cor,
        situacao: c.situacao,
        erro: c.erro,
        ultimaSincronizacao: c.ultimaSincronizacao,
        atualizadaNoBanco: c.atualizadaNoBanco,
        consentimentoExpira: c.consentimentoExpira,
        sincronizando: sincronizando(c.id),
        contas: inst.contas.filter((k) => k.conexaoId === c.id).map((k) => ({ id: k.id, tipo: k.tipo, nome: k.nome, numero: k.numero, saldo: k.saldo })),
      })),
    };
  }

  // ---------------------------------------------------------- visão geral

  visaoGeral(mes: Mes) {
    const { inst, movimentos, recorrencias, hoje } = this.base();
    const resumo = resumoDoMes(movimentos, mes);
    const anterior = resumoDoMes(movimentos, somarMeses(mes, -1));
    const patrimonio = calcularPatrimonio(inst.contas, inst.caixinhas, inst.investimentos, inst.configuracoes);
    const cartoes = this.cartoes();
    const orcamento = avaliarOrcamento(inst.orcamentos, resumoDoMes(movimentos, mesDe(hoje)), hoje);

    const ultimos12 = intervaloDeMeses(somarMeses(mes, -11), mes);
    const serieMensal = ultimos12.map((m) => {
      const r = resumoDoMes(movimentos, m);
      return { mes: m, receitas: r.receitas, despesas: r.despesas, guardado: r.guardado, resultado: r.resultado };
    });

    const proximas = recorrencias
      .filter((r) => r.ativa && diasEntre(hoje, r.proximaData) >= 0 && diasEntre(hoje, r.proximaData) <= 12)
      .sort((a, b) => a.proximaData.localeCompare(b.proximaData))
      .slice(0, 6);

    return {
      mes,
      patrimonio,
      evolucao: this.evolucaoDoPatrimonio(ultimos12),
      resumo,
      anterior: { receitas: anterior.receitas, despesas: anterior.despesas, guardado: anterior.guardado, resultado: anterior.resultado },
      caixa: fluxoDeCaixa(movimentos, mes),
      serieMensal,
      categorias: resumo.porCategoria.slice(0, 7),
      contas: inst.contas.filter((c) => c.tipo !== 'CARTAO'),
      caixinhas: inst.caixinhas,
      cartoes: cartoes.map((c) => {
        const aberta = c.faturas.find((f) => f.mes === c.faturaAtual);
        const fechada = c.faturas.filter((f) => f.situacao === 'FECHADA').at(-1) ?? null;
        return {
          contaId: c.contaId, nome: c.nome, limite: c.limite, disponivel: c.disponivel, usado: c.usado,
          faturaAberta: aberta ?? null, faturaFechada: fechada, compromissoFuturo: c.compromissoFuturo,
        };
      }),
      orcamento: orcamento.slice(0, 5),
      proximas,
      alertas: this.alertas(),
      ultimos: movimentos
        .filter((m) => m.data <= hoje && !m.pendente)
        .slice(-8)
        .reverse(),
    };
  }

  /** Contas + caixinhas + investimentos no fim de cada mês (sem o cartão, que não tem histórico confiável). */
  private evolucaoDoPatrimonio(meses: Mes[]) {
    const { inst, hoje } = this.base();
    const porMes = new Map(meses.map((m) => [m, { contas: 0, caixinhas: 0, investimentos: 0 }]));
    for (const conta of inst.contas.filter((c) => c.tipo !== 'CARTAO')) {
      const serie = saldoNoFimDosMeses(conta.saldo, inst.transacoes.filter((t) => t.contaId === conta.id), meses, hoje);
      for (const p of serie) porMes.get(p.mes)!.contas += p.valor;
    }
    // Caixinhas: foto quando há, senão refeitas pelas aplicações/resgates da conta —
    // sem isso, os meses antes da primeira sincronização viravam zero.
    for (const contaId of new Set(inst.caixinhas.map((c) => c.contaId))) {
      for (const p of this.caixinhasDaConta(contaId, meses)) porMes.get(p.mes)!.caixinhas += p.valor;
    }
    // Investimento não tem conta de origem para refazer o passado: antes da primeira foto, fica de fora.
    const historico = this.repositorio.historico('investimento');
    const { duplicados } = calcularPatrimonio(inst.contas, inst.caixinhas, inst.investimentos, inst.configuracoes);
    for (const inv of inst.investimentos.filter((i) => !duplicados.includes(i.id))) {
      for (const p of ultimoValorAte(historico.filter((h) => h.refId === inv.id), meses)) {
        if (p.valor !== null) porMes.get(p.mes)!.investimentos += p.valor;
      }
    }
    return meses.map((mes) => {
      const v = porMes.get(mes)!;
      const caixinhas = inst.configuracoes.caixinhasNoSaldo ? 0 : v.caixinhas;
      return { mes, contas: v.contas, caixinhas: v.caixinhas, investimentos: v.investimentos, total: v.contas + caixinhas + v.investimentos };
    });
  }

  /** Soma das caixinhas de uma conta no fim de cada mês (ver `caixinhasNoFimDosMeses`). */
  private caixinhasDaConta(contaId: string, meses: readonly Mes[], so?: string) {
    const { inst, movimentos, hoje } = this.base();
    const historico = this.repositorio.historico('caixinha');
    const caixinhas = inst.caixinhas.filter((c) => c.contaId === contaId && (!so || c.id === so));
    const movimentacoes = movimentos.filter((m) => m.contaId === contaId && m.natureza === 'INVESTIMENTO' && m.tipoConta !== 'CARTAO');
    return caixinhasNoFimDosMeses(
      caixinhas.map((c) => ({ valorAtual: c.valor, fotos: historico.filter((h) => h.refId === c.id) })),
      movimentacoes, meses, hoje,
    );
  }

  /**
   * Série de uma caixinha. Sozinha na conta, as aplicações/resgates são dela e
   * o passado pode ser refeito; com outras na mesma conta não dá para saber de
   * qual saiu cada resgate, então ficam só as fotos.
   */
  private serieDaCaixinha(id: string, meses: readonly Mes[]): { mes: Mes; valor: number | null }[] {
    const { inst } = this.base();
    const caixinha = inst.caixinhas.find((c) => c.id === id);
    if (caixinha && inst.caixinhas.filter((c) => c.contaId === caixinha.contaId).length === 1) {
      return this.caixinhasDaConta(caixinha.contaId, meses, id);
    }
    return ultimoValorAte(this.repositorio.historico('caixinha').filter((h) => h.refId === id), meses);
  }

  /** Acrescenta uma fonte de alertas; devolve a função que a remove. */
  registrarAlertas(fonte: () => Alerta[]): () => void {
    this.fontesDeAlertas.add(fonte);
    return () => {
      this.fontesDeAlertas.delete(fonte);
    };
  }

  alertas(): Alerta[] {
    const extras = [...this.fontesDeAlertas].flatMap((fonte) => fonte());
    if (!extras.length) return this.alertasDasFinancas();
    const peso = { CRITICO: 0, ATENCAO: 1, INFO: 2 } as const;
    // sort é estável: dentro da mesma gravidade, os extras vêm antes, e as finanças mantêm a ordem delas.
    return [...extras, ...this.alertasDasFinancas()].sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
  }

  private alertasDasFinancas(): Alerta[] {
    const { inst, recorrencias, movimentos, hoje } = this.base();
    const cartoes = this.cartoes();
    return gerarAlertas({
      hoje,
      orcamento: avaliarOrcamento(inst.orcamentos, resumoDoMes(movimentos, mesDe(hoje)), hoje),
      faturas: cartoes.flatMap((c) => c.faturas),
      recorrencias,
      saldoContas: inst.contas.filter((c) => c.tipo !== 'CARTAO').reduce((s, c) => s + c.saldo, 0),
      conexoes: inst.conexoes.map((c) => ({ id: c.id, nome: c.nome, situacao: c.situacao, ultimaSincronizacao: c.ultimaSincronizacao })),
      nomeCategoria: (id) => CATEGORIA_POR_ID.get(id)?.nome ?? id,
      contasAPagar: inst.contasAPagar,
    });
  }

  // ----------------------------------------------------------------- fluxo

  fluxo(mes: Mes) {
    const { movimentos } = this.base();
    const resumo = resumoDoMes(movimentos, mes);
    return { mes, resumo, sankey: montarSankey(resumo), caixa: fluxoDeCaixa(movimentos, mes) };
  }

  // ------------------------------------------------------------ extrato

  movimentos(f: FiltroMovimentos) {
    const { movimentos, inst } = this.base();
    const busca = normalizar(f.busca);
    const buscaDigitos = apenasDigitosEMascara(f.busca).replace(/\*/g, '');
    const por = f.por ?? 'data';
    const filtrados = movimentos.filter((m) => {
      if (f.mes && (por === 'data' ? mesDe(m.data) : m.competencia) !== f.mes) return false;
      if (f.contaId && m.contaId !== f.contaId) return false;
      if (f.categoriaId && m.categoriaId !== f.categoriaId) return false;
      if (f.natureza && m.natureza !== f.natureza) return false;
      if (f.editados && !m.editado) return false;
      if (busca) {
        const alvo = normalizar(`${m.descricao} ${m.estabelecimento ?? ''} ${m.contraparteNome ?? ''} ${m.nota ?? ''}`);
        const valor = String(m.valor);
        if (!alvo.includes(busca) && !(buscaDigitos.length >= 2 && valor.includes(buscaDigitos))) return false;
      }
      return true;
    });
    const ordenados = [...filtrados].sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));
    const tamanho = Math.min(Math.max(f.tamanho ?? 60, 1), 500);
    const pagina = Math.max(f.pagina ?? 1, 1);
    let entradas = 0;
    let saidas = 0;
    for (const m of filtrados) {
      if (m.natureza === 'RECEITA' || m.natureza === 'ESTORNO') entradas += m.valor;
      if (m.natureza === 'DESPESA') saidas += m.valor;
    }
    const nomeConta = new Map(inst.contas.map((c) => [c.id, c.nome]));
    return {
      total: filtrados.length,
      pagina,
      paginas: Math.max(1, Math.ceil(filtrados.length / tamanho)),
      entradas,
      saidas,
      itens: ordenados.slice((pagina - 1) * tamanho, pagina * tamanho).map((m) => ({ ...m, conta: nomeConta.get(m.contaId) ?? '' })),
    };
  }

  movimento(id: string): Movimento | undefined {
    return this.base().movimentos.find((m) => m.id === id);
  }

  /** Todos os movimentos, já classificados, com o nome da conta — para o assistente e a busca. */
  todosOsMovimentos(): (Movimento & { conta: string })[] {
    const { movimentos, inst } = this.base();
    const nomeConta = new Map(inst.contas.map((c) => [c.id, c.nome]));
    return movimentos.map((m) => ({ ...m, conta: nomeConta.get(m.contaId) ?? '' }));
  }

  // ------------------------------------------------------------- cartão

  cartoes(): VisaoCartao[] {
    const { inst, movimentos, hoje } = this.base();
    return inst.contas
      .filter((c) => c.tipo === 'CARTAO')
      .map((c) => visaoDoCartao(c, movimentos, inst.faturas.filter((f) => f.contaId === c.id), hoje));
  }

  /** Faturas que ainda vão ser cobradas (fechadas a pagar e a aberta), com fechamento e vencimento. */
  faturasAPagar(): VencimentoDeCartao[] {
    const { inst, hoje } = this.base();
    const cartoes = inst.contas.filter((c) => c.tipo === 'CARTAO');
    const ciclos = new Map(cartoes.map((c) => [c.id, cicloDoCartao(c, inst.faturas.filter((f) => f.contaId === c.id))]));
    const fechamentos = new Map(
      inst.faturas.filter((f) => f.fechamento).map((f) => [`${f.contaId}|${mesDe(f.vencimento)}`, f.fechamento!]),
    );
    return vencimentosDeCartao(this.cartoes(), ciclos, fechamentos, hoje);
  }

  itensDaFatura(contaId: string, mes: Mes): Movimento[] {
    const { inst, movimentos } = this.base();
    const cartao = inst.contas.find((c) => c.id === contaId && c.tipo === 'CARTAO');
    if (!cartao) return [];
    const faturas = new Map(inst.faturas.filter((f) => f.contaId === contaId).map((f) => [f.id, f]));
    return movimentos
      // Mesma regra do total da fatura: Pix no crédito e parcelamento também são cobrados.
      .filter((m) => m.contaId === contaId && entraNaFatura(m))
      .filter((m) => mesDaFatura(m, cartao, faturas) === mes)
      .sort((a, b) => b.data.localeCompare(a.data));
  }

  // --------------------------------------------------------- caixinhas

  caixinhas() {
    const { inst, hoje } = this.base();
    const meses = intervaloDeMeses(somarMeses(mesDe(hoje), -11), mesDe(hoje));
    const patrimonio = calcularPatrimonio(inst.contas, inst.caixinhas, inst.investimentos, inst.configuracoes);
    return {
      total: patrimonio.caixinhas,
      investimentos: patrimonio.investimentos,
      rendimentoEstimadoMes: inst.caixinhas.reduce(
        (s, c) => s + Math.round(c.valor * CDI_MENSAL_ESTIMADO * (c.percentualIndexador ?? 1)), 0),
      caixinhas: inst.caixinhas.map((c) => ({
        ...c,
        serie: this.serieDaCaixinha(c.id, meses),
        metas: inst.metas.filter((m) => m.caixinhaId === c.id).map((m) => m.id),
      })),
      listaInvestimentos: inst.investimentos.map((i) => ({ ...i, duplicado: patrimonio.duplicados.includes(i.id) })),
    };
  }

  // ----------------------------------------------------------- orçamento

  orcamento(mes: Mes) {
    const { inst, movimentos, hoje } = this.base();
    const resumo = resumoDoMes(movimentos, mes);
    const linhas = avaliarOrcamento(inst.orcamentos, resumo, hoje);
    const media3 = (categoriaId: string) =>
      Math.round([1, 2, 3].reduce((s, n) => {
        const r = resumoDoMes(movimentos, somarMeses(mes, -n));
        return s + (r.porCategoria.find((c) => c.categoriaId === categoriaId)?.valor ?? 0);
      }, 0) / 3);
    const semLimite = resumo.porCategoria
      .filter((c) => !inst.orcamentos.has(c.categoriaId) && c.valor > 0)
      .map((c) => ({ categoriaId: c.categoriaId, gasto: c.valor, sugestao: arredondarSugestao(Math.max(media3(c.categoriaId), c.valor)) }));
    const totalLimite = linhas.reduce((s, l) => s + l.limite, 0);
    const totalGasto = linhas.reduce((s, l) => s + l.gasto, 0);
    return { mes, linhas, semLimite, totalLimite, totalGasto, receitas: resumo.receitas };
  }

  // ---------------------------------------------------------------- metas

  metas() {
    const { inst, hoje } = this.base();
    const meses = intervaloDeMeses(somarMeses(mesDe(hoje), -4), mesDe(hoje));
    return inst.metas.map((meta) => {
      const caixinha = meta.caixinhaId ? inst.caixinhas.find((c) => c.id === meta.caixinhaId) : undefined;
      const serie = meta.caixinhaId
        ? this.serieDaCaixinha(meta.caixinhaId, meses)
            .filter((p): p is { mes: Mes; valor: number } => p.valor !== null)
        : [];
      return { ...meta, caixinhaNome: caixinha?.nome ?? null, progresso: progressoDaMeta(meta, caixinha?.valor ?? null, serie, hoje) };
    });
  }

  // --------------------------------------------------------- recorrências

  recorrencias() {
    const { recorrencias } = this.base();
    const ativas = recorrencias.filter((r) => r.ativa);
    return {
      itens: recorrencias,
      mensal: ativas.reduce((s, r) => s + r.valorTipico, 0),
      anual: ativas.reduce((s, r) => s + r.custoAnual, 0),
    };
  }

  insights(mes: Mes) {
    const { movimentos, hoje } = this.base();
    return gerarInsights(movimentos, mes, hoje);
  }

  categorias() {
    return CATEGORIAS;
  }

  resumo(mes: Mes): ResumoMes {
    return resumoDoMes(this.base().movimentos, mes);
  }
}

/** Sugestão de limite "redonda": arredonda para cima em múltiplos de R$ 50. */
function arredondarSugestao(centavos: number): number {
  return Math.ceil(centavos / 5000) * 5000;
}

/** Quem é o titular, para reconhecer Pix e TED para as próprias contas. */
export function contextoDoTitular(inst: Pick<Instantaneo, 'contas'>): ContextoClassificacao {
  const documentos = new Set<string>();
  const nomes = new Set<string>();
  for (const c of inst.contas) {
    const doc = apenasDigitosEMascara(c.documentoTitular).replace(/\*/g, '');
    if (doc.length === 11 || doc.length === 14) documentos.add(doc);
    const nome = normalizar(c.titular);
    if (nome) nomes.add(nome);
  }
  return { documentosDoTitular: [...documentos], nomesDoTitular: [...nomes] };
}
