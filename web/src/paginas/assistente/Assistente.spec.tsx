import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { montarComProvedores } from '../../testes/ambiente';
import type { ResumoConversa } from '../../api/tipos-assistente';
import { type Chamada, config, conta, contaApi, conversa, corpoSse, MODELOS_API, mensagem, quadro, resumo, servidorFalso } from '../../testes/fixtures/assistente';
import { Assistente } from './Assistente';

// A primeira tela do arquivo paga a importação a frio (motion, react-markdown): espera mais que o 1 s padrão.
configure({ asyncUtilTimeout: 5000 });

const montar = (rota: string) =>
  montarComProvedores(
    <Routes>
      <Route path="/assistente/:conversaId?" element={<Assistente />} />
    </Routes>,
    rota,
  );

/** Claude com duas contas prontas (pessoal e trabalho), Gemini desligado, Codex sem instalar. */
const duasContas = () =>
  config({ contas: [...config().contas, conta({ id: 'u2', nome: 'Claude trabalho', pastaLogin: '/home/ana/.config/fluxo/contas/claude-trabalho', modelo: 'opus' })] });

const sse = (...quadros: string[]) => new Response(corpoSse(quadros), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });


/** Abre o seletor (a lista própria do Fluxo, não o <select> do sistema) e escolhe a opção. */
async function escolher(u: ReturnType<typeof userEvent.setup>, nome: string, opcao: RegExp) {
  await u.click(screen.getByRole('combobox', { name: nome }));
  await u.click(await screen.findByRole('option', { name: opcao }));
}

/** Os rótulos das opções de um seletor (abre, lê e fecha com Esc). */
async function rotulosDe(nome: string) {
  const u = userEvent.setup();
  await u.click(screen.getByRole('combobox', { name: nome }));
  const lista = await screen.findByRole('listbox', { name: nome });
  const rotulos = within(lista).getAllByRole('option').map((o) => o.querySelector('.flutuante__rotulo')?.textContent);
  await u.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return rotulos;
}

describe('Assistente · tela', () => {
  it('conversa nova: a sugestão cria a conversa, envia e mostra a resposta que chega pelo SSE', async () => {
    const usuario = userEvent.setup();
    const pergunta = 'Quais assinaturas eu posso cortar?';
    const usuarioMsg = mensagem({ id: 'u1', papel: 'usuario', texto: pergunta, provedor: null });
    const gerando = mensagem({ id: 'a1', texto: '', situacao: 'gerando' });
    const final = mensagem({ id: 'a1', texto: 'Você tem **3** assinaturas.', situacao: 'ok', modelo: 'sonnet' });
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config(),
      'GET /api/assistente/conversas': [],
      'POST /api/assistente/conversas': resumo({ id: 'c9', titulo: 'Nova conversa' }),
      'POST /api/assistente/conversas/c9/mensagens': { execucaoId: 'e1', usuario: usuarioMsg, assistente: gerando },
      'GET /api/assistente/execucoes/e1/eventos': () => sse(quadro(1, { tipo: 'texto', delta: 'Você tem ' }), quadro(2, { tipo: 'fim', mensagem: final })),
      'GET /api/assistente/conversas/c9': conversa({ id: 'c9', titulo: 'Assinaturas', mensagens: [usuarioMsg, final] }),
    });
    montar('/assistente');

    expect(await screen.findByText(/O que você quer entender/)).toBeInTheDocument();
    expect(await screen.findByText('Suas conversas aparecem aqui.')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: pergunta }));

    expect(await screen.findByText('assinaturas.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(pergunta)).toBeInTheDocument();
    expect(chamadas.find((c) => c.metodo === 'POST' && c.url === '/api/assistente/conversas')?.corpo).toEqual({ contaId: 'claude', modelo: null });
    expect(chamadas.find((c) => c.url.endsWith('/mensagens'))?.corpo).toEqual({ texto: pergunta, anexos: [], contaId: 'claude', modelo: null });
    expect(chamadas.some((c) => c.url === '/api/assistente/execucoes/e1/eventos?desde=0')).toBe(true);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Assinaturas' })).toBeInTheDocument());
  });

  it('sem nenhum CLI pronto, a caixa de texto vira um convite para os ajustes', async () => {
    servidorFalso({ 'GET /api/assistente/config': config({ contaPadrao: null }), 'GET /api/assistente/conversas': [] });
    montar('/assistente');
    expect(await screen.findByText('Falta ligar um assistente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Configurar/ })).toHaveAttribute('href', '/ajustes#assistente');
    expect(screen.queryByRole('textbox', { name: 'Mensagem' })).not.toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: /\?$/ })) expect(b).toBeDisabled();
  });

  it('abre conversa existente, agrupa a lista; o seletor oferece só contas prontas e os modelos do CLI', async () => {
    const hoje = new Date().toISOString();
    servidorFalso({
      'GET /api/assistente/config': duasContas(),
      'GET /api/assistente/conversas': [resumo({ id: 'c1', titulo: 'Gastos de setembro', atualizadaEm: hoje }), resumo({ id: 'c2', titulo: 'Metas', fixada: true, atualizadaEm: hoje })],
      'GET /api/assistente/conversas/c1': conversa({ id: 'c1', mensagens: [mensagem({ id: 'u', papel: 'usuario', texto: 'oi' }), mensagem({ id: 'a', texto: 'Olá!' })] }),
    });
    montar('/assistente/c1');
    expect(await screen.findByText('Olá!')).toBeInTheDocument();
    const lista = screen.getByRole('navigation', { name: 'Conversas' });
    expect(within(lista).getByRole('region', { name: 'Fixadas' })).toHaveTextContent('Metas');
    expect(within(lista).getByRole('region', { name: 'Hoje' })).toHaveTextContent('Gastos de setembro');
    expect(within(lista).getByRole('link', { name: /Gastos de setembro/ })).toHaveAttribute('aria-current', 'page');

    expect(document.querySelector('select')).toBeNull();
    expect(await rotulosDe('Conta')).toEqual(['Claude pessoal', 'Claude trabalho']);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(await rotulosDe('Modelo')).toEqual(['Modelo padrão', 'sonnet', 'opus', 'Outro modelo…']);
  });

  it('conta de API: aparece no grupo da API com o selo "API" e "por uso"; os modelos vêm da lista ao vivo do provedor', async () => {
    const usuario = userEvent.setup();
    const extra = { id: 'claude-3-7-sonnet-latest', nome: 'claude-3-7-sonnet-latest', descricao: 'da API' };
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config({ contas: [...duasContas().contas, contaApi({ modelo: 'claude-opus-4-1' }), contaApi({ id: 'api-2', nome: 'Sem chave', instalado: false, chaveFinal: null })] }),
      'GET /api/assistente/conversas': [resumo({ contaId: 'api-1', contaNome: 'Claude (API)' })],
      'GET /api/assistente/conversas/c1': conversa({ contaId: 'api-1', mensagens: [mensagem()] }),
      'GET /api/assistente/contas/api-1/modelos': { modelos: [...MODELOS_API.claude, extra], aoVivo: true },
    });
    montar('/assistente/c1');
    await screen.findByRole('combobox', { name: 'Conta' });
    expect(await rotulosDe('Conta')).toEqual(['Claude pessoal', 'Claude trabalho', 'Claude (API)']);

    await usuario.click(screen.getByRole('combobox', { name: 'Conta' }));
    const listaContas = await screen.findByRole('listbox', { name: 'Conta' });
    expect(within(listaContas).getByText('API da Anthropic')).toBeInTheDocument();
    const opcaoApi = within(listaContas).getByRole('option', { name: /Claude \(API\)/ });
    expect(opcaoApi).toHaveTextContent('por uso · modelo claude-opus-4-1');
    expect(opcaoApi.querySelector('.flutuante__selo')).toHaveTextContent('API');
    await usuario.keyboard('{Escape}');

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/assistente/contas/api-1/modelos')).toBe(true));
    expect(await rotulosDe('Modelo')).toEqual(['Modelo padrão', 'Sonnet 4.5', 'Opus 4.1', 'Mais modelos', 'Outro modelo…']);
    await usuario.click(screen.getByRole('combobox', { name: 'Modelo' }));
    expect(await screen.findByRole('option', { name: /o da conta: Opus 4\.1/ })).toBeInTheDocument();
    // Atalhos numéricos só para os principais; o resto da lista ao vivo fica em "Mais modelos".
    expect(screen.getByRole('option', { name: /Sonnet 4\.5/ }).querySelector('kbd')).toHaveTextContent('1');
    await usuario.click(screen.getByRole('option', { name: /Mais modelos/ }));
    const sub = await screen.findByRole('listbox', { name: 'Mais modelos' });
    expect(within(sub).getAllByRole('option').map((o) => o.querySelector('.flutuante__rotulo')?.textContent)).toEqual(['Haiku 4.5', 'claude-3-7-sonnet-latest']);
  });

  it('conta de API: enquanto a lista ao vivo não chega (ou falha), o seletor usa o catálogo fixo da API', async () => {
    servidorFalso({
      'GET /api/assistente/config': config({ contas: [conta(), contaApi()] }),
      'GET /api/assistente/conversas': [resumo({ contaId: 'api-1' })],
      'GET /api/assistente/conversas/c1': conversa({ contaId: 'api-1', mensagens: [mensagem()] }),
      'GET /api/assistente/contas/api-1/modelos': () => new Response(JSON.stringify({ erro: 'A Anthropic não respondeu.' }), { status: 502 }),
    });
    montar('/assistente/c1');
    await screen.findByRole('combobox', { name: 'Modelo' });
    expect(await rotulosDe('Modelo')).toEqual(['Modelo padrão', 'Sonnet 4.5', 'Opus 4.1', 'Mais modelos', 'Outro modelo…']);
  });

  it('trocar a conta manda PATCH { contaId, modelo: null } (o modelo volta ao padrão da conta)', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': duasContas(),
      'GET /api/assistente/conversas': [resumo()],
      'GET /api/assistente/conversas/c1': conversa({ modelo: 'sonnet', mensagens: [mensagem()] }),
      'PATCH /api/assistente/conversas/c1': resumo({ contaId: 'u2', contaNome: 'Claude trabalho', modelo: null }),
    });
    montar('/assistente/c1');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveTextContent('sonnet'));
    await escolher(usuario, 'Conta', /Claude trabalho/);
    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'PATCH')?.corpo).toEqual({ contaId: 'u2', modelo: null }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveTextContent('Modelo padrão'));
    await usuario.click(screen.getByRole('combobox', { name: 'Modelo' }));
    expect(await screen.findByRole('option', { name: /o da conta: opus/ })).toBeInTheDocument();
  });

  it('modelo sugerido e "Outro…" com nome livre mandam PATCH na conversa', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': duasContas(),
      'GET /api/assistente/conversas': [resumo()],
      'GET /api/assistente/conversas/c1': conversa({ mensagens: [mensagem()] }),
      'PATCH /api/assistente/conversas/c1': (c: Chamada) => resumo(c.corpo as Partial<ResumoConversa>),
    });
    montar('/assistente/c1');
    await screen.findByRole('combobox', { name: 'Modelo' });
    await escolher(usuario, 'Modelo', /^opus/);
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'PATCH').map((c) => c.corpo)).toEqual([{ contaId: 'claude', modelo: 'opus' }]));

    await escolher(usuario, 'Modelo', /Outro modelo/);
    const campo = screen.getByRole('combobox', { name: 'Nome do modelo' });
    expect(campo).toHaveFocus();
    await usuario.clear(campo);
    await usuario.type(campo, 'claude-opus-4-1{Enter}');
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'PATCH').at(-1)?.corpo).toEqual({ contaId: 'claude', modelo: 'claude-opus-4-1' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveTextContent('claude-opus-4-1'));
    expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveFocus();
  });

  it('"Outro…" recusa nome inválido sem chamar o servidor; Esc volta para a lista', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': duasContas(),
      'GET /api/assistente/conversas': [resumo()],
      'GET /api/assistente/conversas/c1': conversa({ mensagens: [mensagem()] }),
    });
    montar('/assistente/c1');
    await screen.findByRole('combobox', { name: 'Modelo' });
    await escolher(usuario, 'Modelo', /Outro modelo/);
    const campo = screen.getByRole('combobox', { name: 'Nome do modelo' });
    await usuario.type(campo, '--dangerously-skip{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/letras, números/);
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    await usuario.clear(campo);
    await usuario.type(campo, 'a'.repeat(101));
    expect(campo).toHaveValue('a'.repeat(100));
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('combobox', { name: 'Nome do modelo' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveFocus();
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false);
  });

  it('conversa nova: a conta e o modelo escolhidos vão na criação e na primeira mensagem', async () => {
    const usuario = userEvent.setup();
    const pergunta = 'Como está minha fatura do cartão?';
    const usuarioMsg = mensagem({ id: 'u1', papel: 'usuario', texto: pergunta, contaId: null, provedor: null });
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': duasContas(),
      'GET /api/assistente/conversas': [],
      'POST /api/assistente/conversas': resumo({ id: 'c9', titulo: 'Nova conversa', contaId: 'u2', modelo: 'sonnet-4.5' }),
      'POST /api/assistente/conversas/c9/mensagens': { execucaoId: 'e1', usuario: usuarioMsg, assistente: mensagem({ id: 'a1', texto: '', situacao: 'gerando' }) },
      'GET /api/assistente/execucoes/e1/eventos': () => sse(quadro(1, { tipo: 'fim', mensagem: mensagem({ id: 'a1', texto: 'Tudo certo.' }) })),
      'GET /api/assistente/conversas/c9': conversa({ id: 'c9', contaId: 'u2', modelo: 'sonnet-4.5', mensagens: [usuarioMsg] }),
    });
    montar('/assistente');
    await screen.findByRole('combobox', { name: 'Conta' });
    await escolher(usuario, 'Conta', /Claude trabalho/);
    await escolher(usuario, 'Modelo', /Outro modelo/);
    await usuario.type(screen.getByRole('combobox', { name: 'Nome do modelo' }), 'sonnet-4.5{Enter}');
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false);

    await usuario.click(screen.getByRole('button', { name: pergunta }));
    await waitFor(() => expect(chamadas.find((c) => c.url.endsWith('/mensagens'))?.corpo).toEqual({ texto: pergunta, anexos: [], contaId: 'u2', modelo: 'sonnet-4.5' }));
    expect(chamadas.find((c) => c.metodo === 'POST' && c.url === '/api/assistente/conversas')?.corpo).toEqual({ contaId: 'u2', modelo: 'sonnet-4.5' });
  });

  it('menu da conversa: renomear com Enter e excluir confirmando no modal', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config(),
      'GET /api/assistente/conversas': [resumo()],
      'PATCH /api/assistente/conversas/c1': resumo({ titulo: 'Setembro' }),
      'DELETE /api/assistente/conversas/c1': undefined,
    });
    montar('/assistente');
    await usuario.click(await screen.findByRole('button', { name: 'Ações de “Gastos de setembro”' }));
    expect(screen.getByRole('menuitem', { name: /Fixar/ })).toHaveFocus();
    await usuario.click(screen.getByRole('menuitem', { name: /Renomear/ }));
    const campo = screen.getByRole('textbox', { name: 'Novo nome da conversa' });
    await usuario.clear(campo);
    await usuario.type(campo, 'Setembro{Enter}');
    expect(chamadas.find((c) => c.metodo === 'PATCH')?.corpo).toEqual({ titulo: 'Setembro' });

    await usuario.click(screen.getByRole('button', { name: 'Ações de “Gastos de setembro”' }));
    await usuario.click(screen.getByRole('menuitem', { name: /Excluir/ }));
    const modal = await screen.findByRole('dialog');
    await usuario.click(within(modal).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE' && c.url === '/api/assistente/conversas/c1')).toBe(true));
  });

  it('Esc no menu fecha e devolve o foco ao botão', async () => {
    const usuario = userEvent.setup();
    servidorFalso({ 'GET /api/assistente/config': config(), 'GET /api/assistente/conversas': [resumo()] });
    montar('/assistente');
    const botao = await screen.findByRole('button', { name: 'Ações de “Gastos de setembro”' });
    await usuario.click(botao);
    await usuario.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Renomear/ })).toHaveFocus();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(botao).toHaveFocus();
  });

  it('conversa que não existe mais mostra aviso e caminho para uma nova', async () => {
    servidorFalso({ 'GET /api/assistente/config': config(), 'GET /api/assistente/conversas': [] });
    montar('/assistente/sumiu');
    expect(await screen.findByText('Conversa não encontrada')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Nova conversa/ }).length).toBeGreaterThan(0);
  });
});
