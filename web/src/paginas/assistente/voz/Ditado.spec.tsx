import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { instalarReconhecimentoFalso, ReconhecimentoFalso, removerReconhecimentoFalso } from '../../../testes/voz-falsa';
import { Compositor } from '../Compositor';
import type { ControleAnexos } from '../useAnexos';
import { reiniciarSituacaoLocal } from './reconhecimento';
import { montarTextoDitado } from './useDitado';

const anexos = (): ControleAnexos => ({ itens: [], enviando: false, idsProntos: [], adicionar: vi.fn(), remover: vi.fn(), esvaziar: vi.fn() });

function montar(aoConversar?: () => void) {
  const aoEnviar = vi.fn(async () => true);
  render(<Compositor anexos={anexos()} gerando={false} enviando={false} parando={false} aoEnviar={aoEnviar} aoParar={vi.fn()} aoConversar={aoConversar} />);
  return { aoEnviar, caixa: screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLTextAreaElement };
}

describe('montarTextoDitado', () => {
  it('encaixa no cursor com os espaços certos e maiúscula no começo de frase', () => {
    expect(montarTextoDitado({ antes: 'Olá', depois: 'mundo', confirmado: 'meu', parcial: 'caro' })).toEqual({ texto: 'Olá meu caro mundo', cursor: 12 });
    expect(montarTextoDitado({ antes: 'Fim. ', depois: '', confirmado: 'quanto gastei', parcial: '' }).texto).toBe('Fim. Quanto gastei');
    expect(montarTextoDitado({ antes: '', depois: '?', confirmado: 'e outubro', parcial: '' }).texto).toBe('E outubro?');
    expect(montarTextoDitado({ antes: 'abc', depois: 'def', confirmado: '', parcial: '' })).toEqual({ texto: 'abcdef', cursor: 3 });
  });
});

describe('ditado na caixa de texto', () => {
  beforeEach(() => instalarReconhecimentoFalso());
  afterEach(() => {
    removerReconhecimentoFalso();
    reiniciarSituacaoLocal();
  });

  it('o texto aparece ao vivo no cursor, sem apagar o que já estava escrito, e Esc para', async () => {
    const usuario = userEvent.setup();
    const { caixa } = montar();
    fireEvent.change(caixa, { target: { value: 'Quanto gastei com mercado?' } });
    caixa.focus();
    caixa.setSelectionRange(14, 14); // depois de "Quanto gastei "
    await usuario.click(screen.getByRole('button', { name: 'Ditar mensagem' }));

    const botao = screen.getByRole('button', { name: 'Parar ditado' });
    expect(botao).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Ouvindo…/)).toBeInTheDocument();

    const r = ReconhecimentoFalso.ultima;
    act(() => r.ouvir([['em setembro', false]]));
    expect(caixa).toHaveValue('Quanto gastei em setembro com mercado?');
    act(() => r.ouvir([['em setembro e outubro', true]]));
    expect(caixa).toHaveValue('Quanto gastei em setembro e outubro com mercado?');

    act(() => r.ouvir([['em setembro e outubro', true], ['só', false]], 1));
    expect(caixa).toHaveValue('Quanto gastei em setembro e outubro só com mercado?');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Ditar mensagem' })).toHaveAttribute('aria-pressed', 'false');
    // O provisório que estava na tela foi confirmado ao parar.
    expect(caixa).toHaveValue('Quanto gastei em setembro e outubro só com mercado?');
    expect(r.ligado).toBe(false);
  });

  it('enviar durante o ditado manda o que está na caixa e o que chegar depois não volta', async () => {
    const usuario = userEvent.setup();
    const { caixa, aoEnviar } = montar();
    await usuario.click(screen.getByRole('button', { name: 'Ditar mensagem' }));
    const r = ReconhecimentoFalso.ultima;
    act(() => r.ouvir([['quanto sobrou', false]]));
    await usuario.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(aoEnviar).toHaveBeenCalledWith('Quanto sobrou');
    expect(caixa).toHaveValue('');
    act(() => r.ouvir([['quanto sobrou este mês', true]]));
    expect(caixa).toHaveValue('');
  });

  it('digitar durante o ditado devolve a caixa à pessoa', async () => {
    const usuario = userEvent.setup();
    const { caixa } = montar();
    await usuario.click(screen.getByRole('button', { name: 'Ditar mensagem' }));
    const r = ReconhecimentoFalso.ultima;
    act(() => r.ouvir([['oi', false]]));
    await usuario.type(caixa, '!');
    expect(screen.getByRole('button', { name: 'Ditar mensagem' })).toHaveAttribute('aria-pressed', 'false');
    expect(caixa).toHaveValue('Oi!');
  });

  it('Alt+M liga e desliga; Alt+V abre a conversa por voz', () => {
    const aoConversar = vi.fn();
    montar(aoConversar);
    fireEvent.keyDown(window, { key: 'm', code: 'KeyM', altKey: true });
    expect(screen.getByRole('button', { name: 'Parar ditado' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'm', code: 'KeyM', altKey: true });
    expect(screen.getByRole('button', { name: 'Ditar mensagem' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV', altKey: true });
    expect(aoConversar).toHaveBeenCalledOnce();
  });

  it('microfone bloqueado mostra como liberar', async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.click(screen.getByRole('button', { name: 'Ditar mensagem' }));
    act(() => ReconhecimentoFalso.ultima.errar('not-allowed'));
    expect(screen.getByRole('alert')).toHaveTextContent(/microfone está bloqueado.*Informações do app/);
    expect(screen.getByRole('button', { name: 'Ditar mensagem' })).toHaveAttribute('aria-pressed', 'false');
    await usuario.click(screen.getByRole('button', { name: 'Fechar aviso do ditado' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('sem reconhecimento no navegador, o botão fica desabilitado e explica por quê', async () => {
    removerReconhecimentoFalso();
    const usuario = userEvent.setup();
    montar();
    const botao = screen.getByRole('button', { name: 'Ditar mensagem' });
    expect(botao).toHaveAttribute('aria-disabled', 'true');
    expect(botao).toHaveAttribute('title', expect.stringMatching(/não reconhece fala/));
    await usuario.click(botao);
    expect(screen.getByRole('alert')).toHaveTextContent(/não reconhece fala/);
  });
});
