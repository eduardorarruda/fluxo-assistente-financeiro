import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { montarComProvedores } from '../../testes/ambiente';
import { resumo, servidorFalso } from '../../testes/fixtures/assistente';
import { ListaConversas } from './ListaConversas';

configure({ asyncUtilTimeout: 5000 });

const AGORA = new Date('2026-09-30T15:00:00');

function montar(aoFechar?: () => void) {
  const { chamadas } = servidorFalso({ 'GET /api/assistente/conversas': [resumo({ id: 'c1', titulo: 'Gastos de setembro' })] });
  montarComProvedores(<ListaConversas conversaAtiva={undefined} aoNova={vi.fn()} aoAbrir={vi.fn()} aoFechar={aoFechar} agora={AGORA} />);
  return chamadas;
}

describe('ListaConversas · busca e gaveta', () => {
  it('busca: o botão próprio de limpar esvazia o campo e devolve o foco a ele', async () => {
    const usuario = userEvent.setup();
    montar();
    await screen.findByText('Gastos de setembro');
    const campo = screen.getByRole('searchbox', { name: 'Buscar conversas' });
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument();

    await usuario.type(campo, 'mercado');
    await usuario.click(screen.getByRole('button', { name: 'Limpar busca' }));

    expect(campo).toHaveValue('');
    expect(campo).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument();
  });

  it('Esc com texto na busca limpa o campo (sem deixar o Esc subir para a gaveta)', async () => {
    const usuario = userEvent.setup();
    const aoTecla = vi.fn();
    window.addEventListener('keydown', aoTecla);
    montar();
    const campo = await screen.findByRole('searchbox', { name: 'Buscar conversas' });

    await usuario.type(campo, 'luz{Escape}');

    expect(campo).toHaveValue('');
    expect(aoTecla).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    window.removeEventListener('keydown', aoTecla);
  });

  it('na gaveta há um botão de fechar ao lado de "Nova conversa"; fora dela, não', async () => {
    const usuario = userEvent.setup();
    const aoFechar = vi.fn();
    montar(aoFechar);
    await usuario.click(await screen.findByRole('button', { name: 'Fechar conversas' }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('sem aoFechar (lista fixa ao lado) não mostra o botão de fechar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Gastos de setembro')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Fechar conversas' })).not.toBeInTheDocument();
  });
});
