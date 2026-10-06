import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { definirEstadoVozNatural, type EstadoVozNatural, type VozNatural } from '../../api/voz-natural';
import { montarComProvedores } from '../../testes/ambiente';
import { servidorFalso } from '../../testes/fixtures/assistente';
import { AjusteVoz } from './AjusteVoz';
import { mudancaDaVoz, opcoesDeVozComNaturais, valorDaVoz } from './voz/opcoes-voz';
import { PREFERENCIAS_PADRAO, recarregarPreferenciasVoz } from './voz/preferencias-voz';

configure({ asyncUtilTimeout: 5000 });

const voz = (p: Partial<VozNatural>): VozNatural => ({
  id: 'faber', nome: 'Faber', genero: 'masculina', qualidade: 'média', descricao: 'Clara e calma.', tamanhoMb: 64,
  licenca: 'Dados CC0', credito: 'Open Home Foundation', naoComercial: false, instalada: false, ...p,
});

const estado = (p: Partial<EstadoVozNatural> = {}): EstadoVozNatural => ({
  instalada: false, baixando: false, vozBaixando: null, etapa: null, progresso: null, vozPadrao: 'faber', erro: null,
  vozes: [voz({}), voz({ id: 'dii', nome: 'Dii', genero: 'feminina', qualidade: 'alta', licenca: 'CC BY-NC-ND 4.0 (uso pessoal, não comercial)', credito: 'TigreGotico Lda', naoComercial: true })],
  ...p,
});

const cartao = (nome: string) => screen.getByRole('listitem', { name: `Voz ${nome}` });

describe('Ajustes · voz natural (Piper)', () => {
  beforeEach(() => {
    localStorage.clear();
    recarregarPreferenciasVoz();
    definirEstadoVozNatural(null);
  });

  it('mostra cada voz com gênero, qualidade, tamanho e licença; "Baixar" manda só o id do catálogo e mostra o progresso', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = servidorFalso({
      'GET /api/assistente/voz': estado(),
      'POST /api/assistente/voz/baixar': estado({ baixando: true, vozBaixando: 'faber', etapa: 'baixando', progresso: 0.42 }),
    });
    montarComProvedores(<AjusteVoz />, '/ajustes');
    await screen.findByText('Faber');

    expect(within(cartao('Faber')).getByText('Masculina · qualidade média')).toBeInTheDocument();
    expect(within(cartao('Faber')).getByText('Recomendada')).toBeInTheDocument();
    expect(within(cartao('Dii')).getByText(/CC BY-NC-ND 4.0/)).toBeInTheDocument();
    expect(within(cartao('Dii')).getByText(/TigreGotico Lda/)).toBeInTheDocument();
    expect(within(cartao('Dii')).queryByRole('button', { name: /Ouvir/ })).not.toBeInTheDocument(); // só as instaladas

    await usuario.click(within(cartao('Faber')).getByRole('button', { name: 'Baixar (~64 MB)' }));
    expect(chamadas.find((c) => c.metodo === 'POST')).toMatchObject({ url: '/api/assistente/voz/baixar', corpo: { voz: 'faber' } });
    expect(await within(cartao('Faber')).findByRole('progressbar', { name: 'Baixando… 42%' })).toBeInTheDocument();
    expect(within(cartao('Dii')).getByRole('button', { name: 'Baixar (~64 MB)' })).toBeDisabled(); // uma por vez
  });

  it('instalada: "Em uso", Ouvir e Remover; outra instalada pode passar a ser a usada', async () => {
    const usuario = userEvent.setup();
    const instaladas = estado({ instalada: true, vozes: estado().vozes.map((v) => ({ ...v, instalada: true })) });
    const { chamadas } = servidorFalso({
      'GET /api/assistente/voz': instaladas,
      'DELETE /api/assistente/voz/dii': estado({ instalada: true, vozes: [voz({ instalada: true }), voz({ id: 'dii', nome: 'Dii' })] }),
    });
    montarComProvedores(<AjusteVoz />, '/ajustes');
    await screen.findByText('Faber');

    expect(within(cartao('Faber')).getByText('Em uso')).toBeInTheDocument();
    expect(within(cartao('Faber')).getByRole('button', { name: 'Ouvir' })).toBeInTheDocument();
    expect(screen.getByText('Com a voz natural Faber')).toBeInTheDocument();

    await usuario.click(within(cartao('Dii')).getByRole('button', { name: 'Usar esta voz' }));
    expect(within(cartao('Dii')).getByText('Em uso')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('fluxo:voz') ?? '{}')).toMatchObject({ motorFala: 'piper', vozNatural: 'dii' });

    await usuario.click(within(cartao('Dii')).getByRole('button', { name: 'Remover a voz Dii' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE' && c.url === '/api/assistente/voz/dii')).toBe(true));
    expect(await within(cartao('Faber')).findByText('Em uso')).toBeInTheDocument(); // a removida sai; a padrão assume
  });

  it('escolher "Voz do navegador" desliga a natural (fica como reserva)', async () => {
    const usuario = userEvent.setup();
    servidorFalso({ 'GET /api/assistente/voz': estado({ instalada: true, vozes: [voz({ instalada: true })] }) });
    montarComProvedores(<AjusteVoz />, '/ajustes');
    await screen.findByText('Faber');
    await usuario.click(screen.getByRole('radio', { name: /Voz do navegador/ }));
    expect(within(cartao('Faber')).queryByText('Em uso')).not.toBeInTheDocument();
    expect(screen.getByText('Com a voz do navegador')).toBeInTheDocument();
  });

  it('servidor sem a rota de voz: a seção diz que não carregou e o resto continua', async () => {
    servidorFalso({});
    montarComProvedores(<AjusteVoz />, '/ajustes');
    expect(await screen.findByText(/Sem rota falsa/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Voz natural/ })).toBeInTheDocument();
  });
});

describe('Seletor de voz com as naturais', () => {
  const naturais = [voz({ instalada: true }), voz({ id: 'dii', nome: 'Dii', instalada: false })];
  const navegador = [{ voiceURI: 'g', name: 'Google português do Brasil', lang: 'pt-BR', localService: false }];

  it('as naturais instaladas vêm primeiro; as do navegador ficam agrupadas como reserva', () => {
    const opcoes = opcoesDeVozComNaturais(navegador, naturais);
    expect(opcoes.map((o) => o.valor)).toEqual(['natural:faber', '', 'g']);
    expect(opcoes[0]).toMatchObject({ rotulo: 'Faber', grupo: 'Voz natural (no computador)' });
    expect(opcoes[2]?.grupo).toBe('Voz do navegador · Português (Brasil)');
    expect(opcoesDeVozComNaturais(navegador, []).map((o) => o.valor)).toEqual(['', 'g']);
  });

  it('valor e mudança: natural liga o Piper; do navegador, desliga', () => {
    const e = estado({ instalada: true, vozes: naturais });
    expect(valorDaVoz(PREFERENCIAS_PADRAO, e)).toBe('natural:faber');
    expect(valorDaVoz({ ...PREFERENCIAS_PADRAO, motorFala: 'navegador', voz: 'g' }, e)).toBe('g');
    expect(mudancaDaVoz('natural:dii')).toEqual({ motorFala: 'piper', vozNatural: 'dii' });
    expect(mudancaDaVoz('')).toEqual({ motorFala: 'navegador', voz: null });
  });
});
