import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConfigImagens } from '../../api/tipos-assistente';
import { montarComProvedores } from '../../testes/ambiente';
import { servidorFalso } from '../../testes/fixtures/assistente';
import { AjusteImagens } from './AjusteImagens';

configure({ asyncUtilTimeout: 5000 });

const CHAVE = 'AIzaSyTESTE-chave_falsa-0123456789AbCd';
const ROTA = '/api/assistente/imagens/config';
const config = (p: Partial<ConfigImagens> = {}): ConfigImagens => ({
  configurada: false, final: null, modelo: 'gemini-3.1-flash-image', limiteDiario: 20, geradasHoje: 0, ...p,
});
const salva = config({ configurada: true, final: '…AbCd', geradasHoje: 3 });

describe('AjusteImagens', () => {
  it('sem chave: explica custo e onde gerar, campo de senha; salvar manda PUT { chave } e nunca mostra a chave', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ [`GET ${ROTA}`]: config(), [`PUT ${ROTA}`]: salva });
    const { container } = montarComProvedores(<AjusteImagens />, '/ajustes');
    const campo = await screen.findByLabelText('Chave da API do Gemini');
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByText('https://aistudio.google.com/apikey')).toBeInTheDocument();
    expect(screen.getByText(/chave paga/)).toBeInTheDocument();
    expect(screen.getByText(/AI Pro ou Ultra/)).toBeInTheDocument();

    await usuario.type(campo, CHAVE);
    await usuario.click(screen.getByRole('button', { name: 'Salvar chave' }));
    expect(chamadas.filter((c) => c.metodo === 'PUT').map((c) => c.corpo)).toEqual([{ chave: CHAVE }]);
    expect(await screen.findByText('…AbCd')).toBeInTheDocument();
    expect(screen.getByText(/Chave configurada/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Chave da API do Gemini')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(CHAVE);
    expect(screen.getByText('Hoje: 3 de 20 imagens')).toBeInTheDocument();
  });

  it('formato que não é de chave: avisa e não manda nada', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ [`GET ${ROTA}`]: config() });
    montarComProvedores(<AjusteImagens />, '/ajustes');
    await usuario.type(await screen.findByLabelText('Chave da API do Gemini'), 'minha senha');
    await usuario.click(screen.getByRole('button', { name: 'Salvar chave' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/não parece uma chave/);
    expect(chamadas.some((c) => c.metodo === 'PUT')).toBe(false);
  });

  it('com chave: "Trocar" abre um campo vazio; "Remover" manda DELETE', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ [`GET ${ROTA}`]: salva, [`DELETE ${ROTA}`]: config() });
    montarComProvedores(<AjusteImagens />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Trocar' }));
    expect(screen.getByLabelText('Chave da API do Gemini')).toHaveValue('');
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    await usuario.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE' && c.url === ROTA)).toBe(true));
    expect(await screen.findByLabelText('Chave da API do Gemini')).toBeInTheDocument();
  });

  it('modelo e limite usam o Seletor do Fluxo (não <select>) e mandam PUT só com o que mudou', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ [`GET ${ROTA}`]: salva, [`PUT ${ROTA}`]: (c: { corpo: unknown }) => ({ ...salva, ...(c.corpo as object) }) });
    const { container } = montarComProvedores(<AjusteImagens />, '/ajustes');
    await usuario.click(await screen.findByRole('combobox', { name: 'Modelo de imagem' }));
    await usuario.click(await screen.findByRole('option', { name: /Nano Banana Pro/ }));
    await usuario.click(screen.getByRole('combobox', { name: 'Limite diário de imagens' }));
    await usuario.click(await screen.findByRole('option', { name: /50 por dia/ }));
    expect(chamadas.filter((c) => c.metodo === 'PUT').map((c) => c.corpo)).toEqual([{ modelo: 'gemini-3-pro-image' }, { limiteDiario: 50 }]);
    expect(container.querySelector('select')).toBeNull();
  });
});
