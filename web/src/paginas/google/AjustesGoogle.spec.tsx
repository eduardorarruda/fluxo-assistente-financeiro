import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EstadoGoogle } from '../../api/google';
import { montarComProvedores } from '../../testes/ambiente';
import { servidorFalso } from '../../testes/fixtures/assistente';
import { AjustesGoogle } from './AjustesGoogle';
import { lerJsonDoCliente } from './CredenciaisGoogle';

configure({ asyncUtilTimeout: 5000 });

const ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const SEGREDO = 'GOCSPX-segredo_de_teste-AbCdEf123456';
const URL_GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc';

const estado = (p: Partial<EstadoGoogle> = {}): EstadoGoogle => ({
  configurado: false, clienteId: null, conectado: false, email: null, agendaId: null, ultimaSincronizacao: null, sincronizando: false,
  erro: null, precisaReconectar: false, eventos: 0, enderecoDeRetorno: 'http://127.0.0.1:8778/api/google/retorno', contasDisponiveis: true,
  preferencias: { cartao: true, contas: true, atrasos: true, hora: 9, antecedencias: [2, 1] },
  ...p,
});
const configurado = estado({ configurado: true, clienteId: '123456…apps.googleusercontent.com' });
const conectado = estado({
  ...configurado, conectado: true, email: 'pessoa@gmail.com', agendaId: 'ag@group.calendar.google.com', eventos: 14,
  ultimaSincronizacao: new Date(Date.now() - 5 * 60_000).toISOString(),
});

describe('AjustesGoogle', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sem credenciais: guia aberto com os links do Google Cloud e o campo do secret é de senha', async () => {
    servidorFalso({ 'GET /api/google/estado': estado() });
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    expect(await screen.findByText('Não configurado')).toBeInTheDocument();
    expect(screen.getByText(/não vê nem altera os seus outros compromissos/)).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(expect.arrayContaining([
      'https://console.cloud.google.com/projectcreate',
      'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
      'https://console.cloud.google.com/auth/branding',
      'https://console.cloud.google.com/auth/audience',
      'https://console.cloud.google.com/auth/clients/create',
    ]));
    expect(screen.getByText(/derruba a autorização depois de 7 dias/)).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:8778/api/google/retorno')).toBeInTheDocument();
    const segredo = screen.getByLabelText('Chave secreta do cliente');
    expect(segredo).toHaveAttribute('type', 'password');
    expect(segredo).toHaveAttribute('autocomplete', 'off');
  });

  it('salva as credenciais (PUT sem espaços) e nunca mostra o secret de volta', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ 'GET /api/google/estado': estado(), 'PUT /api/google/cliente': configurado });
    const { container } = montarComProvedores(<AjustesGoogle />, '/ajustes');
    await usuario.type(await screen.findByLabelText('ID do cliente'), ` ${ID} `);
    await usuario.type(screen.getByLabelText('Chave secreta do cliente'), SEGREDO);
    await usuario.click(screen.getByRole('button', { name: 'Salvar credenciais' }));
    expect(chamadas.filter((c) => c.metodo === 'PUT').map((c) => c.corpo)).toEqual([{ clientId: ID, clientSecret: SEGREDO }]);
    expect(await screen.findByText(/Credenciais salvas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar com o Google' })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SEGREDO);
  });

  it('formato errado avisa e não manda nada; colar o JSON do Google preenche os dois campos', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({ 'GET /api/google/estado': estado() });
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    const id = await screen.findByLabelText('ID do cliente');
    await usuario.type(id, 'meu-projeto');
    await usuario.type(screen.getByLabelText('Chave secreta do cliente'), 'abc');
    await usuario.click(screen.getByRole('button', { name: 'Salvar credenciais' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/termina em \.apps\.googleusercontent\.com/);
    expect(chamadas.some((c) => c.metodo === 'PUT')).toBe(false);

    fireEvent.change(id, { target: { value: JSON.stringify({ installed: { client_id: ID, client_secret: SEGREDO, project_id: 'fluxo' } }) } });
    expect(id).toHaveValue(ID);
    expect(screen.getByLabelText('Chave secreta do cliente')).toHaveValue(SEGREDO);
    expect(lerJsonDoCliente('{"web":{"client_id":"a","client_secret":"b"}}')).toEqual({ clientId: 'a', clientSecret: 'b' });
    expect(lerJsonDoCliente('{quebrado')).toBeNull();
    expect(lerJsonDoCliente('123')).toBeNull();
  });

  it('conectar: abre a janelinha no clique, manda a URL do Google para ela e espera; o aviso da janela conclui', async () => {
    const usuario = userEvent.setup();
    const janela = { closed: false, location: { href: 'about:blank' }, close: vi.fn() };
    const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
    let atual = configurado;
    const { chamadas } = servidorFalso({ 'GET /api/google/estado': () => atual, 'POST /api/google/conectar': { url: URL_GOOGLE } });
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Conectar com o Google' }));
    expect(abrir).toHaveBeenCalledWith('about:blank', 'fluxo-google', expect.stringContaining('popup'));
    expect(await screen.findByText('Termine na janela do Google')).toBeInTheDocument();
    expect(janela.location.href).toBe(URL_GOOGLE);
    expect(chamadas.some((c) => c.metodo === 'POST' && c.url === '/api/google/conectar')).toBe(true);

    // Mensagem de outra origem é ignorada.
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { tipo: 'fluxo-google', resultado: 'ok' } })));
    expect(screen.getByText('Termine na janela do Google')).toBeInTheDocument();

    atual = conectado;
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { tipo: 'fluxo-google', resultado: 'ok' } })));
    expect(await screen.findByText('pessoa@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('Termine na janela do Google')).not.toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
  });

  it('pop-up bloqueado: oferece o link para abrir a página do Google', async () => {
    const usuario = userEvent.setup();
    vi.spyOn(window, 'open').mockReturnValue(null);
    servidorFalso({ 'GET /api/google/estado': configurado, 'POST /api/google/conectar': { url: URL_GOOGLE } });
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    await usuario.click(await screen.findByRole('button', { name: 'Conectar com o Google' }));
    expect(await screen.findByRole('link', { name: /Abrir a página do Google/ })).toHaveAttribute('href', URL_GOOGLE);
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Conectar com o Google' })).toBeInTheDocument();
  });

  it('conectado: conta, eventos e última sincronização; "Sincronizar agora" e desconectar apagando a agenda', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/google/estado': conectado,
      'POST /api/google/sincronizar': conectado,
      'POST /api/google/desconectar': { ...configurado, aviso: null },
    });
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    expect(await screen.findByText('pessoa@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/14 eventos · sincronizada há 5 min/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir o Google Agenda/ })).toHaveAttribute('href', 'https://calendar.google.com/calendar/r');
    await usuario.click(screen.getByRole('button', { name: 'Sincronizar agora' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'POST' && c.url === '/api/google/sincronizar')).toBe(true));

    await usuario.click(screen.getByRole('button', { name: 'Desconectar' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/14 eventos/)).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('switch', { name: 'Apagar também a agenda Fluxo' }));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(chamadas.find((c) => c.url === '/api/google/desconectar')?.corpo).toEqual({ apagarAgenda: true }));
    expect(await screen.findByRole('button', { name: 'Conectar com o Google' })).toBeInTheDocument();
  });

  it('autorização expirada: selo "Reconecte", o motivo e o botão "Conectar de novo"', async () => {
    servidorFalso({ 'GET /api/google/estado': { ...configurado, precisaReconectar: true, erro: 'O Google não aceitou mais a autorização. Conecte de novo.' } });
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    expect(await screen.findByText('Reconecte')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('não aceitou mais a autorização');
    expect(screen.getByRole('button', { name: 'Conectar de novo' })).toBeInTheDocument();
  });

  it('preferências: interruptores e dias mandam só o que mudou; horário pelo Seletor do Fluxo', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/google/estado': conectado,
      'PUT /api/google/preferencias': (c: { corpo: unknown }) => ({ ...conectado, preferencias: { ...conectado.preferencias, ...(c.corpo as object) } }),
    });
    const { container } = montarComProvedores(<AjustesGoogle />, '/ajustes');
    await usuario.click(await screen.findByRole('switch', { name: 'Cartão de crédito na agenda' }));
    await usuario.click(screen.getByRole('button', { name: '1 semana antes' }));
    expect(screen.getByRole('button', { name: '1 semana antes' })).toHaveAttribute('aria-pressed', 'true');
    await usuario.click(screen.getByRole('button', { name: 'Na véspera' }));
    await usuario.click(screen.getByRole('combobox', { name: 'Horário dos avisos' }));
    await usuario.click(await screen.findByRole('option', { name: /^7h/ }));
    expect(chamadas.filter((c) => c.metodo === 'PUT').map((c) => c.corpo)).toEqual([
      { cartao: false }, { antecedencias: [2, 1, 7] }, { antecedencias: [2, 7] }, { hora: 7 },
    ]);
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByText(/só deixa um evento assim avisar/)).toBeInTheDocument();
  });

  it('erro ao ler o estado: mensagem e "Tentar de novo"', async () => {
    servidorFalso({});
    montarComProvedores(<AjustesGoogle />, '/ajustes');
    expect(await screen.findByText(/Não deu para ler o estado do Google Agenda/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });
});
