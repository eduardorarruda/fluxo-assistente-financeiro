import { montarMovimentos } from './movimentos';
import { detectarRecorrencias } from './recorrencias';
import { cartao, transacao } from './testing/fabrica';
import type { Transacao } from './types';

const ctx = { documentosDoTitular: [], nomesDoTitular: [] };
const mov = (ts: Transacao[]) => montarMovimentos(ts, ctx, [], new Map());

function mensal(descricao: string, valores: number[], dia = 12, inicio = 3) {
  return valores.map((valor, i) =>
    cartao({ id: `${descricao}-${i}`, descricao, valor, data: `2026-${String(inicio + i).padStart(2, '0')}-${dia}` }));
}

describe('detectarRecorrencias', () => {
  it('acha uma assinatura mensal e projeta a próxima cobrança', () => {
    const [r] = detectarRecorrencias(mov(mensal('NETFLIX.COM', [5590, 5590, 5590, 5590])), '2026-07-20');
    expect(r).toMatchObject({ nome: 'NETFLIX.COM', valorTipico: 5590, meses: 4, custoAnual: 67080, ativa: true, aumento: null });
    expect(r?.proximaData).toBe('2026-07-12');
    expect(r?.categoriaId).toBe('assinaturas');
  });

  it('agrupa descrições que só mudam no código ("Uber *Trip ABC", "Uber *Trip XYZ")', () => {
    const ts = [3, 4, 5].map((m, i) => cartao({ id: `u${i}`, descricao: `Spotify *P${i}X${m}`, valor: 2190, data: `2026-0${m}-01` }));
    expect(detectarRecorrencias(mov(ts), '2026-06-01')).toHaveLength(1);
  });

  it('avisa de aumento de preço', () => {
    const [r] = detectarRecorrencias(mov(mensal('Spotify', [2190, 2190, 2190, 2390])), '2026-07-01');
    expect(r?.aumento).toEqual({ de: 2190, para: 2390 });
  });

  it('não confunde gasto frequente de valor variado com assinatura', () => {
    expect(detectarRecorrencias(mov(mensal('Posto Shell', [5000, 21000, 9000, 15000])), '2026-07-20')).toEqual([]);
  });

  it('compra frequente não é assinatura, mesmo com valor parecido todo mês', () => {
    const mercado = [3, 4, 5, 6].flatMap((m) => [5, 18].map((dia) =>
      cartao({ id: `m${m}-${dia}`, descricao: 'Supermercado', valor: 30000, data: `2026-0${m}-${dia}` })));
    expect(detectarRecorrencias(mov(mercado), '2026-07-01')).toEqual([]);
  });

  it('uma cobrança avulsa extra num mês não esconde a assinatura', () => {
    const ts = [...mensal('Smart Fit', [12990, 12990, 12990, 12990]), cartao({ id: 'extra', descricao: 'Smart Fit', valor: 5000, data: '2026-04-20' })];
    expect(detectarRecorrencias(mov(ts), '2026-07-01')[0]?.valorTipico).toBe(12990);
  });

  it('ignora parcelas e o que apareceu menos de 3 meses', () => {
    const parcelas = [3, 4, 5].map((m, i) => cartao({
      id: `p${i}`, descricao: 'Loja', valor: 10000, data: `2026-0${m}-10`,
      parcela: { numero: i + 1, total: 3, valorTotal: 30000, dataCompra: '2026-03-10' },
    }));
    expect(detectarRecorrencias(mov([...parcelas, ...mensal('Academia', [9900, 9900], 5)]), '2026-07-20')).toEqual([]);
  });

  it('compra pendente do cartão é cobrança real: mantém a assinatura ativa e move a próxima data', () => {
    const ts = [...mensal('Streaming', [2390, 2390, 2390], 10, 5), cartao({ id: 'aberta', descricao: 'Streaming', valor: 2390, data: '2026-08-10', pendente: true })];
    const [r] = detectarRecorrencias(mov(ts), '2026-09-05');
    expect(r).toMatchObject({ ativa: true, ultimaData: '2026-08-10', proximaData: '2026-09-10', meses: 4 });
  });

  it('pendente que ainda convive com a versão efetivada não conta duas vezes', () => {
    const ts = [...mensal('Streaming', [2390, 2390, 2390], 10, 5), cartao({ id: 'dup', descricao: 'Streaming', valor: 2390, data: '2026-07-09', pendente: true })];
    expect(detectarRecorrencias(mov(ts), '2026-07-20')[0]).toMatchObject({ meses: 3, ativa: true });
  });

  it('pendente da conta (agendado) continua de fora', () => {
    const ts = [3, 4, 5].map((m, i) => transacao({ id: `c${i}`, descricao: 'Aluguel Casa', valor: 150000, data: `2026-0${m}-05`, pendente: true }));
    expect(detectarRecorrencias(mov(ts), '2026-06-01')).toEqual([]);
  });

  it('intermediário de pagamento (Google) agrupa pela descrição, não pelo estabelecimento', () => {
    const google = { estabelecimento: 'GOOGLE BRASIL INTERNET LTDA.' };
    const ts = [
      ...[3, 4, 5, 6].map((m) => cartao({ id: `cr${m}`, ...google, descricao: 'Google Crunchyroll An', valor: 2490, data: `2026-0${m}-20` })),
      cartao({ id: 'pa', ...google, descricao: 'Google Paramount', valor: 3490, data: '2026-06-06' }),
      cartao({ id: 'o1', ...google, descricao: 'Google One', valor: 9699, data: '2026-06-14' }),
      cartao({ id: 'o2', ...google, descricao: 'Google One', valor: 9699, data: '2026-07-13' }),
    ];
    const rs = detectarRecorrencias(mov(ts), '2026-07-20');
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ nome: 'Google Crunchyroll An', valorTipico: 2490, ultimoValor: 2490, aumento: null });
  });

  it('prefixo de subadquirente ("Dm*", "Ebn *") não vira a chave: agrupa pelo que vem depois', () => {
    const ts = ['Dm*Spotify', 'Dm *Spotify', 'Ebn*Spotify'].map((descricao, i) =>
      cartao({ id: `s${i}`, descricao, valor: 2390, data: `2026-0${i + 4}-10` }));
    const rs = detectarRecorrencias(mov(ts), '2026-06-20');
    expect(rs).toHaveLength(1);
    expect(rs[0]?.chave).toBe('spotify');
  });

  it('estabelecimento de verdade continua sendo a chave', () => {
    const ts = ['Dm*Spotify', 'Ebn*Spotify', 'Dm *Spotify'].map((descricao, i) =>
      cartao({ id: `s${i}`, descricao, estabelecimento: 'SPOTIFY BRASIL SERVICOS DE MUSICA LTDA.', valor: 2390, data: `2026-0${i + 4}-10` }));
    expect(detectarRecorrencias(mov(ts), '2026-06-20')[0]?.nome).toBe('SPOTIFY BRASIL SERVICOS DE MUSICA LTDA.');
  });

  it('marca como inativa a que parou de cobrar há mais de 45 dias', () => {
    const [r] = detectarRecorrencias(mov(mensal('Disney Plus', [3390, 3390, 3390], 1, 1)), '2026-06-01');
    expect(r?.ativa).toBe(false);
  });
});
