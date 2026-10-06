import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { calcularPosicao } from './flutuante';
import { CampoSugestoes } from './CampoSugestoes';
import { Seletor, type OpcaoSeletor } from './Seletor';

const OPCOES: OpcaoSeletor[] = [
  { valor: 'a', rotulo: 'Claude pessoal', grupo: 'Claude Code' },
  { valor: 'b', rotulo: 'Claude trabalho', grupo: 'Claude Code', descricao: 'pasta própria' },
  { valor: 'c', rotulo: 'Gemini', grupo: 'Gemini CLI', desabilitada: true },
  { valor: 'd', rotulo: 'Codex', grupo: 'Codex CLI' },
];

function Controlado({ aoMudar = vi.fn(), inicial = 'a' }: { aoMudar?: (v: string) => void; inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <button type="button">fora</button>
      <Seletor rotulo="Conta" valor={valor} opcoes={OPCOES} aoMudar={(v) => (setValor(v), aoMudar(v))} />
    </>
  );
}

const gatilho = () => screen.getByRole('combobox', { name: 'Conta' });

describe('Seletor', () => {
  it('mostra a opção escolhida e abre uma lista própria (não o <select> do sistema)', async () => {
    const u = userEvent.setup();
    render(<Controlado />);
    expect(gatilho()).toHaveTextContent('Claude pessoal');
    expect(document.querySelector('select')).toBeNull();
    await u.click(gatilho());
    const lista = screen.getByRole('listbox', { name: 'Conta' });
    expect(within(lista).getAllByRole('option')).toHaveLength(4);
    expect(within(lista).getByText('Claude Code')).toBeInTheDocument();
    expect(within(lista).getByRole('option', { name: /Claude pessoal/ })).toHaveAttribute('aria-selected', 'true');
    expect(gatilho()).toHaveAttribute('aria-expanded', 'true');
  });

  it('escolhe com o mouse e fecha', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Controlado aoMudar={aoMudar} />);
    await u.click(gatilho());
    await u.click(screen.getByRole('option', { name: /Claude trabalho/ }));
    expect(aoMudar).toHaveBeenCalledWith('b');
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(gatilho()).toHaveTextContent('Claude trabalho');
  });

  it('teclado: setas pulam as desabilitadas, Enter escolhe, foco volta ao botão', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Controlado aoMudar={aoMudar} />);
    gatilho().focus();
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await u.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(aoMudar).toHaveBeenCalledWith('d');
    expect(gatilho()).toHaveFocus();
  });

  it('Esc fecha sem mudar; clicar fora também', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Controlado aoMudar={aoMudar} />);
    await u.click(gatilho());
    await u.keyboard('{ArrowDown}{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await u.click(gatilho());
    await u.click(screen.getByRole('button', { name: 'fora' }));
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('digitar as primeiras letras pula para a opção', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Controlado aoMudar={aoMudar} />);
    gatilho().focus();
    await u.keyboard('co');
    expect(aoMudar).toHaveBeenCalledWith('d');
  });

  it('opção desabilitada não é escolhida', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Controlado aoMudar={aoMudar} />);
    await u.click(gatilho());
    await u.click(screen.getByRole('option', { name: /Gemini/ }));
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('desabilitado não abre', async () => {
    const u = userEvent.setup();
    render(<Seletor rotulo="Conta" valor="a" opcoes={OPCOES} aoMudar={vi.fn()} desabilitado />);
    await u.click(gatilho());
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});

describe('Seletor de modelos (selos, atalhos, submenu)', () => {
  const MODELOS: OpcaoSeletor[] = [
    { valor: 'opus', rotulo: 'Opus 5.5', descricao: 'O mais capaz', atalho: '1' },
    { valor: 'fable', rotulo: 'Fable 5.1', atalho: '2', selo: 'Novo' },
    { valor: 'sonnet-55', rotulo: 'Sonnet 5.5', desabilitada: true, dica: 'Não disponível no seu plano' },
    { valor: 'mais', rotulo: 'Mais modelos', separadorAntes: true, submenu: [
      { valor: 'sonnet-5', rotulo: 'Sonnet 5' },
      { valor: 'opus-48', rotulo: 'Opus 4.8' },
    ] },
  ];

  function Modelos({ aoMudar = vi.fn(), inicial = 'opus' }: { aoMudar?: (v: string) => void; inicial?: string }) {
    const [valor, setValor] = useState(inicial);
    return <Seletor rotulo="Modelo" valor={valor} opcoes={MODELOS} aoMudar={(v) => (setValor(v), aoMudar(v))} />;
  }

  it('mostra selo, atalho, separador e a dica da opção indisponível', async () => {
    const u = userEvent.setup();
    render(<Modelos />);
    await u.click(screen.getByRole('combobox', { name: 'Modelo' }));
    expect(screen.getByText('Novo')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Sonnet 5.5/ })).toHaveAttribute('title', 'Não disponível no seu plano');
    expect(screen.getByRole('option', { name: /Mais modelos/ })).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('atalho numérico escolhe com a lista aberta', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Modelos aoMudar={aoMudar} />);
    await u.click(screen.getByRole('combobox', { name: 'Modelo' }));
    await u.keyboard('2');
    expect(aoMudar).toHaveBeenCalledWith('fable');
  });

  it('seta para a direita abre "Mais modelos"; escolher lá dentro muda o valor e o botão mostra o nome', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Modelos aoMudar={aoMudar} />);
    screen.getByRole('combobox', { name: 'Modelo' }).focus();
    await u.keyboard('{ArrowDown}{End}{ArrowRight}');
    const sub = await screen.findByRole('listbox', { name: 'Mais modelos' });
    expect(within(sub).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sonnet 5', 'Opus 4.8']);
    await u.keyboard('{ArrowDown}{Enter}');
    expect(aoMudar).toHaveBeenCalledWith('opus-48');
    expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveTextContent('Opus 4.8');
  });

  it('seta para a esquerda fecha só o submenu; clicar no item do submenu escolhe', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<Modelos aoMudar={aoMudar} />);
    await u.click(screen.getByRole('combobox', { name: 'Modelo' }));
    await u.click(screen.getByRole('option', { name: /Mais modelos/ }));
    expect(await screen.findByRole('listbox', { name: 'Mais modelos' })).toBeInTheDocument();
    await u.keyboard('{ArrowLeft}');
    await vi.waitFor(() => expect(screen.queryByRole('listbox', { name: 'Mais modelos' })).toBeNull());
    expect(screen.getByRole('listbox', { name: 'Modelo' })).toBeInTheDocument();
    await u.click(screen.getByRole('option', { name: /Mais modelos/ }));
    await u.click(await screen.findByRole('option', { name: 'Sonnet 5' }));
    expect(aoMudar).toHaveBeenCalledWith('sonnet-5');
  });
});

describe('CampoSugestoes', () => {
  function Campo({ aoConfirmar = vi.fn() }: { aoConfirmar?: () => void }) {
    const [valor, setValor] = useState('');
    return (
      <CampoSugestoes aria-label="Modelo" valor={valor} aoMudar={setValor} aoConfirmar={aoConfirmar}
        sugestoes={['sonnet', 'opus', 'haiku'].map((m) => ({ valor: m, rotulo: m }))} />
    );
  }

  it('aceita texto livre e filtra as sugestões enquanto digita', async () => {
    const u = userEvent.setup();
    render(<Campo />);
    await u.type(screen.getByRole('combobox', { name: 'Modelo' }), 'o');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['sonnet', 'opus']);
    await u.type(screen.getByRole('combobox'), 'meu-modelo');
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('combobox')).toHaveValue('omeu-modelo');
  });

  it('seta para baixo mostra todas, Enter escolhe a em destaque', async () => {
    const u = userEvent.setup();
    render(<Campo />);
    screen.getByRole('combobox').focus();
    await u.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByRole('combobox')).toHaveValue('opus');
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('Enter com a lista fechada confirma o campo', async () => {
    const aoConfirmar = vi.fn();
    const u = userEvent.setup();
    render(<Campo aoConfirmar={aoConfirmar} />);
    await u.type(screen.getByRole('combobox'), 'x-livre');
    await u.keyboard('{Enter}');
    expect(aoConfirmar).toHaveBeenCalled();
  });

  it('o botão mostra todas as sugestões', async () => {
    const u = userEvent.setup();
    render(<Campo />);
    await u.click(screen.getByRole('button', { name: 'Ver sugestões' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});

describe('calcularPosicao', () => {
  const janela = { largura: 1000, altura: 800 };
  const caixa = (top: number, left = 100, largura = 220, altura = 36) =>
    ({ top, bottom: top + altura, left, right: left + largura, width: largura, height: altura }) as DOMRect;

  it('abre embaixo quando cabe', () => {
    const p = calcularPosicao(caixa(100), janela, 'inicio');
    expect(p.lado).toBe('baixo');
    expect(p.estilo.top).toBe(142);
  });

  it('abre em cima perto do pé da janela', () => {
    const p = calcularPosicao(caixa(740), janela, 'inicio');
    expect(p.lado).toBe('cima');
    expect(p.estilo.bottom).toBe(66);
  });

  it('não sai pela direita', () => {
    const p = calcularPosicao(caixa(100, 900, 220), janela, 'inicio');
    expect(Number(p.estilo.left) + Number(p.estilo.minWidth)).toBeLessThanOrEqual(992);
  });
});
