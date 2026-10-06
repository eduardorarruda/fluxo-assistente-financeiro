import { PREFERENCIAS_PADRAO } from './cofre-google';
import {
  CORES, eventosDesejados, hashDoCorpo, itensDasContas, itensDosCartoes, janelaDe, lembretes, minutosAntes, proximoAviso, reais,
  type CartaoDaAgenda, type CorpoDoEvento, type ItemDaAgenda,
} from './eventos';

const HOJE = '2026-10-02';
const AGORA = new Date('2026-10-02T15:00:00'); // hora local: depois das 9h, o próximo aviso é amanhã
const JANELA = janelaDe(HOJE);

const nubank = (p: Partial<CartaoDaAgenda> = {}): CartaoDaAgenda => ({
  conta: { id: 'cartao-1', nome: 'Nubank Ultravioleta', instituicao: 'Nubank', fechamento: '2026-10-03', vencimento: '2026-10-10' },
  faturas: [],
  faturasDoBanco: [],
  ...p,
});

const porChave = (itens: ItemDaAgenda[]) => new Map(itens.map((i) => [i.chave, i]));
const evento = (eventos: ReturnType<typeof eventosDesejados>, chave: string): CorpoDoEvento => {
  const e = eventos.find((x) => x.chave === chave);
  if (!e) throw new Error(`sem evento ${chave}: ${eventos.map((x) => x.chave).join(', ')}`);
  return e.corpo;
};

describe('minutos dos lembretes (evento de dia inteiro começa à meia-noite)', () => {
  it('N dias antes às H horas = N×1440 − H×60', () => {
    expect(minutosAntes(1, 9)).toBe(900); // véspera, 9h = 15 h antes
    expect(minutosAntes(2, 9)).toBe(2340);
    expect(minutosAntes(7, 21)).toBe(8820);
    expect(minutosAntes(1, 21)).toBe(180);
  });

  it('padrão: 2 dias antes e na véspera às 9h, em popup, do mais cedo para o mais tarde', () => {
    expect(lembretes(PREFERENCIAS_PADRAO)).toEqual([{ method: 'popup', minutes: 2340 }, { method: 'popup', minutes: 900 }]);
    expect(lembretes({ hora: 8, antecedencias: [1, 1, 3] })).toEqual([{ method: 'popup', minutes: 3840 }, { method: 'popup', minutes: 960 }]);
    expect(lembretes({ hora: 9, antecedencias: [] })).toEqual([]);
  });

  it('o próximo aviso de atraso é hoje se ainda não deu a hora; senão amanhã', () => {
    expect(proximoAviso(new Date('2026-10-02T08:59:00'), 9)).toEqual({ dia: '2026-10-02', inicio: '2026-10-02T09:00:00', fim: '2026-10-02T09:30:00' });
    expect(proximoAviso(new Date('2026-10-02T09:00:00'), 9).dia).toBe('2026-10-03');
    expect(proximoAviso(new Date('2026-12-31T23:00:00'), 7).inicio).toBe('2027-01-01T07:00:00');
  });

  it('reais com espaço comum', () => {
    expect(reais(15000)).toBe('R$ 150,00');
    expect(reais(123456)).toBe('R$ 1.234,56');
  });
});

describe('itensDosCartoes', () => {
  it('janela de 30 dias para trás e 120 para frente', () => {
    expect(JANELA).toEqual({ de: '2026-09-02', ate: '2027-01-30' });
  });

  it('fatura fechada a vencer: título com o valor que falta pagar; fechamento pelo banco quando há', () => {
    const itens = porChave(itensDosCartoes([nubank({
      faturas: [{ mes: '2026-10', vencimento: '2026-10-10', total: 123456, pago: 0, situacao: 'FECHADA' }],
      faturasDoBanco: [{ vencimento: '2026-10-10', fechamento: '2026-10-02' }],
    })], HOJE, JANELA));
    expect(itens.get('cartao:cartao-1:2026-10:fecha')).toEqual({
      tipo: 'fechamento', chave: 'cartao:cartao-1:2026-10:fecha', data: '2026-10-02', cartao: 'Cartão Nubank', vencimentoDaFatura: '2026-10-10',
    });
    expect(itens.get('cartao:cartao-1:2026-10:vence')).toMatchObject({ data: '2026-10-10', situacao: 'aberta', valor: 123456, parcial: null });
  });

  it('meses sem fatura entram pelas datas do ciclo (fecha 3, vence 10), até o fim da janela', () => {
    const itens = itensDosCartoes([nubank()], HOJE, JANELA);
    const vencimentos = itens.filter((i) => i.tipo === 'fatura').map((i) => i.data);
    const fechamentos = itens.filter((i) => i.tipo === 'fechamento').map((i) => i.data);
    expect(vencimentos).toEqual(['2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10']);
    expect(fechamentos).toEqual(['2026-09-03', '2026-10-03', '2026-11-03', '2026-12-03', '2027-01-03']);
  });

  it('ciclo que atravessa o mês (fecha 28, vence 5): o fechamento é no mês anterior ao vencimento', () => {
    const c = nubank({ conta: { ...nubank().conta, fechamento: '2026-09-28', vencimento: '2026-10-05' } });
    const itens = porChave(itensDosCartoes([c], HOJE, JANELA));
    expect(itens.get('cartao:cartao-1:2026-11:fecha')?.data).toBe('2026-10-28');
    expect(itens.get('cartao:cartao-1:2026-11:vence')?.data).toBe('2026-11-05');
  });

  it('paga, atrasada (vencida com saldo), aberta (sem valor, com parcial) e nada sem ciclo conhecido', () => {
    const itens = porChave(itensDosCartoes([nubank({
      faturas: [
        { mes: '2026-09', vencimento: '2026-09-10', total: 50000, pago: 50000, situacao: 'PAGA' },
        { mes: '2026-10', vencimento: '2026-10-01', total: 80000, pago: 30000, situacao: 'FECHADA' },
        { mes: '2026-11', vencimento: '2026-11-10', total: 4200, pago: 0, situacao: 'ABERTA' },
      ],
    })], HOJE, JANELA));
    expect(itens.get('cartao:cartao-1:2026-09:vence')).toMatchObject({ situacao: 'paga', valor: 50000 });
    expect(itens.get('cartao:cartao-1:2026-10:vence')).toMatchObject({ situacao: 'atrasada', valor: 50000, data: '2026-10-01' });
    expect(itens.get('cartao:cartao-1:2026-11:vence')).toMatchObject({ situacao: 'aberta', valor: null, parcial: 4200 });
    const semCiclo = nubank({ conta: { ...nubank().conta, fechamento: null, vencimento: null } });
    expect(itensDosCartoes([semCiclo], HOJE, JANELA)).toEqual([]);
  });

  it('dois cartões do mesmo banco usam o nome de cada um', () => {
    const outro = nubank({ conta: { ...nubank().conta, id: 'cartao-2', nome: 'Nubank Virtual' } });
    const nomes = new Set(itensDosCartoes([nubank(), outro], HOJE, JANELA).map((i) => (i.tipo === 'conta' ? '' : i.cartao)));
    expect([...nomes].sort()).toEqual(['Nubank Ultravioleta', 'Nubank Virtual']);
  });
});

describe('itensDasContas', () => {
  it('chave por conta e vencimento; repetidas (na janela e atrasada) entram uma vez; descrição limpa', () => {
    const conta = { id: 'c1', descricao: '  Energia ', valor: 15000, vencimento: '2026-09-28', situacao: 'atrasada' as const, pagaEm: null };
    const itens = itensDasContas([conta, conta, { ...conta, id: 'c2', descricao: ' ', vencimento: '2026-10-20', situacao: 'paga', pagaEm: '2026-10-01T10:00:00.000Z' }]);
    expect(itens).toEqual([
      { tipo: 'conta', chave: 'conta:c1:2026-09-28', data: '2026-09-28', descricao: 'Energia', valor: 15000, situacao: 'atrasada', pagaEm: null },
      { tipo: 'conta', chave: 'conta:c2:2026-10-20', data: '2026-10-20', descricao: 'Conta', valor: 15000, situacao: 'paga', pagaEm: '2026-10-01' },
    ]);
  });
});

describe('eventosDesejados', () => {
  const contas = itensDasContas([
    { id: 'luz', descricao: 'Energia', valor: 15000, vencimento: '2026-10-15', situacao: 'aberta', pagaEm: null },
    { id: 'agua', descricao: 'Água', valor: 8990, vencimento: '2026-10-05', situacao: 'paga', pagaEm: '2026-10-01' },
    { id: 'net', descricao: 'Internet', valor: 9990, vencimento: '2026-09-25', situacao: 'atrasada', pagaEm: null },
    { id: 'velha', descricao: 'IPTU', valor: 30000, vencimento: '2026-08-01', situacao: 'atrasada', pagaEm: null },
  ]);
  const cartao = itensDosCartoes([nubank({
    faturas: [
      { mes: '2026-09', vencimento: '2026-09-10', total: 50000, pago: 50000, situacao: 'PAGA' },
      { mes: '2026-10', vencimento: '2026-10-01', total: 80000, pago: 0, situacao: 'FECHADA' },
    ],
  })], HOJE, JANELA);
  const todos = eventosDesejados([...contas, ...cartao], PREFERENCIAS_PADRAO, JANELA, AGORA);

  it('conta aberta: dia inteiro, "Pagar: …", cor pavão, lembretes padrão, transparente, marcada como do Fluxo', () => {
    expect(evento(todos, 'conta:luz:2026-10-15')).toEqual({
      summary: 'Pagar: Energia · R$ 150,00',
      description: expect.stringContaining('Vence em 15/10.'),
      start: { date: '2026-10-15' },
      end: { date: '2026-10-16' },
      colorId: CORES.conta,
      status: 'confirmed',
      transparency: 'transparent',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 2340 }, { method: 'popup', minutes: 900 }] },
      extendedProperties: { private: { fluxo: '1', fluxoChave: 'conta:luz:2026-10-15' } },
    });
  });

  it('paga: "✓ Paga: …", grafite, sem lembretes, com a data do pagamento', () => {
    const e = evento(todos, 'conta:agua:2026-10-05');
    expect(e.summary).toBe('✓ Paga: Água · R$ 89,90');
    expect(e.colorId).toBe(CORES.paga);
    expect(e.reminders.overrides).toEqual([]);
    expect(e.description).toContain('Paga em 01/10.');
  });

  it('atrasada: o evento do vencimento fica vermelho e nasce um alerta com hora e aviso na hora', () => {
    const base = evento(todos, 'conta:net:2026-09-25');
    expect(base.summary).toBe('⚠ Atrasada: Internet · R$ 99,90');
    expect(base.colorId).toBe(CORES.atrasada);
    expect(base.reminders.overrides).toEqual([]);
    const alerta = evento(todos, 'atraso:conta:net:2026-09-25');
    expect(alerta).toMatchObject({
      summary: '⚠ Em atraso: Internet · R$ 99,90 (venceu 25/09)',
      start: { dateTime: '2026-10-03T09:00:00', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-10-03T09:30:00', timeZone: 'America/Sao_Paulo' },
      colorId: '11',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    });
  });

  it('atrasada de antes da janela: só o alerta (o vencimento velho não volta para a agenda)', () => {
    expect(todos.some((e) => e.chave === 'conta:velha:2026-08-01')).toBe(false);
    expect(evento(todos, 'atraso:conta:velha:2026-08-01').summary).toBe('⚠ Em atraso: IPTU · R$ 300,00 (venceu 01/08)');
  });

  it('cartão: fechamento (uva), vencimento com valor (mirtilo), paga e atrasada com alerta', () => {
    expect(evento(todos, 'cartao:cartao-1:2026-10:fecha')).toMatchObject({ summary: 'Cartão Nubank: fecha a fatura', colorId: CORES.fechamento, start: { date: '2026-10-03' } });
    expect(evento(todos, 'cartao:cartao-1:2026-11:vence')).toMatchObject({ summary: 'Cartão Nubank: vence a fatura', colorId: CORES.fatura });
    expect(evento(todos, 'cartao:cartao-1:2026-11:vence').description).toContain('ainda não fechou');
    expect(evento(todos, 'cartao:cartao-1:2026-09:vence').summary).toBe('✓ Paga: fatura do Cartão Nubank · R$ 500,00');
    expect(evento(todos, 'cartao:cartao-1:2026-10:vence').summary).toBe('⚠ Atrasada: fatura do Cartão Nubank · R$ 800,00');
    expect(evento(todos, 'atraso:cartao:cartao-1:2026-10:vence').summary).toBe('⚠ Em atraso: fatura do Cartão Nubank · R$ 800,00 (venceu 01/10)');
  });

  it('respeita as preferências: sem cartão, sem contas, sem alertas; hora muda lembretes e alerta', () => {
    const p = { ...PREFERENCIAS_PADRAO, cartao: false, atrasos: false, hora: 7, antecedencias: [1] };
    const so = eventosDesejados([...contas, ...cartao], p, JANELA, AGORA);
    expect(so.every((e) => e.chave.startsWith('conta:'))).toBe(true);
    expect(evento(so, 'conta:luz:2026-10-15').reminders.overrides).toEqual([{ method: 'popup', minutes: 1020 }]);
    expect(eventosDesejados([...contas, ...cartao], { ...PREFERENCIAS_PADRAO, contas: false }, JANELA, AGORA).some((e) => e.chave.includes('conta:'))).toBe(false);
  });

  it('ordem estável pela chave e hash muda só quando o conteúdo muda', () => {
    expect(todos.map((e) => e.chave)).toEqual([...todos.map((e) => e.chave)].sort());
    const de_novo = eventosDesejados([...cartao].reverse().concat(contas), PREFERENCIAS_PADRAO, JANELA, AGORA);
    expect(de_novo.map((e) => e.hash)).toEqual(todos.map((e) => e.hash));
    const corpo = evento(todos, 'conta:luz:2026-10-15');
    expect(hashDoCorpo({ ...corpo, summary: 'outro' })).not.toBe(hashDoCorpo(corpo));
  });
});
