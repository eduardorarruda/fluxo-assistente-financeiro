import { screen, waitFor } from '@testing-library/react';
import { renderizar } from '../testes/ambiente';
import estado from '../testes/fixtures/estado.json';
import visaoGeral from '../testes/fixtures/visao-geral.json';
import { reais } from '../util/formato';
import { VisaoGeral } from './VisaoGeral';

// Hoje (estado.json): 2026-09-24.
// toHaveTextContent troca qualquer espaço (inclusive o não separável do R$) por um espaço comum.
const texto = (centavos: number) => reais(centavos).replace(/\s/g, ' ');
const cartao = visaoGeral.cartoes[0]!;
const fechada = (vencimento: string) => ({
  ...cartao.faturaAberta, mes: vencimento.slice(0, 7), vencimento, total: 400000, pago: 100000, situacao: 'FECHADA',
});
const com = (faturaFechada: unknown) => ({
  '/api/estado': estado,
  '/api/visao-geral': { ...visaoGeral, cartoes: [{ ...cartao, faturaFechada }] },
});

describe('VisaoGeral · cartão', () => {
  it('no patrimônio, o cartão aparece como a dívida inteira, com a fatura aberta e as parcelas futuras', async () => {
    renderizar(<VisaoGeral />, com(null));
    expect(await screen.findByText('Dívida no cartão')).toBeInTheDocument();
    expect(screen.queryByText('Fatura aberta')).not.toBeInTheDocument();
    const detalhe = screen.getByText(/parcelas futuras/);
    expect(detalhe).toHaveTextContent(`fatura aberta ${texto(cartao.faturaAberta.total)}`);
    expect(detalhe).toHaveTextContent(`parcelas futuras ${texto(cartao.compromissoFuturo)}`);
  });

  it('avisa da fatura fechada que ainda falta pagar', async () => {
    renderizar(<VisaoGeral />, com(fechada('2026-09-11')));
    expect(await screen.findByText(/Fatura de set fechada/)).toHaveTextContent(`${texto(300000)} a pagar`);
  });

  it('não avisa de fatura que venceu há mais de 30 dias', async () => {
    renderizar(<VisaoGeral />, com(fechada('2026-08-11')));
    await screen.findByText('Dívida no cartão');
    await waitFor(() => expect(screen.queryByText(/fechada:/)).not.toBeInTheDocument());
  });
});
