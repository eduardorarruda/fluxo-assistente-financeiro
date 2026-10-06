import { faturaDeUmaCompraEm } from '../domain/competencia';
import { diaNoMes, diasNoMes, diferencaEmMeses, hoje as hojeDe, mesDe, somarMeses } from '../domain/datas';
import type { Caixinha, Centavos, Conta, Dia, Fatura, Investimento, Mes, Transacao } from '../domain/types';
import type { DadosDaConexao, ProvedorFinanceiro } from './provedor';

export const ID_CONEXAO_DEMO = 'demo-nubank';
const CONTA = 'demo-conta';
const CARTAO = 'demo-cartao';
const TITULAR = 'Titular Demonstração';
const DOCUMENTO = '111.222.333-44';
const CICLO = { fechamento: '2000-01-08', vencimento: '2000-01-15' }; // só os dias importam

export interface PontoHistorico {
  tipo: 'conta' | 'caixinha' | 'investimento';
  refId: string;
  dia: Dia;
  valor: Centavos;
}

/** Gerador pseudoaleatório com semente: os mesmos dados a cada execução. */
function mulberry32(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Compra {
  descricao: string;
  categoria: string;
  estabelecimento?: string;
  minimo: number;
  maximo: number;
  vezes: [number, number];
}

const COMPRAS_DO_MES: readonly Compra[] = [
  { descricao: 'iFood', categoria: 'Food delivery', estabelecimento: 'iFood', minimo: 29, maximo: 92, vezes: [5, 8] },
  { descricao: 'Uber *Trip', categoria: 'Taxi and ride-hailing', estabelecimento: 'Uber', minimo: 11, maximo: 46, vezes: [7, 12] },
  { descricao: 'Padaria Real', categoria: 'Eating out', minimo: 18, maximo: 64, vezes: [2, 4] },
  { descricao: 'Coco Bambu', categoria: 'Eating out', minimo: 140, maximo: 290, vezes: [0, 1] },
  { descricao: 'Starbucks', categoria: 'Eating out', minimo: 22, maximo: 48, vezes: [1, 3] },
  { descricao: 'Carrefour', categoria: 'Groceries', minimo: 88, maximo: 360, vezes: [1, 2] },
  { descricao: 'Posto Shell Select', categoria: 'Gas stations', minimo: 150, maximo: 260, vezes: [2, 3] },
  { descricao: 'Drogasil', categoria: 'Pharmacy', minimo: 24, maximo: 135, vezes: [1, 2] },
  { descricao: 'Amazon.com.br', categoria: 'Online shopping', minimo: 45, maximo: 320, vezes: [0, 2] },
  { descricao: 'Mercado Livre', categoria: 'Online shopping', minimo: 39, maximo: 280, vezes: [0, 1] },
  { descricao: 'Petz', categoria: 'Pet supplies and vet', minimo: 110, maximo: 240, vezes: [1, 1] },
  { descricao: 'Cinemark', categoria: 'Tickets', minimo: 62, maximo: 118, vezes: [0, 1] },
  { descricao: 'Renner', categoria: 'Clothing', minimo: 119, maximo: 390, vezes: [0, 1] },
  { descricao: 'Barbearia Dom', categoria: 'Beauty', minimo: 55, maximo: 70, vezes: [1, 1] },
];

interface Assinatura {
  descricao: string;
  categoria: string;
  dia: number;
  valor: (mesesAtras: number, aleatorio: () => number) => number | null;
}

const ASSINATURAS: readonly Assinatura[] = [
  { descricao: 'Netflix.com', categoria: 'Video streaming', dia: 12, valor: () => 55.9 },
  // Aumentou de preço há dois meses — o Fluxo precisa perceber.
  { descricao: 'Spotify', categoria: 'Music streaming', dia: 3, valor: (m) => (m <= 1 ? 23.9 : 21.9) },
  { descricao: 'Amazon Prime', categoria: 'Video streaming', dia: 22, valor: () => 19.9 },
  { descricao: 'ChatGPT Subscription', categoria: 'Software', dia: 9, valor: (_m, r) => Math.round((110 + r() * 8) * 100) / 100 },
  { descricao: 'Smart Fit', categoria: 'Gyms and fitness centers', dia: 7, valor: () => 129.9 },
  { descricao: 'Apple.com/bill iCloud', categoria: 'Software', dia: 1, valor: () => 14.9 },
  // Cancelada há quatro meses: aparece como inativa.
  { descricao: 'Disney Plus', categoria: 'Video streaming', dia: 17, valor: (m) => (m >= 5 ? 43.9 : null) },
];

interface Parcelada {
  descricao: string;
  categoria: string;
  parcelas: number;
  valor: number;
  mesesAtras: number;
  dia: number;
}

const PARCELADAS: readonly Parcelada[] = [
  { descricao: 'Apple Store iPhone', categoria: 'Electronics', parcelas: 12, valor: 541.58, mesesAtras: 7, dia: 11 },
  { descricao: 'Magalu Geladeira Brastemp', categoria: 'Houseware', parcelas: 10, valor: 329.9, mesesAtras: 3, dia: 20 },
  { descricao: 'LATAM Airlines', categoria: 'Airport and airlines', parcelas: 6, valor: 412.33, mesesAtras: 1, dia: 2 },
  { descricao: 'Tok&Stok Sofá', categoria: 'Houseware', parcelas: 8, valor: 249.9, mesesAtras: 10, dia: 15 },
  { descricao: 'Alura Assinatura Anual', categoria: 'Education', parcelas: 12, valor: 74.9, mesesAtras: 12, dia: 4 },
  { descricao: 'Nike Store', categoria: 'Clothing', parcelas: 3, valor: 233.3, mesesAtras: 0, dia: 1 },
];

const CAIXINHAS_DEMO = [
  { id: `${CONTA}:reserva`, nome: 'Reserva de emergência', inicial: 14000, aporte: 1000, percentual: 1 },
  { id: `${CONTA}:viagem`, nome: 'Viagem Japão', inicial: 2500, aporte: 400, percentual: 1 },
  { id: `${CONTA}:carro`, nome: 'Carro novo', inicial: 1200, aporte: 200, percentual: 1.02 },
] as const;

const CDI_MENSAL = 0.0084;
const MESES_DE_HISTORICO = 13;

function reais(valor: number): Centavos {
  return Math.round(valor * 100);
}

/**
 * Um Nubank de mentira, mas plausível: salário, contas, cartão com parcelas
 * e assinaturas, caixinhas rendendo e a fatura paga todo dia 15. Tudo é
 * derivado da data de hoje e de uma semente fixa — o gráfico de ontem e o de
 * hoje contam a mesma história.
 *
 * Os formatos são os do modelo interno, exatamente o que o provedor da
 * Pluggy também entrega. O resto do sistema não sabe que é demonstração.
 */
export function gerarDadosDemo(hoje: Dia = hojeDe()): DadosDaConexao & { historico: PontoHistorico[] } {
  const r = mulberry32(20260917);
  const faixa = (a: number, b: number) => a + r() * (b - a);
  const inteiro = (a: number, b: number) => Math.floor(faixa(a, b + 1));
  const mesAtual = mesDe(hoje);
  const inicio = somarMeses(mesAtual, -MESES_DE_HISTORICO);

  const transacoes: Transacao[] = [];
  let seq = 0;
  const nova = (p: Partial<Transacao> & Pick<Transacao, 'contaId' | 'data' | 'descricao' | 'valor' | 'sentido'>): Transacao => {
    const t: Transacao = {
      id: `demo-${(++seq).toString(36)}`,
      tipoConta: p.contaId === CARTAO ? 'CARTAO' : 'CONTA',
      descricaoOriginal: null,
      pendente: false,
      categoriaProvedor: null,
      categoriaProvedorId: null,
      estabelecimento: null,
      cnpjEstabelecimento: null,
      contraparteNome: null,
      contraparteDocumento: null,
      meioPagamento: null,
      parcela: null,
      faturaId: null,
      faturaPrevista: null,
      outroCredito: null,
      ...p,
    };
    transacoes.push(t);
    return t;
  };
  const noMes = (mes: Mes, dia: number) => diaNoMes(mes, dia);
  const jaAconteceu = (dia: Dia) => dia <= hoje;

  // ---- Cartão ------------------------------------------------------------
  for (let mes = inicio; mes <= mesAtual; mes = somarMeses(mes, 1)) {
    const mesesAtras = diferencaEmMeses(mes, mesAtual);
    for (const c of COMPRAS_DO_MES) {
      const vezes = inteiro(c.vezes[0], c.vezes[1]);
      for (let i = 0; i < vezes; i++) {
        const data = noMes(mes, inteiro(1, diasNoMes(mes)));
        if (!jaAconteceu(data)) continue;
        nova({
          contaId: CARTAO, data, descricao: c.descricao, estabelecimento: c.estabelecimento ?? null,
          valor: reais(faixa(c.minimo, c.maximo)), sentido: 'SAIDA', categoriaProvedor: c.categoria,
        });
      }
    }
    for (const a of ASSINATURAS) {
      const valor = a.valor(mesesAtras, r);
      const data = noMes(mes, a.dia);
      if (valor === null || !jaAconteceu(data)) continue;
      nova({ contaId: CARTAO, data, descricao: a.descricao, valor: reais(valor), sentido: 'SAIDA', categoriaProvedor: a.categoria });
      if (a.descricao.startsWith('ChatGPT')) {
        nova({
          contaId: CARTAO, data, descricao: 'IOF de compra internacional', valor: reais(valor * 0.0438),
          sentido: 'SAIDA', categoriaProvedor: 'Tax on financial operations',
        });
      }
    }
    // Um estorno a cada quatro meses.
    if (mesesAtras % 4 === 2) {
      const data = noMes(mes, 21);
      if (jaAconteceu(data)) {
        nova({ contaId: CARTAO, data, descricao: 'Estorno Mercado Livre', valor: reais(faixa(40, 120)), sentido: 'ENTRADA' });
      }
    }
  }

  for (const p of PARCELADAS) {
    const dataCompra = noMes(somarMeses(mesAtual, -p.mesesAtras), p.dia);
    if (!jaAconteceu(dataCompra)) continue;
    for (let n = 1; n <= p.parcelas; n++) {
      const t = nova({
        contaId: CARTAO, data: dataCompra, descricao: p.descricao, valor: reais(p.valor), sentido: 'SAIDA',
        categoriaProvedor: p.categoria,
        parcela: { numero: n, total: p.parcelas, valorTotal: reais(p.valor * p.parcelas), dataCompra },
      });
      // Parcelas de faturas que ainda não fecharam chegam como pendentes, como no Open Finance.
      t.pendente = somarMeses(faturaDeUmaCompraEm(dataCompra, CICLO), n - 1) >= faturaDeUmaCompraEm(hoje, CICLO);
    }
  }

  // Monta as faturas a partir das compras.
  const totalPorFatura = new Map<Mes, number>();
  for (const t of transacoes) {
    if (t.contaId !== CARTAO) continue;
    const desloca = t.parcela && t.parcela.dataCompra === t.data ? t.parcela.numero - 1 : 0;
    const mes = somarMeses(faturaDeUmaCompraEm(t.data, CICLO), desloca);
    const sinal = t.sentido === 'SAIDA' ? 1 : -1;
    totalPorFatura.set(mes, (totalPorFatura.get(mes) ?? 0) + sinal * t.valor);
  }
  const faturaAberta = faturaDeUmaCompraEm(hoje, CICLO);
  const faturas: Fatura[] = [];
  for (const [mes, total] of [...totalPorFatura.entries()].sort()) {
    if (mes >= faturaAberta) continue;
    const vencimento = noMes(mes, 15);
    const paga = jaAconteceu(vencimento);
    faturas.push({
      id: `demo-fatura-${mes}`, contaId: CARTAO, vencimento, fechamento: noMes(mes, 8), total,
      pagamentoMinimo: Math.round(total * 0.15), pago: paga ? total : 0,
    });
    if (paga) {
      nova({ contaId: CARTAO, data: vencimento, descricao: 'Pagamento recebido', valor: total, sentido: 'ENTRADA', faturaId: `demo-fatura-${mes}` });
    }
  }

  // ---- Conta ---------------------------------------------------------------
  const caixinhas = CAIXINHAS_DEMO.map((c) => ({ ...c, valor: reais(c.inicial) }));
  const historico: PontoHistorico[] = [];
  const faturasPorVencimento = new Map(faturas.map((f) => [mesDe(f.vencimento), f]));

  for (let mes = inicio; mes <= mesAtual; mes = somarMeses(mes, 1)) {
    const mesesAtras = diferencaEmMeses(mes, mesAtual);
    const em = (dia: number) => noMes(mes, dia);
    const entra = (dia: number, descricao: string, valor: number, extra: Partial<Transacao> = {}) =>
      jaAconteceu(em(dia)) && nova({ contaId: CONTA, data: em(dia), descricao, valor: reais(valor), sentido: 'ENTRADA', ...extra });
    const sai = (dia: number, descricao: string, valor: number, extra: Partial<Transacao> = {}) =>
      jaAconteceu(em(dia)) && nova({ contaId: CONTA, data: em(dia), descricao, valor: reais(valor), sentido: 'SAIDA', ...extra });

    entra(1, 'Rendimento da conta', faixa(4, 14), { categoriaProvedor: 'Proceeds interests and dividends' });
    entra(5, 'Salário Acme Tecnologia', mesesAtras <= 6 ? 10500 : 9800, { categoriaProvedor: 'Salary', meioPagamento: 'TED', contraparteNome: 'Acme Tecnologia' });
    if (r() < 0.45) {
      entra(18, 'Pix recebido Studio Aurora', faixa(900, 2800), { categoriaProvedor: 'Transfer - PIX', meioPagamento: 'PIX', contraparteNome: 'Studio Aurora LTDA' });
    }
    for (const c of caixinhas) {
      if (sai(6, `Dinheiro guardado ${c.nome}`, c.aporte, { categoriaProvedor: 'Automatic investment' })) c.valor += reais(c.aporte);
    }
    if (mesesAtras % 5 === 3 && entra(19, 'Dinheiro resgatado Viagem Japão', 900, { categoriaProvedor: 'Automatic investment' })) {
      caixinhas[1]!.valor -= reais(900);
    }
    sai(10, 'Pagamento de boleto Lar Imóveis Aluguel', 2350, { categoriaProvedor: 'Rent', meioPagamento: 'BOLETO' });
    sai(10, 'Pagamento de boleto Condomínio Ed. Aurora', 520, { categoriaProvedor: 'Housing', meioPagamento: 'BOLETO' });
    sai(12, 'Enel Distribuição SP', faixa(160, 290), { categoriaProvedor: 'Electricity' });
    sai(14, 'Vivo Fibra', 119.9, { categoriaProvedor: 'Internet' });
    sai(20, 'Sabesp', faixa(82, 128), { categoriaProvedor: 'Water' });
    for (const dia of [3, 13, 24]) sai(dia, 'Compra no débito Supermercado Pão de Açúcar', faixa(160, 470), { categoriaProvedor: 'Groceries' });
    for (let i = 0, n = inteiro(1, 3); i < n; i++) {
      const nome = ['Maria Clara Souza', 'João Pedro Lima', 'Ana Beatriz Rocha'][inteiro(0, 2)]!;
      sai(inteiro(2, 27), `Transferência enviada pelo Pix ${nome}`, faixa(25, 240), {
        categoriaProvedor: 'Transfer - PIX', meioPagamento: 'PIX', contraparteNome: nome, contraparteDocumento: '***.987.654-**',
      });
    }
    if (mesesAtras % 3 === 1) {
      // Ida e volta para outra conta sua: neutra. (Só o que vem de uma conta fora do Fluxo, sem volta, conta.)
      sai(25, `Transferência enviada pelo Pix ${TITULAR}`, 500, {
        meioPagamento: 'PIX', contraparteNome: TITULAR, contraparteDocumento: '***.222.333-**',
      });
      entra(27, `Transferência recebida pelo Pix ${TITULAR}`, 500, {
        meioPagamento: 'PIX', contraparteNome: TITULAR, contraparteDocumento: '***.222.333-**',
      });
    }
    const fatura = faturasPorVencimento.get(mes);
    if (fatura && fatura.pago > 0) {
      nova({ contaId: CONTA, data: fatura.vencimento, descricao: 'Pagamento de fatura', valor: fatura.total, sentido: 'SAIDA', categoriaProvedor: 'Credit card payment' });
    }

    // Rendimento das caixinhas no fim do mês e foto dos saldos.
    const fimDoMes = mes === mesAtual ? hoje : noMes(mes, diasNoMes(mes));
    for (const c of caixinhas) {
      if (mes !== mesAtual) c.valor += Math.round(c.valor * CDI_MENSAL * c.percentual);
      historico.push({ tipo: 'caixinha', refId: c.id, dia: fimDoMes, valor: c.valor });
    }
  }

  // Saldo da conta: parte de um saldo inicial e aplica cada movimento em ordem.
  let saldo = reais(6800);
  const daConta = transacoes.filter((t) => t.contaId === CONTA).sort((a, b) => a.data.localeCompare(b.data));
  const saldoNoFimDoMes = new Map<Mes, Centavos>();
  for (const t of daConta) {
    saldo += t.sentido === 'ENTRADA' ? t.valor : -t.valor;
    saldoNoFimDoMes.set(mesDe(t.data), saldo);
  }
  for (const [mes, valor] of saldoNoFimDoMes) {
    historico.push({ tipo: 'conta', refId: CONTA, dia: mes === mesAtual ? hoje : noMes(mes, diasNoMes(mes)), valor });
  }

  const aPagar = (m: Mes) => {
    const f = faturas.find((x) => mesDe(x.vencimento) === m);
    return f ? f.total - f.pago : (totalPorFatura.get(m) ?? 0);
  };
  const faturaAtualTotal = [...totalPorFatura.keys()].filter((m) => m <= faturaAberta).reduce((s, m) => s + Math.max(0, aPagar(m)), 0);
  const limiteUsado = [...totalPorFatura.keys()].reduce((s, m) => s + Math.max(0, aPagar(m)), 0);
  const limite = reais(15000);

  const contas: Conta[] = [
    {
      id: CONTA, conexaoId: ID_CONEXAO_DEMO, tipo: 'CONTA', nome: 'NuConta', numero: '0001 9876543-2', instituicao: 'Nubank',
      saldo, titular: TITULAR, documentoTitular: DOCUMENTO, limite: null, limiteDisponivel: null, fechamento: null, vencimento: null,
    },
    {
      id: CARTAO, conexaoId: ID_CONEXAO_DEMO, tipo: 'CARTAO', nome: 'Nubank Ultravioleta', numero: '•••• 4821', instituicao: 'Nubank',
      saldo: faturaAtualTotal, titular: TITULAR, documentoTitular: DOCUMENTO, limite, limiteDisponivel: limite - limiteUsado,
      fechamento: noMes(faturaAberta, 8), vencimento: noMes(faturaAberta, 15),
    },
  ];

  const caixinhasFinais: Caixinha[] = caixinhas.map((c) => ({
    id: c.id, contaId: CONTA, nome: c.nome, valor: c.valor, indexador: 'CDI', percentualIndexador: c.percentual,
  }));

  const investimentos: Investimento[] = [
    {
      id: 'demo-tesouro', conexaoId: ID_CONEXAO_DEMO, nome: 'Tesouro Selic 2029', tipo: 'FIXED_INCOME', subtipo: 'TREASURY',
      saldo: reais(5412.37), valorAplicado: reais(5000), rendimento: reais(412.37), vencimento: '2029-03-01', taxa: 100, indexador: 'SELIC',
    },
  ];
  historico.push({ tipo: 'investimento', refId: 'demo-tesouro', dia: hoje, valor: reais(5412.37) });

  const janela = noMes(inicio, 1);
  return {
    conexao: {
      id: ID_CONEXAO_DEMO, nome: 'Nubank (demonstração)', conectorId: null, logoUrl: null, cor: '#820AD1',
      situacao: 'UPDATED', erro: null, atualizadaNoBanco: `${hoje}T12:00:00.000Z`, consentimentoExpira: null,
    },
    contas,
    caixinhas: caixinhasFinais,
    investimentos,
    transacoes: transacoes.filter((t) => t.valor > 0),
    faturas,
    janelas: { [CONTA]: janela, [CARTAO]: janela },
    historico,
  };
}

export class ProvedorDemo implements ProvedorFinanceiro {
  readonly nome = 'demo' as const;

  constructor(private readonly relogio: () => Dia = hojeDe) {}

  async buscar(): Promise<DadosDaConexao & { historico: PontoHistorico[] }> {
    return gerarDadosDemo(this.relogio());
  }
}
