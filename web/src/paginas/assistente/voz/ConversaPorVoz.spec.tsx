import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { Conversa, Mensagem } from '../../../api/tipos-assistente';
import { criarMotorFalso, instalarReconhecimentoFalso, ReconhecimentoFalso, removerReconhecimentoFalso } from '../../../testes/voz-falsa';
import { ModoConversa } from './ModoConversa';
import { recarregarPreferenciasVoz } from './preferencias-voz';
import { reiniciarSituacaoLocal } from './reconhecimento';
import { type ResultadoEnvioVoz, useConversaPorVoz } from './useConversaPorVoz';

const mensagem = (p: Partial<Mensagem>): Mensagem => ({
  id: 'm', papel: 'assistente', texto: '', passos: [], anexos: [], situacao: 'ok', erro: null, contaId: 'claude', contaNome: 'Claude',
  provedor: 'claude', modelo: null, uso: null, criadaEm: '2026-10-02T12:00:00Z', ...p,
});

const conversa = (mensagens: Mensagem[] = [], execucaoAtiva: string | null = null): Conversa => ({
  id: 'c1', titulo: 'Gastos', contaId: 'claude', contaNome: 'Claude', provedor: 'claude', modelo: null, fixada: false,
  gerando: Boolean(execucaoAtiva), previa: '', criadaEm: '', atualizadaEm: '', mensagens, execucaoAtiva,
} as Conversa);

const pergunta = mensagem({ id: 'u1', papel: 'usuario', texto: 'quanto gastei' });
const resposta = (p: Partial<Mensagem>) => mensagem({ id: 'r1', situacao: 'gerando', ...p });

/** A tela vive dentro do QueryClientProvider do app (a proposta pendente vem de uma consulta). */
const comConsultas = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

/** Deixa as promessas pendentes (envio, disponibilidade) resolverem dentro do act. */
const esvaziarPromessas = () => act(async () => {});

function montarLaco(
  enviar: () => Promise<ResultadoEnvioVoz> = async () => ({ execucaoId: 'x1', respostaId: 'r1' }),
  { semConversa = false, estrito = false } = {},
) {
  const falso = criarMotorFalso();
  const aoEnviar = vi.fn(enviar);
  const aoCancelar = vi.fn();
  const hook = renderHook(({ c }: { c: Conversa | undefined }) => useConversaPorVoz({ conversa: c, aoEnviar, aoCancelar, motor: falso.motor }), {
    initialProps: { c: semConversa ? undefined : conversa() },
    ...(estrito ? { wrapper: StrictMode } : {}),
  });
  return { ...hook, falso, aoEnviar, aoCancelar };
}

describe('laço do modo conversação', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    instalarReconhecimentoFalso();
    localStorage.clear();
    recarregarPreferenciasVoz();
  });
  afterEach(() => {
    vi.useRealTimers();
    removerReconhecimentoFalso();
    reiniciarSituacaoLocal();
  });

  it('ouve, envia no silêncio com a pergunta, lê a resposta frase a frase e volta a ouvir', async () => {
    const { result, rerender, falso, aoEnviar } = montarLaco();
    await esvaziarPromessas();
    expect(result.current.estado.fase).toBe('ouvindo');
    const primeira = ReconhecimentoFalso.ultima;
    expect(primeira.ligado).toBe(true);

    act(() => primeira.ouvir([['quanto gastei', true]]));
    act(() => vi.advanceTimersByTime(1100));
    expect(aoEnviar).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    await esvaziarPromessas();
    expect(aoEnviar).toHaveBeenCalledWith('quanto gastei');
    expect(result.current.estado.fase).toBe('pensando');
    expect(primeira.ligado).toBe(false); // não ouve enquanto o assistente responde

    rerender({ c: conversa([pergunta, resposta({ texto: 'Você gastou R$ 3.210,00. O mai', passos: [{ id: 'p', nome: 'resumo_do_mes', rotulo: 'Resumo de set/2026', entrada: {}, situacao: 'rodando', resultado: null }] })], 'x1') });
    expect(falso.faladas.map((f) => f.trecho)).toEqual(['Você gastou R$ 3.210,00.']);
    expect(result.current.estado.passo).toBe('Resumo de set/2026');

    act(() => falso.comecarProxima());
    expect(result.current.estado).toMatchObject({ fase: 'falando', legenda: 'Você gastou R$ 3.210,00.' });

    rerender({ c: conversa([pergunta, resposta({ texto: 'Você gastou R$ 3.210,00. O maior foi mercado.\n\n```grafico\n{}\n```', situacao: 'ok' })]) });
    expect(falso.faladas.map((f) => f.trecho)).toEqual(['Você gastou R$ 3.210,00.', 'O maior foi mercado.']);
    expect(result.current.estado.respostaAcabou).toBe(true);

    act(() => falso.terminarAtual());
    act(() => falso.comecarProxima());
    expect(result.current.estado.legenda).toBe('O maior foi mercado.');
    act(() => falso.terminarAtual());
    expect(result.current.estado.fase).toBe('ouvindo');
    expect(ReconhecimentoFalso.ultima).not.toBe(primeira);
    expect(ReconhecimentoFalso.ultima.ligado).toBe(true);
  });

  it('interromper cala a voz, cancela a resposta que ainda chega e volta a ouvir', async () => {
    const { result, rerender, falso, aoCancelar } = montarLaco();
    await esvaziarPromessas();
    act(() => ReconhecimentoFalso.ultima.ouvir([['oi', true]]));
    act(() => result.current.tocar()); // tocar na esfera com fala pendente = enviar já
    await esvaziarPromessas();
    rerender({ c: conversa([pergunta, resposta({ texto: 'Olá! Tudo certo por aqui. E' })], 'x1') });
    act(() => falso.comecarProxima());
    expect(result.current.estado.fase).toBe('falando');

    act(() => result.current.tocar());
    expect(aoCancelar).toHaveBeenCalledWith('x1');
    expect(result.current.estado).toMatchObject({ fase: 'ouvindo', legenda: '' });
    expect(falso.motor.ocupado()).toBe(false);
  });

  it('mudo pausa o reconhecimento e não envia nada', async () => {
    const { result, aoEnviar } = montarLaco();
    await esvaziarPromessas();
    const r = ReconhecimentoFalso.ultima;
    act(() => result.current.alternarMudo());
    expect(r.ligado).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(aoEnviar).not.toHaveBeenCalled();
    act(() => result.current.alternarMudo());
    expect(ReconhecimentoFalso.ultima.ligado).toBe(true);
  });

  it('resposta com erro é dita em uma frase curta e o motivo fica na tela', async () => {
    const { result, rerender, falso } = montarLaco();
    await esvaziarPromessas();
    act(() => ReconhecimentoFalso.ultima.ouvir([['oi', true]]));
    act(() => vi.advanceTimersByTime(1300));
    await esvaziarPromessas();
    rerender({ c: conversa([pergunta, resposta({ situacao: 'erro', erro: 'O login do Claude expirou.' })]) });
    expect(falso.faladas.at(-1)?.trecho).toMatch(/Não consegui responder/);
    expect(result.current.estado.aviso).toBe('O login do Claude expirou.');
  });

  it('falha no envio volta a ouvir com o aviso', async () => {
    const { result } = montarLaco(async () => ({ erro: 'Ainda há uma resposta em andamento nesta conversa.' }));
    await esvaziarPromessas();
    act(() => ReconhecimentoFalso.ultima.ouvir([['oi', true]]));
    act(() => vi.advanceTimersByTime(1300));
    await esvaziarPromessas();
    expect(result.current.estado).toMatchObject({ fase: 'ouvindo', aviso: 'Ainda há uma resposta em andamento nesta conversa.' });
  });

  it('microfone bloqueado vira erro com a explicação', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('negado', 'NotAllowedError');
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    try {
      const { result } = montarLaco();
      await esvaziarPromessas();
      expect(result.current.estado.fase).toBe('erro');
      expect(result.current.estado.erro).toMatch(/microfone está bloqueado/);
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
});

describe('tela do modo conversação', () => {
  beforeEach(() => {
    instalarReconhecimentoFalso();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    removerReconhecimentoFalso();
    reiniciarSituacaoLocal();
  });

  it('mostra o estado, pausa pelo botão do microfone e fecha com Esc', async () => {
    const aoFechar = vi.fn();
    render(comConsultas(<ModoConversa conversa={conversa()} quemResponde="Claude pessoal · sonnet" aoEnviar={vi.fn()} aoCancelar={vi.fn()} aoFechar={aoFechar} />));
    expect(screen.getByRole('dialog', { name: 'Conversa por voz' })).toBeInTheDocument();
    expect(await screen.findByText('Ouvindo…')).toBeInTheDocument();
    expect(screen.getByText('Claude pessoal · sonnet')).toBeInTheDocument();
    expect(screen.getByText('Google (online)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pausar o microfone (M)' }));
    expect(await screen.findByText('Pausado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ligar o microfone' })).toBeInTheDocument(); // a esfera vira "ligar"

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(aoFechar).toHaveBeenCalledOnce();
  });

  it('as falas da pessoa aparecem como legenda ao vivo', async () => {
    render(comConsultas(<ModoConversa conversa={conversa()} quemResponde={null} aoEnviar={vi.fn()} aoCancelar={vi.fn()} aoFechar={vi.fn()} />));
    await screen.findByText('Ouvindo…');
    act(() => ReconhecimentoFalso.ultima.ouvir([['quanto gastei', true], [' no mercado', false]]));
    expect(screen.getByText(/quanto gastei/)).toBeInTheDocument();
    expect(screen.getByText('no mercado')).toHaveClass('modo-voz__provisorio');
    expect(screen.getByRole('button', { name: 'Enviar agora' })).toBeInTheDocument();
  });
});

describe('laço do modo conversação: efeitos que não podem repetir nem se perder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    instalarReconhecimentoFalso();
    localStorage.clear();
    recarregarPreferenciasVoz();
  });
  afterEach(() => {
    vi.useRealTimers();
    removerReconhecimentoFalso();
    reiniciarSituacaoLocal();
  });

  it('no StrictMode, cada pergunta é enviada uma vez só (cada envio é uma resposta de verdade)', async () => {
    const { result, aoEnviar, aoCancelar } = montarLaco(undefined, { estrito: true });
    await esvaziarPromessas();
    act(() => ReconhecimentoFalso.ultima.ouvir([['quanto gastei', true]]));
    act(() => vi.advanceTimersByTime(1200));
    await esvaziarPromessas();
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(aoCancelar).not.toHaveBeenCalled();
    expect(result.current.estado.fase).toBe('pensando');
  });

  it('abriu antes de a conversa carregar: quando ela chega com resposta em andamento, passa a acompanhá-la', async () => {
    const { result, rerender } = montarLaco(undefined, { semConversa: true });
    await esvaziarPromessas();
    expect(result.current.estado.respostaId).toBeFalsy();
    rerender({ c: conversa([pergunta, resposta({ texto: 'Calculando' })], 'x9') });
    expect(result.current.estado.respostaId).toBe('r1');
  });

  it('fechar um aviso enquanto espera o silêncio não recomeça a contagem para enviar', async () => {
    const { result, aoEnviar } = montarLaco();
    await esvaziarPromessas();
    act(() => ReconhecimentoFalso.ultima.ouvir([['oi', true]]));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.limparAviso());
    act(() => vi.advanceTimersByTime(200));
    await esvaziarPromessas();
    expect(aoEnviar).toHaveBeenCalledWith('oi');
  });
});
