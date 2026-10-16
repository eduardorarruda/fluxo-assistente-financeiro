import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AVISOS, servidorDeAlertas } from '../testes/alertas-falsos';
import { montarComProvedores } from '../testes/ambiente';
import { Sino } from './Sino';

async function abrir() {
  const usuario = userEvent.setup();
  montarComProvedores(<Sino />);
  await usuario.click(await screen.findByRole('button', { name: /^Alertas \(\d+\)$/ }));
  return { usuario, painel: screen.getByRole('dialog', { name: 'Avisos' }) };
}

describe('Sino · dispensar avisos', () => {
  it('o X dispensa só aquele aviso (pelo id, com X-Fluxo) e ele some na hora', async () => {
    const { pedidos } = servidorDeAlertas();
    const { usuario, painel } = await abrir();
    expect(await within(painel).findByText('Google Agenda desconectado')).toBeInTheDocument();

    const [primeiroX] = within(painel).getAllByRole('button', { name: 'Dispensar este aviso' });
    expect(primeiroX).toHaveAttribute('title', 'Dispensar este aviso');
    await usuario.click(primeiroX!);

    expect(pedidos).toEqual([{ url: '/api/alertas/dispensar', corpo: { ids: ['google:reconectar'] }, xFluxo: '1' }]);
    await waitFor(() => expect(within(painel).queryByText('Google Agenda desconectado')).not.toBeInTheDocument());
    expect(within(painel).getByText('Delivery perto do limite')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Alertas (2)' })).toBeInTheDocument();
    expect(await within(painel).findByRole('button', { name: 'Mostrar 1 dispensado' })).toBeInTheDocument();
  });

  it('pelo teclado: o X é alcançável e, dispensado, o foco vai para o aviso seguinte', async () => {
    servidorDeAlertas();
    const { usuario, painel } = await abrir();
    await within(painel).findByText('Google Agenda desconectado');
    const abrirPrimeiro = within(painel).getByRole('button', { name: /Google Agenda desconectado/ });
    abrirPrimeiro.focus();
    await usuario.tab();
    expect(document.activeElement).toHaveAccessibleName('Dispensar este aviso');
    await usuario.keyboard('{Enter}');
    expect(document.activeElement).toHaveAccessibleName(/Delivery perto do limite/);
  });

  it('"Marcar todos como vistos" dispensa todos de uma vez', async () => {
    const { pedidos } = servidorDeAlertas();
    const { usuario, painel } = await abrir();
    await usuario.click(await within(painel).findByRole('button', { name: 'Marcar todos como vistos' }));
    expect(pedidos.map((p) => p.url)).toEqual(['/api/alertas/dispensar-todos']);
    expect(await within(painel).findByText('Nenhum aviso novo.')).toBeInTheDocument();
    expect(await within(painel).findByRole('button', { name: `Mostrar ${AVISOS.length} dispensados` })).toBeInTheDocument();
    expect(within(painel).queryByRole('button', { name: 'Marcar todos como vistos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alertas (0)' })).toBeInTheDocument();
  });

  it('"Mostrar N dispensados" traz de volta o que foi dispensado', async () => {
    const { pedidos } = servidorDeAlertas(['google:reconectar', 'aumento:spotify']);
    const { usuario, painel } = await abrir();
    expect(within(painel).queryByText('Google Agenda desconectado')).not.toBeInTheDocument();
    await usuario.click(await within(painel).findByRole('button', { name: 'Mostrar 2 dispensados' }));
    expect(pedidos.map((p) => p.url)).toEqual(['/api/alertas/restaurar']);
    expect(await within(painel).findByText('Google Agenda desconectado')).toBeInTheDocument();
    expect(within(painel).getByText('Spotify ficou mais caro')).toBeInTheDocument();
    await waitFor(() => expect(within(painel).queryByRole('button', { name: /^Mostrar/ })).not.toBeInTheDocument());
  });

  it('com tudo dispensado: o sino fica quieto, "Nenhum aviso novo." e só o link de mostrar', async () => {
    servidorDeAlertas(AVISOS.map((a) => a.id));
    const { painel } = await abrir();
    expect(screen.getByRole('button', { name: 'Alertas (0)' })).toBeInTheDocument();
    expect(await within(painel).findByText('Nenhum aviso novo.')).toBeInTheDocument();
    expect(within(painel).getByRole('button', { name: 'Mostrar 3 dispensados' })).toBeInTheDocument();
    expect(within(painel).queryByRole('button', { name: 'Marcar todos como vistos' })).not.toBeInTheDocument();
  });

  it('se o servidor recusar, o aviso volta e a pessoa fica sabendo', async () => {
    const { controle } = servidorDeAlertas();
    const { usuario, painel } = await abrir();
    await within(painel).findByText('Google Agenda desconectado');
    controle.falhar = true;
    await usuario.click(within(painel).getAllByRole('button', { name: 'Dispensar este aviso' })[0]!);
    expect(await screen.findByText(/Não consegui dispensar: O servidor recusou\./)).toBeInTheDocument();
    expect(await within(painel).findByText('Google Agenda desconectado')).toBeInTheDocument();
  });

  it('Esc fecha o painel e devolve o foco ao sino', async () => {
    servidorDeAlertas();
    const { usuario } = await abrir();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Avisos' })).not.toBeInTheDocument());
    expect(document.activeElement).toHaveAccessibleName(/^Alertas/);
  });
});
