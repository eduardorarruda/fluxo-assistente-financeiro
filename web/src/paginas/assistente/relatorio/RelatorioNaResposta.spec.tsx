import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { anexo, mensagem } from '../../../testes/fixtures/assistente';
import { MensagemAssistente, MensagemUsuario } from '../Mensagem';

configure({ asyncUtilTimeout: 5000 });

const comRotas = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const bloco = (json: string) => ['Veja:', '', '```grafico', json, '```', '', 'Fim.'].join('\n');
const ESPEC = {
  tipo: 'barras',
  titulo: 'Receitas × despesas',
  subtitulo: 'jul a ago/2026',
  unidade: 'reais',
  rotulos: ['jul/26', 'ago/26'],
  series: [{ nome: 'Receitas', valores: [8200, 8450.5], cor: 'entrada' }, { nome: 'Despesas', valores: [6120.4, 7033.1], cor: 'saida' }],
};
const ID = '3f2c1a9e-8b7d-4c6e-9f10-112233445566';

describe('gráfico na resposta (```grafico)', () => {
  it('desenha com título, legenda, resumo acessível, tabela dos dados e "Copiar dados" em CSV', async () => {
    const usuario = userEvent.setup();
    comRotas(<MensagemAssistente mensagem={mensagem({ texto: bloco(JSON.stringify(ESPEC)) })} />);
    const figura = screen.getByRole('figure', { name: 'Receitas × despesas' });
    expect(within(figura).getByText('jul a ago/2026')).toBeInTheDocument();
    expect(within(figura).getByRole('img').getAttribute('aria-label')).toMatch(/Gráfico de barras com 2 itens/);
    expect(figura.querySelectorAll('rect[fill="var(--entrada)"]')).toHaveLength(2);
    const tabela = within(figura).getByRole('table');
    expect(within(tabela).getByRole('rowheader', { name: 'ago/26' })).toBeInTheDocument();
    expect(within(tabela).getByText(/R\$\s8\.450,50/)).toBeInTheDocument();
    expect(screen.queryByText('grafico')).not.toBeInTheDocument();

    await usuario.click(within(figura).getByRole('button', { name: 'Copiar dados' }));
    expect(await navigator.clipboard.readText()).toBe('Rótulo;Receitas;Despesas\njul/26;8200;6120,4\nago/26;8450,5;7033,1');
  });

  it('pizza mostra as fatias com valor e percentual', () => {
    const pizza = { tipo: 'pizza', titulo: 'Gastos por categoria', unidade: 'reais', rotulos: ['Mercado', 'Delivery'], series: [{ nome: 'Gastos', valores: [750, 250] }] };
    const { container } = comRotas(<MensagemAssistente mensagem={mensagem({ texto: bloco(JSON.stringify(pizza)) })} />);
    expect(screen.getByRole('figure', { name: 'Gastos por categoria' })).toBeInTheDocument();
    expect(container.querySelectorAll('.grafico-ia__fatias li')).toHaveLength(2);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('especificação inválida: cartão "não consegui desenhar" com o JSON recolhido, sem quebrar o resto', () => {
    const ruim = JSON.stringify({ ...ESPEC, series: [{ nome: 'A', valores: [1] }] });
    comRotas(<MensagemAssistente mensagem={mensagem({ texto: bloco(ruim) })} />);
    expect(screen.getByText(/Não consegui desenhar este gráfico/)).toBeInTheDocument();
    expect(screen.getByText('Ver o JSON')).toBeInTheDocument();
    expect(screen.getByText('Fim.')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('enquanto a resposta chega com o JSON pela metade: esqueleto; terminada assim: cartão de erro', () => {
    const metade = ['Veja:', '', '```grafico', '{"tipo":"barras","titulo":"Rec'].join('\n');
    const { rerender } = comRotas(<MensagemAssistente mensagem={mensagem({ texto: metade, situacao: 'gerando' })} />);
    expect(screen.getByRole('status', { name: 'Montando o gráfico…' })).toBeInTheDocument();
    rerender(<MemoryRouter><MensagemAssistente mensagem={mensagem({ texto: metade, situacao: 'ok' })} /></MemoryRouter>);
    expect(screen.getByText(/Não consegui desenhar este gráfico/)).toBeInTheDocument();
  });
});

describe('imagens na resposta', () => {
  it('só `anexo:<uuid>` vira imagem, servida pelo Fluxo, com legenda de origem, ampliar e Baixar', async () => {
    const usuario = userEvent.setup();
    const gerada = anexo({ id: ID, nome: 'Infográfico.png', tipo: 'imagem', mime: 'image/png', origem: 'gerada' });
    comRotas(<MensagemAssistente mensagem={mensagem({ texto: `Pronto:\n\n![Infográfico do mês](anexo:${ID})`, anexos: [gerada] })} />);
    const img = screen.getByRole('img', { name: 'Infográfico do mês' });
    expect(img).toHaveAttribute('src', `/api/assistente/anexos/${ID}/arquivo`);
    expect(screen.getByText('Gerada pelo Nano Banana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar imagem' })).toHaveAttribute('href', `/api/assistente/anexos/${ID}/arquivo`);

    await usuario.click(screen.getByRole('button', { name: 'Ampliar: Infográfico do mês' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('img', { name: 'Infográfico do mês' })).toBeInTheDocument();
    expect(within(dialogo).getByRole('link', { name: 'Baixar imagem' })).toBeInTheDocument();
  });

  it('qualquer outra fonte continua bloqueada (http, data:, caminho da API, anexo: que não é uuid)', () => {
    const texto = [
      '![remota](https://evil.example/x.png?d=saldo)',
      `![api](/api/assistente/anexos/${ID}/arquivo)`,
      '![dados](data:image/png;base64,iVBORw0KGgo=)',
      '![fuga](anexo:../../chave-gemini)',
      `![quase](anexo:${ID}?x=1)`,
    ].join('\n\n');
    const { container } = comRotas(<MensagemAssistente mensagem={mensagem({ texto })} />);
    expect(container.querySelector('img')).toBeNull();
    for (const alt of ['remota', 'api', 'dados', 'fuga', 'quase']) expect(screen.getByText(`[imagem: ${alt}]`)).toBeInTheDocument();
  });

  it('imagem gerada que o texto não cita aparece depois da resposta', () => {
    const gerada = anexo({ id: ID, nome: 'Capa do relatório.png', tipo: 'imagem', mime: 'image/png', origem: 'gerada' });
    comRotas(<MensagemAssistente mensagem={mensagem({ texto: 'Fiz a imagem.', anexos: [gerada] })} />);
    expect(screen.getByRole('img', { name: 'Capa do relatório' })).toHaveAttribute('src', `/api/assistente/anexos/${ID}/arquivo`);
  });

  it('a mensagem da pessoa mostra miniatura das imagens enviadas (e ícone para PDF)', () => {
    const foto = anexo({ id: ID, nome: 'nota.png', tipo: 'imagem', mime: 'image/png' });
    const { container } = comRotas(<MensagemUsuario mensagem={mensagem({ papel: 'usuario', texto: 'olha', anexos: [foto, anexo({ id: 'p1' })] })} />);
    const miniaturas = container.querySelectorAll('img.chip-anexo__miniatura');
    expect(miniaturas).toHaveLength(1);
    expect(miniaturas[0]).toHaveAttribute('src', `/api/assistente/anexos/${ID}/arquivo`);
  });
});
