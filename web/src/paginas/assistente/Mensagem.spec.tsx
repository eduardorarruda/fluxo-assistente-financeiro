import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { anexo, mensagem, passo } from '../../testes/fixtures/assistente';
import { MensagemAssistente, MensagemUsuario } from './Mensagem';

const comRotas = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('MensagemAssistente · markdown', () => {
  it('renderiza tabela do GFM, negrito, lista e código com botão de copiar', () => {
    const texto = [
      '**Resumo de setembro**',
      '',
      '| Categoria | Valor |',
      '|---|---:|',
      '| Mercado | R$ 812,40 |',
      '| Delivery | R$ 356,90 |',
      '',
      '- item um',
      '',
      '```sql',
      'select 1;',
      '```',
    ].join('\n');
    const { container } = comRotas(<MensagemAssistente mensagem={mensagem({ texto })} />);
    const tabela = screen.getByRole('table');
    expect(within(tabela).getAllByRole('row')).toHaveLength(3);
    expect(within(tabela).getByText('R$ 356,90')).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('Resumo de setembro');
    expect(screen.getByText('item um')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeInTheDocument();
    expect(screen.getByText('sql')).toBeInTheDocument();
  });

  it('não transforma HTML do texto em HTML de verdade (sem script, sem img onerror)', () => {
    const texto = 'Antes <script>window.invadido = true</script> <img src=x onerror="window.invadido=true"> depois\n\n<div onclick="x()">bloco</div>';
    const { container } = comRotas(<MensagemAssistente mensagem={mensagem({ texto })} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect((window as unknown as { invadido?: boolean }).invadido).toBeUndefined();
  });

  it('nenhum link é clicável: rótulo e URL inteira viram texto (contra vazar dados num clique)', () => {
    const texto = '[x](https://example.com/?d=1) e também https://example.com puro';
    const { container } = comRotas(<MensagemAssistente mensagem={mensagem({ texto })} />);
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('https://example.com/?d=1')).toBeInTheDocument();
    expect(container.querySelector('.md__link-texto')).toHaveTextContent('x (https://example.com/?d=1)');
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });

  it('javascript:, data: e caminho relativo também viram texto; imagem remota não carrega', () => {
    const texto = '[mau](javascript:alert(1)) [dados](data:text/html,oi) [relativo](/api/estado) ![grafico](https://rastreador.exemplo/x.png)';
    const { container } = comRotas(<MensagemAssistente mensagem={mensagem({ texto })} />);
    expect(container.querySelector('a')).toBeNull();
    for (const nome of ['mau', 'dados', 'relativo']) expect(screen.getByText(nome, { exact: false })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('[imagem: grafico]')).toBeInTheDocument();
  });
});

describe('MensagemAssistente · passos e estados', () => {
  it('linha do tempo começa fechada, abre e mostra o pedido e a resposta de cada passo', async () => {
    const usuario = userEvent.setup();
    const passos = [passo(), passo({ id: 'p2', nome: 'buscar_movimentos', rotulo: 'Movimentos com "ifood"', entrada: { texto: 'ifood' }, situacao: 'erro', resultado: 'falhou' }), passo({ id: 'p3', rotulo: 'Metas' })];
    comRotas(<MensagemAssistente mensagem={mensagem({ passos })} />);
    const resumo = screen.getByRole('button', { name: /Consultou 3 fontes · 1 com erro/ });
    expect(resumo).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Resumo de set/2026')).not.toBeInTheDocument();

    await usuario.click(resumo);
    expect(resumo).toHaveAttribute('aria-expanded', 'true');
    const linha = screen.getByRole('button', { name: /Movimentos com "ifood"/ });
    await usuario.click(linha);
    expect(screen.getByText(/"texto": "ifood"/)).toBeInTheDocument();
    expect(screen.getByText('falhou')).toBeInTheDocument();
  });

  it('enquanto gera: mostra o passo em andamento e esconde as ações', () => {
    comRotas(<MensagemAssistente mensagem={mensagem({ situacao: 'gerando', texto: 'Parcial', passos: [passo({ situacao: 'rodando', resultado: null })] })} aoRepetir={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Resumo de set\/2026…/ })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Copiar resposta' })).not.toBeInTheDocument();
  });

  it('sem texto ainda: mostra "Pensando…"', () => {
    comRotas(<MensagemAssistente mensagem={mensagem({ situacao: 'gerando', texto: '' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pensando…');
  });

  it('erro de CLI sem login: cartão com o texto do servidor, "Tentar de novo" e link para os ajustes', async () => {
    const usuario = userEvent.setup();
    const aoRepetir = vi.fn();
    comRotas(<MensagemAssistente mensagem={mensagem({ situacao: 'erro', texto: '', erro: 'O Claude Code pediu login. Rode "claude /login".' })} aoRepetir={aoRepetir} />);
    expect(screen.getByRole('alert')).toHaveTextContent('O Claude Code pediu login');
    expect(screen.getByRole('link', { name: /ajustes do assistente/ })).toHaveAttribute('href', '/ajustes#assistente');
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(aoRepetir).toHaveBeenCalledOnce();
  });

  it('cancelada: aviso discreto, sem link de ajustes', () => {
    comRotas(<MensagemAssistente mensagem={mensagem({ situacao: 'cancelada', texto: 'Começo da resposta' })} />);
    expect(screen.getByText('Você parou esta resposta')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('rodapé mostra provedor, modelo, duração e tokens; repetir só aparece quando permitido', async () => {
    const usuario = userEvent.setup();
    const aoRepetir = vi.fn();
    comRotas(
      <MensagemAssistente
        mensagem={mensagem({ modelo: 'sonnet', uso: { tokensEntrada: 1200, tokensSaida: 340, custoUsd: null, duracaoMs: 12_400 } })}
        aoRepetir={aoRepetir}
      />,
    );
    expect(screen.getByText('Claude · sonnet · 12,4 s · 1.540 tokens')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Repetir resposta' }));
    expect(aoRepetir).toHaveBeenCalledOnce();
  });

  it('rodapé mostra o nome da conta que respondeu quando o servidor manda', () => {
    comRotas(<MensagemAssistente mensagem={mensagem({ contaNome: 'Claude trabalho', modelo: 'opus', uso: { tokensEntrada: null, tokensSaida: null, custoUsd: null, duracaoMs: 850 } })} />);
    expect(screen.getByText('Claude trabalho · opus · 850 ms')).toBeInTheDocument();
  });
});

describe('MensagemUsuario', () => {
  it('mostra o texto como texto puro e os anexos como chips', () => {
    const { container } = comRotas(<MensagemUsuario mensagem={mensagem({ papel: 'usuario', texto: '**não é markdown** <b>nem html</b>', anexos: [anexo()] })} />);
    expect(screen.getByText('**não é markdown** <b>nem html</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('fatura.pdf')).toBeInTheDocument();
    expect(screen.getByText('200 KB')).toBeInTheDocument();
  });
});
