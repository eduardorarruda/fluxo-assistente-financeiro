import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { passo } from '../../testes/fixtures/assistente';
import { Passos } from './Passos';

describe('Passos · linha do tempo das ferramentas', () => {
  it('ferramenta sem rótulo amigável não repete o nome ao lado do rótulo', async () => {
    const usuario = userEvent.setup();
    const { container } = render(<Passos passos={[passo(), passo({ id: 'p2', nome: 'orcamento_do_mes', rotulo: 'orcamento_do_mes' })]} />);
    await usuario.click(screen.getByRole('button', { name: /Consultou 2 fontes/ }));

    const nomes = Array.from(container.querySelectorAll('.ferramenta__nome')).map((n) => n.textContent);
    expect(nomes).toEqual(['resumo_do_mes']);
    expect(screen.getByRole('button', { name: /orcamento_do_mes/ })).toBeInTheDocument();
  });

  it('com alguma consulta que falhou, o resumo já avisa (marca de erro) antes de abrir', () => {
    render(<Passos passos={[passo(), passo({ id: 'p2', situacao: 'erro', resultado: 'falhou' })]} />);
    expect(screen.getByRole('button', { name: /1 com erro/ })).toHaveClass('ferramentas__resumo--erro');
  });

  it('enquanto roda, o resumo não marca erro (ainda pode dar certo)', () => {
    render(<Passos passos={[passo({ situacao: 'erro' }), passo({ id: 'p2', situacao: 'rodando', resultado: null })]} />);
    expect(screen.getByRole('button', { name: /Resumo de set\/2026…/ })).not.toHaveClass('ferramentas__resumo--erro');
  });
});
