import { screen, waitFor } from '@testing-library/react';
import { movimento, renderizar } from '../../testes/ambiente';
import { LinhaMovimento } from './LinhaMovimento';

describe('LinhaMovimento', () => {
  it('gasto: sinal de menos, categoria e selos de parcela e pendente', async () => {
    renderizar(<LinhaMovimento m={movimento({ parcela: { numero: 3, total: 10, valorTotal: 40230, dataCompra: null }, pendente: true })} />);
    expect(screen.getByText('Padaria Real')).toBeInTheDocument();
    expect(screen.getByText(/−\sR\$\s40,23/)).toBeInTheDocument();
    expect(screen.getByText('3/10')).toBeInTheDocument();
    expect(screen.getByText('pendente')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Restaurantes/)).toBeInTheDocument());
  });

  it('receita aparece com sinal de mais e em verde', () => {
    renderizar(<LinhaMovimento m={movimento({ natureza: 'RECEITA', sentido: 'ENTRADA', categoriaId: 'salario', descricao: 'Salário' })} />);
    const valor = screen.getByText(/\+\sR\$\s40,23/);
    expect(valor).toHaveClass('valor--positivo');
  });

  it('pagamento de fatura é neutro (não é gasto nem ganho)', () => {
    renderizar(<LinhaMovimento m={movimento({ natureza: 'PAGAMENTO_FATURA', categoriaId: null, descricao: 'Pagamento de fatura' })} />);
    expect(screen.getByText(/Pagamento de fatura ·|· Pagamento de fatura/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s40,23/)).toHaveClass('texto-3');
  });
});
