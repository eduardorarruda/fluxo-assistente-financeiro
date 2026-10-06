import { fireEvent, screen, waitFor } from '@testing-library/react';
import { movimento, renderizar } from '../../testes/ambiente';
import { EditorMovimento } from './EditorMovimento';

function patch(chamadas: { metodo: string; url: string; corpo: unknown }[]) {
  return chamadas.filter((c) => c.metodo === 'PATCH');
}

describe('EditorMovimento', () => {
  it('abrir e salvar sem mexer não grava nada (não marca como editado)', async () => {
    const fechar = vi.fn();
    const { chamadas } = renderizar(<EditorMovimento m={movimento()} aoFechar={fechar} />, {
      '/api/movimentos/m1/sugestao-de-regra': { texto: 'padaria real' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /salvar/i }));
    expect(fechar).toHaveBeenCalled();
    expect(patch(chamadas)).toEqual([]);
  });

  it('trocar a categoria e pedir a regra manda só o que mudou, com o texto da regra', async () => {
    const { chamadas } = renderizar(<EditorMovimento m={movimento()} aoFechar={() => undefined} />, {
      '/api/movimentos/m1/sugestao-de-regra': { texto: 'padaria real' },
      '/api/movimentos/m1': movimento({ categoriaId: 'mercado' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Mercado/ }));
    fireEvent.click(screen.getByRole('switch', { name: /parecidos/i }));
    await waitFor(() => expect(screen.getByDisplayValue('padaria real')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(patch(chamadas)).toHaveLength(1));
    expect(patch(chamadas)[0]!.corpo).toEqual({ categoriaId: 'mercado', regra: { texto: 'padaria real' } });
  });

  it('marcar como transferência esconde as categorias e manda só a natureza', async () => {
    const { chamadas } = renderizar(<EditorMovimento m={movimento()} aoFechar={() => undefined} />, {
      '/api/movimentos/m1': movimento({ natureza: 'TRANSFERENCIA', categoriaId: null }),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Entre contas/ }));
    await waitFor(() => expect(screen.queryByText('Categoria')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(patch(chamadas)).toHaveLength(1));
    expect(patch(chamadas)[0]!.corpo).toEqual({ natureza: 'TRANSFERENCIA' });
  });

  it('movimento já editado oferece voltar ao automático, que limpa tudo', async () => {
    const { chamadas } = renderizar(<EditorMovimento m={movimento({ editado: true, nota: 'x' })} aoFechar={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Voltar ao automático/ }));
    await waitFor(() => expect(patch(chamadas)).toHaveLength(1));
    expect(patch(chamadas)[0]!.corpo).toEqual({ natureza: null, categoriaId: null, nota: null, ignorar: false });
  });
});
