import { screen, waitFor } from '@testing-library/react';
import estado from '../testes/fixtures/estado.json';
import fluxo from '../testes/fixtures/fluxo.json';
import { renderizar } from '../testes/ambiente';
import { Fluxo } from './Fluxo';

describe('Fluxo', () => {
  it('explica a parte do resgate de caixinhas que não entrou no gasto do mês', async () => {
    renderizar(<Fluxo />, { '/api/estado': estado, '/api/fluxo': { ...fluxo, sankey: { ...fluxo.sankey, resgateForaDoMes: 105433 } } });
    await waitFor(() => expect(screen.getByText(/não\s+entraram no gasto deste mês/)).toBeTruthy());
  });

  it('sem resgate sobrando, não mostra o aviso', async () => {
    renderizar(<Fluxo />, { '/api/estado': estado, '/api/fluxo': fluxo });
    await waitFor(() => expect(screen.getByText(/De onde veio e para onde foi/)).toBeTruthy());
    expect(screen.queryByText(/não\s+entraram no gasto deste mês/)).toBeNull();
  });
});
