import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { montarComProvedores } from '../../testes/ambiente';
import { CHAVE_FALSA, config, conta, contaApi, MODELOS_API, rag, servidorFalso } from '../../testes/fixtures/assistente';
import { AjustesAssistente } from './AjustesAssistente';

// A primeira tela do arquivo paga a importação a frio (motion, react-markdown): espera mais que o 1 s padrão.
configure({ asyncUtilTimeout: 5000 });

const grupo = (nome: string) => screen.getByRole('region', { name: nome });
const cartaoDa = (nome: string) => screen.getByText(nome, { selector: 'strong' }).closest('.ajuste-conta') as HTMLElement;
const corpos = (chamadas: { metodo: string; url: string; corpo: unknown }[], metodo: string, url: string) =>
  chamadas.filter((c) => c.metodo === metodo && c.url === url).map((c) => c.corpo);

describe('AjustesAssistente · contas', () => {
  it('agrupa as contas por CLI, com instalação, estado de cada conta e só a pronta podendo ser padrão', async () => {
    servidorFalso({ 'GET /api/assistente/config': config() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude pessoal');

    expect(within(grupo('Claude Code')).getByText('Instalado · v2.1.0')).toBeInTheDocument();
    expect(within(grupo('Codex CLI')).getByText('Não instalado')).toBeInTheDocument();
    expect(within(grupo('Codex CLI')).getByText('npm i -g @openai/codex')).toBeInTheDocument();
    expect(within(grupo('Claude Code')).queryByText('npm i -g @anthropic-ai/claude-code')).not.toBeInTheDocument();

    expect(within(cartaoDa('Claude pessoal')).getByText('Pronto · v2.1.0')).toBeInTheDocument();
    expect(within(cartaoDa('Gemini pessoal')).getByText('Desligado')).toBeInTheDocument();
    expect(within(cartaoDa('Codex pessoal')).getByText('Não encontrado')).toBeInTheDocument();
    expect(within(cartaoDa('Claude pessoal')).getByRole('radio')).toBeChecked();
    expect(within(cartaoDa('Gemini pessoal')).getByRole('radio')).toBeDisabled();
    expect(within(cartaoDa('Codex pessoal')).getByRole('button', { name: 'Testar' })).toBeDisabled();
  });

  it('ligar uma conta manda PATCH só com `ativo`; "Usar como padrão" manda PUT /config { contaPadrao }', async () => {
    const usuario = userEvent.setup();
    const ligada = config({ contas: [conta(), conta({ id: 'gemini', provedor: 'gemini', nome: 'Gemini pessoal', comoEntrar: 'gemini' })] });
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config(),
      'PATCH /api/assistente/contas/gemini': ligada,
      'PUT /api/assistente/config': { ...ligada, contaPadrao: 'gemini' },
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('switch', { name: 'Ligar Gemini pessoal' }));
    expect(corpos(chamadas, 'PATCH', '/api/assistente/contas/gemini')).toEqual([{ ativo: true }]);

    const radio = within(cartaoDa('Gemini pessoal')).getByRole('radio');
    await waitFor(() => expect(radio).toBeEnabled());
    await usuario.click(radio);
    expect(corpos(chamadas, 'PUT', '/api/assistente/config')).toEqual([{ contaPadrao: 'gemini' }]);
    await waitFor(() => expect(radio).toBeChecked());
  });

  it('adicionar conta: nome e pasta sugeridos, a pasta acompanha o nome, POST com o corpo certo e o comando de entrar em destaque', async () => {
    const usuario = userEvent.setup();
    const pasta = '/home/ana/.config/fluxo/contas/claude-trabalho';
    const nova = conta({ id: 'u-1', nome: 'Claude trabalho', pastaLogin: pasta, modelo: 'opus', comoEntrar: `CLAUDE_CONFIG_DIR=${pasta} claude /login` });
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config(),
      'POST /api/assistente/contas': () => config({ contas: [...config().contas, nova] }),
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Adicionar conta do Claude Code' }));

    const form = screen.getByRole('form', { name: 'Nova conta do Claude Code' });
    const nome = within(form).getByLabelText('Nome');
    expect(nome).toHaveValue('Claude 2');
    expect(nome).toHaveFocus();
    expect(within(form).getByLabelText('Pasta de login')).toHaveValue('/home/ana/.config/fluxo/contas/claude-2');
    expect(within(form).getByText('CLAUDE_CONFIG_DIR')).toBeInTheDocument();

    await usuario.clear(nome);
    await usuario.type(nome, 'Claude trabalho');
    expect(within(form).getByLabelText('Pasta de login')).toHaveValue(pasta);
    await usuario.type(within(form).getByLabelText('Modelo (opcional)'), 'opus');
    await usuario.click(within(form).getByRole('button', { name: 'Criar conta' }));

    expect(corpos(chamadas, 'POST', '/api/assistente/contas')).toEqual([{ provedor: 'claude', nome: 'Claude trabalho', pastaLogin: pasta, modelo: 'opus' }]);
    expect(await screen.findByText('Agora entre nesta conta:')).toBeInTheDocument();
    const cartao = cartaoDa('Claude trabalho');
    expect(within(cartao).getByText(`CLAUDE_CONFIG_DIR=${pasta} claude /login`)).toBeInTheDocument();
    expect(within(cartao).getByRole('button', { name: 'Esconder detalhes' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('form', { name: 'Nova conta do Claude Code' })).not.toBeInTheDocument();
  });

  it('nova conta recusa modelo inválido e pasta relativa antes de mandar; Esc fecha o formulário', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ 'GET /api/assistente/config': config() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Adicionar conta do Gemini CLI' }));
    const form = screen.getByRole('form', { name: 'Nova conta do Gemini CLI' });
    await usuario.type(within(form).getByLabelText('Modelo (opcional)'), '--yolo');
    expect(within(form).getByRole('alert')).toHaveTextContent(/letras, números/);
    const pasta = within(form).getByLabelText('Pasta de login');
    await usuario.clear(pasta);
    await usuario.type(pasta, 'contas/gemini');
    expect(within(form).getByText(/caminho completo/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar conta' })).toBeDisabled();
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Nova conta do Gemini CLI' })).not.toBeInTheDocument();
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  it('detalhes: modelo livre (com sugestões) e pasta de login vão no PATCH só com o que mudou; o comando de entrar aparece', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ 'GET /api/assistente/config': config(), 'PATCH /api/assistente/contas/claude': config() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude pessoal');
    const cartao = cartaoDa('Claude pessoal');
    await usuario.click(within(cartao).getByRole('button', { name: 'Detalhes' }));
    expect(within(cartao).getByLabelText('Caminho do programa')).toHaveAttribute('placeholder', '/usr/bin/claude');
    expect(within(cartao).getByLabelText('Pasta de login')).toHaveAttribute('placeholder', 'Login padrão do CLI');
    expect(within(cartao).getByText('claude /login')).toBeInTheDocument();
    const modelo = within(cartao).getByLabelText('Modelo padrão');
    // Sugestões numa lista própria (não <datalist>): seta para baixo mostra todas.
    modelo.focus();
    await usuario.keyboard('{ArrowDown}');
    expect(within(await screen.findByRole('listbox', { name: 'Sugestões' })).getAllByRole('option').map((o) => o.querySelector('.flutuante__rotulo')?.textContent)).toEqual(['sonnet', 'opus']);
    await usuario.keyboard('{Escape}');

    await usuario.type(modelo, 'a b');
    expect(within(cartao).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await usuario.clear(modelo);
    await usuario.type(modelo, 'claude-opus-4-1@2026');
    await usuario.type(within(cartao).getByLabelText('Pasta de login'), '/home/ana/.claude-pessoal');
    await usuario.click(within(cartao).getByRole('button', { name: 'Salvar' }));
    expect(corpos(chamadas, 'PATCH', '/api/assistente/contas/claude')).toEqual([{ modelo: 'claude-opus-4-1@2026', pastaLogin: '/home/ana/.claude-pessoal' }]);
  });

  it('"Remover" fica desligado quando é a única conta', async () => {
    servidorFalso({ 'GET /api/assistente/config': config({ contas: [conta()] }) });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude pessoal');
    expect(within(cartaoDa('Claude pessoal')).getByRole('button', { name: 'Remover' })).toBeDisabled();
  });

  it('"Remover" confirma no modal e manda DELETE da conta', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config(),
      'DELETE /api/assistente/contas/gemini': config({ contas: [conta()] }),
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Gemini pessoal');
    await usuario.click(within(cartaoDa('Gemini pessoal')).getByRole('button', { name: 'Remover' }));
    const modal = await screen.findByRole('dialog');
    expect(modal).toHaveTextContent('passam para a conta padrão');
    await usuario.click(within(modal).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE' && c.url === '/api/assistente/contas/gemini')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Gemini pessoal')).not.toBeInTheDocument());
  });

  it('"Testar" chama a conta e mostra o resultado', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': config(),
      'POST /api/assistente/contas/claude/testar': { ok: true, versao: '2.1.0', mensagem: 'Respondeu e está logado.', duracaoMs: 1830 },
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude pessoal');
    await usuario.click(within(cartaoDa('Claude pessoal')).getByRole('button', { name: 'Testar' }));
    expect(await screen.findByText('Respondeu e está logado.')).toBeInTheDocument();
    expect(screen.getByText('1,8 s')).toBeInTheDocument();
    expect(chamadas.some((c) => c.metodo === 'POST' && c.url === '/api/assistente/contas/claude/testar')).toBe(true);
  });
});

describe('AjustesAssistente · contas por chave de API', () => {
  const comApi = (p: Parameters<typeof contaApi>[0] = {}) => config({ contas: [...config().contas, contaApi(p)] });

  it('adicionar: primeiro "como conectar" (plano ou chave), depois o provedor; o nome sugerido segue as escolhas', async () => {
    const usuario = userEvent.setup();
    servidorFalso({ 'GET /api/assistente/config': config() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: /Adicionar conta pelo plano ou por chave de API/ }));

    const form = screen.getByRole('form', { name: 'Nova conta' });
    const como = within(form).getByRole('group', { name: /Como conectar/ });
    expect(within(como).getAllByRole('radio').map((r) => r.closest('label')?.querySelector('.cartao-escolha__titulo')?.firstChild?.textContent)).toEqual([
      'Pelo plano (CLI)',
      'Pela chave de API',
    ]);
    expect(within(como).getByRole('radio', { name: /Pelo plano/ })).toHaveFocus();
    expect(within(form).queryByRole('group', { name: /Qual provedor/ })).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar conta' })).toBeDisabled();

    await usuario.click(within(como).getByRole('radio', { name: /Pela chave de API/ }));
    const provedor = within(form).getByRole('group', { name: /Qual provedor/ });
    expect(within(provedor).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['claude', 'gemini', 'codex']);
    expect(within(provedor).getByRole('radio', { name: /ChatGPT/ })).toHaveAccessibleDescription('API da OpenAI');
    await usuario.click(within(provedor).getByRole('radio', { name: /Gemini/ }));

    const pronto = screen.getByRole('form', { name: 'Nova conta da API do Gemini' });
    expect(within(pronto).getByLabelText('Nome')).toHaveValue('Gemini (API)');
    expect(within(pronto).queryByLabelText('Pasta de login')).not.toBeInTheDocument();
    expect(within(pronto).getByText(/Cobrado por uso na sua conta da API — não usa o plano/)).toBeInTheDocument();
    const link = within(pronto).getByRole('link', { name: /Criar uma chave/ });
    expect(link).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');

    // Volta para o plano: o nome sugerido volta a ser o do CLI e a pasta reaparece.
    await usuario.click(within(como).getByRole('radio', { name: /Pelo plano/ }));
    const cli = screen.getByRole('form', { name: 'Nova conta do Gemini CLI' });
    expect(within(cli).getByLabelText('Nome')).toHaveValue('Gemini 2');
    expect(within(cli).getByLabelText('Pasta de login')).toBeInTheDocument();
    expect(within(cli).queryByLabelText('Chave da API')).not.toBeInTheDocument();
  });

  it('chave: campo de senha sem autocompletar, olho para conferir, recusa chave curta ou com espaço antes de mandar', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ 'GET /api/assistente/config': config() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: /Adicionar conta pelo plano/ }));
    await usuario.click(screen.getByRole('radio', { name: /Pela chave de API/ }));
    await usuario.click(screen.getByRole('radio', { name: /^Claude/ }));
    const form = screen.getByRole('form', { name: 'Nova conta da API da Anthropic' });
    const chave = within(form).getByLabelText('Chave da API');
    expect(chave).toHaveAttribute('type', 'password');
    expect(chave).toHaveAttribute('autocomplete', 'off');
    expect(chave).toHaveAttribute('spellcheck', 'false');

    await usuario.type(chave, 'sk-curta');
    await usuario.tab();
    expect(within(form).getByRole('alert')).toHaveTextContent(/Curta demais/);
    expect(chave).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByRole('button', { name: 'Conectar conta' })).toBeDisabled();

    await usuario.clear(chave);
    await usuario.type(chave, 'sk-ant teste 0000000000000000000');
    expect(within(form).getByRole('alert')).toHaveTextContent(/não tem espaços/);

    const olho = within(form).getByRole('button', { name: 'Mostrar a chave' });
    expect(olho).toHaveAttribute('aria-pressed', 'false');
    await usuario.click(olho);
    expect(chave).toHaveAttribute('type', 'text');
    expect(olho).toHaveAttribute('aria-pressed', 'true');
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  it('criar: POST com tipo api e a chave aparada; a chave sai da tela e o teste roda sozinho, com o resultado no cartão', async () => {
    const usuario = userEvent.setup();
    const nova = contaApi({ id: 'api-9', nome: 'Claude (API)', modelo: 'claude-opus-4-1' });
    // O servidor guarda o que foi criado: o teste da conta relê a configuração e ela continua lá.
    let atual = config();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': () => atual,
      'POST /api/assistente/contas': () => (atual = config({ contas: [...config().contas, nova] })),
      'POST /api/assistente/contas/api-9/testar': { ok: true, versao: null, mensagem: 'A chave respondeu.', duracaoMs: 640 },
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: /Adicionar conta pelo plano/ }));
    await usuario.click(screen.getByRole('radio', { name: /Pela chave de API/ }));
    await usuario.click(screen.getByRole('radio', { name: /^Claude/ }));
    const form = screen.getByRole('form', { name: 'Nova conta da API da Anthropic' });
    expect(within(form).getByLabelText('Nome')).toHaveValue('Claude (API)');

    const modelo = within(form).getByLabelText('Modelo padrão (opcional)');
    modelo.focus();
    await usuario.keyboard('{ArrowDown}');
    const sugestoes = await screen.findByRole('listbox', { name: 'Sugestões' });
    expect(within(sugestoes).getAllByRole('option').map((o) => o.querySelector('.flutuante__rotulo')?.textContent)).toEqual(MODELOS_API.claude.map((m) => m.nome));
    await usuario.click(within(sugestoes).getByRole('option', { name: /Opus 4\.1/ }));
    expect(modelo).toHaveValue('claude-opus-4-1');

    await usuario.type(within(form).getByLabelText('Chave da API'), `  ${CHAVE_FALSA}  `);
    await usuario.click(within(form).getByRole('button', { name: 'Conectar conta' }));

    expect(corpos(chamadas, 'POST', '/api/assistente/contas')).toEqual([
      { tipo: 'api', provedor: 'claude', nome: 'Claude (API)', modelo: 'claude-opus-4-1', chave: CHAVE_FALSA },
    ]);
    expect(await screen.findByText('A chave respondeu.')).toBeInTheDocument();
    expect(screen.getByText('A chave respondeu.').closest('[role="status"]')).toBeInTheDocument();
    expect(chamadas.filter((c) => c.url === '/api/assistente/contas/api-9/testar')).toHaveLength(1);
    expect(screen.queryByRole('form', { name: /Nova conta/ })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(CHAVE_FALSA, { exact: false })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CHAVE_FALSA);
  });

  it('erro do servidor (400) aparece no formulário, sem fechar nem apagar a chave', async () => {
    const usuario = userEvent.setup();
    servidorFalso({
      'GET /api/assistente/config': config(),
      'POST /api/assistente/contas': () => new Response(JSON.stringify({ erro: 'A Anthropic recusou a chave.' }), { status: 400 }),
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: /Adicionar conta pelo plano/ }));
    await usuario.click(screen.getByRole('radio', { name: /Pela chave de API/ }));
    await usuario.click(screen.getByRole('radio', { name: /^Claude/ }));
    const form = screen.getByRole('form', { name: 'Nova conta da API da Anthropic' });
    await usuario.type(within(form).getByLabelText('Chave da API'), CHAVE_FALSA);
    await usuario.click(within(form).getByRole('button', { name: 'Conectar conta' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('A Anthropic recusou a chave.');
    expect(within(form).getByLabelText('Chave da API')).toHaveValue(CHAVE_FALSA);
  });

  it('nome repetido é recusado antes de mandar', async () => {
    const usuario = userEvent.setup();
    servidorFalso({ 'GET /api/assistente/config': comApi() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Adicionar conta da API da Anthropic' }));
    const form = screen.getByRole('form', { name: 'Nova conta da API da Anthropic' });
    const nome = within(form).getByLabelText('Nome');
    expect(nome).toHaveValue('Claude (API) 2');
    expect(nome).toHaveFocus();
    await usuario.clear(nome);
    await usuario.type(nome, 'claude pessoal');
    expect(within(form).getByRole('alert')).toHaveTextContent('Já existe uma conta com esse nome.');
  });

  it('a conta de API aparece na seção própria, com o selo API e o final da chave no lugar da pasta de login', async () => {
    servidorFalso({ 'GET /api/assistente/config': comApi(), 'GET /api/assistente/contas/api-1/modelos': { modelos: MODELOS_API.claude, aoVivo: true } });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude (API)');
    const secaoApi = screen.getByRole('region', { name: /Pela chave de API/ });
    const grupoApi = within(secaoApi).getByRole('region', { name: 'API da Anthropic' });
    const cartao = cartaoDa('Claude (API)');
    expect(grupoApi).toContainElement(cartao);
    expect(within(cartao).getByText('API')).toBeInTheDocument();
    expect(within(cartao).getByText('…AbCd')).toBeInTheDocument();
    expect(within(cartao).queryByText(/login/)).not.toBeInTheDocument();
    // O grupo do CLI continua só com as contas de CLI.
    expect(within(grupo('Claude Code')).queryByText('Claude (API)')).not.toBeInTheDocument();
  });

  it('detalhes da conta de API: modelo com a lista ao vivo, sem caminho nem pasta; "Trocar chave" manda PATCH { chave } e esvazia o campo', async () => {
    const usuario = userEvent.setup();
    const ao_vivo = [...MODELOS_API.claude, { id: 'claude-3-7-sonnet-latest', nome: 'claude-3-7-sonnet-latest', descricao: 'da API' }];
    const { chamadas } = servidorFalso({
      'GET /api/assistente/config': comApi(),
      'GET /api/assistente/contas/api-1/modelos': { modelos: ao_vivo, aoVivo: true },
      'PATCH /api/assistente/contas/api-1': () => comApi({ chaveFinal: '…0000' }),
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude (API)');
    const cartao = cartaoDa('Claude (API)');
    await usuario.click(within(cartao).getByRole('button', { name: 'Detalhes' }));
    expect(within(cartao).queryByLabelText('Caminho do programa')).not.toBeInTheDocument();
    expect(within(cartao).queryByLabelText('Pasta de login')).not.toBeInTheDocument();
    expect(await within(cartao).findByText('Lista atual da API da Anthropic.')).toBeInTheDocument();
    const modelo = within(cartao).getByLabelText('Modelo padrão');
    modelo.focus();
    await usuario.keyboard('{ArrowDown}');
    const lista = await screen.findByRole('listbox', { name: 'Sugestões' });
    expect(within(lista).getAllByRole('option')).toHaveLength(4);
    await usuario.keyboard('{Escape}');

    await usuario.click(within(cartao).getByRole('button', { name: 'Trocar chave' }));
    const chave = within(cartao).getByLabelText('Chave nova');
    expect(chave).toHaveFocus();
    expect(chave).toHaveAttribute('type', 'password');
    await usuario.type(chave, CHAVE_FALSA);
    await usuario.click(within(cartao).getByRole('button', { name: 'Salvar chave' }));
    expect(corpos(chamadas, 'PATCH', '/api/assistente/contas/api-1')).toEqual([{ chave: CHAVE_FALSA }]);
    await waitFor(() => expect(within(cartao).queryByLabelText('Chave nova')).not.toBeInTheDocument());
    expect(within(cartao).getAllByText('…0000').length).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toContain(CHAVE_FALSA);
    // Chave nova: a lista de modelos daquela conta é relida.
    await waitFor(() => expect(chamadas.filter((c) => c.url === '/api/assistente/contas/api-1/modelos').length).toBeGreaterThan(1));
  });

  it('trocar chave: o erro do servidor fica no campo e a chave digitada continua lá', async () => {
    const usuario = userEvent.setup();
    servidorFalso({
      'GET /api/assistente/config': comApi(),
      'GET /api/assistente/contas/api-1/modelos': { modelos: MODELOS_API.claude, aoVivo: false },
      'PATCH /api/assistente/contas/api-1': () => new Response(JSON.stringify({ erro: 'Chave inválida para a Anthropic.' }), { status: 400 }),
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude (API)');
    const cartao = cartaoDa('Claude (API)');
    await usuario.click(within(cartao).getByRole('button', { name: 'Detalhes' }));
    await usuario.click(within(cartao).getByRole('button', { name: 'Trocar chave' }));
    await usuario.type(within(cartao).getByLabelText('Chave nova'), CHAVE_FALSA);
    await usuario.click(within(cartao).getByRole('button', { name: 'Salvar chave' }));
    expect(await within(cartao).findByRole('alert')).toHaveTextContent('Chave inválida para a Anthropic.');
    expect(within(cartao).getByLabelText('Chave nova')).toHaveValue(CHAVE_FALSA);
  });

  it('remover conta de API avisa que a chave continua valendo no provedor', async () => {
    const usuario = userEvent.setup();
    servidorFalso({ 'GET /api/assistente/config': comApi() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await screen.findByText('Claude (API)');
    await usuario.click(within(cartaoDa('Claude (API)')).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('revogue-a lá');
  });

  it('sem conta de API: a seção convida a conectar, já no caminho da chave', async () => {
    const usuario = userEvent.setup();
    servidorFalso({ 'GET /api/assistente/config': config() });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Conectar com chave de API' }));
    const form = screen.getByRole('form', { name: 'Nova conta' });
    expect(within(form).getByRole('radio', { name: /Pela chave de API/ })).toBeChecked();
    expect(within(form).getByRole('radio', { name: /^Claude/ })).toHaveFocus();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conectar com chave de API' })).toHaveFocus());
  });
});

describe('AjustesAssistente · busca inteligente', () => {
  it('ativar chama a rota e o progresso aparece enquanto prepara', async () => {
    const usuario = userEvent.setup();
    const preparando = rag({ preparando: true, progresso: 0.45, etapa: 'Baixando o modelo (54 MB de 118 MB)' });
    const { chamadas } = servidorFalso({ 'GET /api/assistente/config': config(), 'POST /api/assistente/rag/ativar': preparando });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Ativar (baixa ~120 MB uma vez)' }));
    const barra = await screen.findByRole('progressbar', { name: 'Preparando a busca inteligente' });
    expect(barra).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByText(/Baixando o modelo \(54 MB de 118 MB\)/)).toBeInTheDocument();
    expect(chamadas.some((c) => c.url === '/api/assistente/rag/ativar')).toBe(true);
  });

  it('ativa: mostra contagem, Reindexar e o erro quando houver', async () => {
    servidorFalso({
      'GET /api/assistente/config': config({ rag: rag({ ativo: true, movimentosIndexados: 3400, trechosDeAnexos: 12, erro: 'Disco cheio ao indexar.' }) }),
    });
    montarComProvedores(<AjustesAssistente />, '/ajustes');
    expect(await screen.findByRole('button', { name: 'Reindexar' })).toBeInTheDocument();
    expect(screen.getByText(/3\.400 de 3\.400 movimentos indexados · 12 trechos de anexos/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Disco cheio ao indexar.');
  });
});
