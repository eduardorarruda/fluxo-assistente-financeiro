import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderizar } from '../testes/ambiente';
import cartoes from '../testes/fixtures/cartoes.json';
import estado from '../testes/fixtures/estado.json';
import { Cartao } from './Cartao';

const [cartao] = cartoes;
const comQuitacao = (quitacoes: Record<string, string>) => [{
  ...cartao,
  faturas: cartao!.faturas.map((f) => (quitacoes[f.mes] ? { ...f, quitacao: quitacoes[f.mes] } : f)),
}];

describe('Cartao · faturas quitadas sem pagamento integral', () => {
  it('fatura coberta por parcelamento aparece como parcelada; a que rolou, como levada para a seguinte', async () => {
    const usuario = userEvent.setup();
    renderizar(<Cartao />, {
      '/api/estado': estado,
      '/api/cartoes/': [],
      '/api/cartoes': comQuitacao({ '2025-12': 'PARCELAMENTO', '2026-01': 'PROXIMA_FATURA', '2026-02': 'PAGAMENTO' }),
    });
    const dezembro = await screen.findByRole('button', { name: /dez\/25/ });
    expect(dezembro).toHaveTextContent('Parcelada');
    expect(screen.getByRole('button', { name: /jan\/26/ })).toHaveTextContent('Na seguinte');
    expect(screen.getByRole('button', { name: /fev\/26/ })).toHaveTextContent('Paga');

    await usuario.click(dezembro);
    expect(await screen.findByText(/o que faltou virou parcelamento da fatura/i)).toBeInTheDocument();
  });
});

describe('Cartao · cartão sem faturas', () => {
  it('cartão recém-conectado, sem nenhuma fatura, mostra um aviso em vez de quebrar', async () => {
    renderizar(<Cartao />, {
      '/api/estado': estado,
      '/api/cartoes/': [],
      '/api/cartoes': [{ ...cartao, faturas: [], parcelamentos: [], compromissoFuturo: 0 }],
    });
    expect(await screen.findByText(/nenhuma fatura ainda/i)).toBeInTheDocument();
  });
});
