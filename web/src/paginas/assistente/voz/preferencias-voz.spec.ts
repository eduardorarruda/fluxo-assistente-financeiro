import { act, renderHook } from '@testing-library/react';
import {
  lerPreferenciasVoz, mudarPreferenciasVoz, normalizarPreferencias, PREFERENCIAS_PADRAO, recarregarPreferenciasVoz, usePreferenciasVoz,
} from './preferencias-voz';

describe('preferências de voz', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    recarregarPreferenciasVoz();
  });

  it('sem nada salvo, vale o padrão', () => {
    expect(lerPreferenciasVoz()).toEqual(PREFERENCIAS_PADRAO);
  });

  it('JSON corrompido ou valores fora do limite viram valores válidos', () => {
    localStorage.setItem('fluxo:voz', '{isto não é json');
    expect(lerPreferenciasVoz()).toEqual(PREFERENCIAS_PADRAO);
    expect(normalizarPreferencias({ reconhecimento: 'marte', velocidade: 9, silencioMs: 10, falarRespostas: 'sim', voz: 42 })).toEqual({
      ...PREFERENCIAS_PADRAO,
      velocidade: 1.5,
      silencioMs: 800,
    });
  });

  it('motor da fala: piper por padrão, navegador quando escolhido; voz natural só com id bem formado', () => {
    expect(PREFERENCIAS_PADRAO).toMatchObject({ motorFala: 'piper', vozNatural: null });
    expect(normalizarPreferencias({ motorFala: 'navegador', vozNatural: 'dii' })).toMatchObject({ motorFala: 'navegador', vozNatural: 'dii' });
    expect(normalizarPreferencias({ motorFala: 'outro', vozNatural: '../../x' })).toMatchObject({ motorFala: 'piper', vozNatural: null });
  });

  it('localStorage que lança (bloqueado) não quebra: lê o padrão e a mudança vale na memória', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    recarregarPreferenciasVoz();
    const { result } = renderHook(() => usePreferenciasVoz());
    expect(result.current[0]).toEqual(PREFERENCIAS_PADRAO);
    act(() => result.current[1]({ velocidade: 1.25, reconhecimento: 'nuvem' }));
    expect(result.current[0]).toMatchObject({ velocidade: 1.25, reconhecimento: 'nuvem' });
  });

  it('salva e avisa todos os que usam (ajustes e modo conversação ficam iguais)', () => {
    const a = renderHook(() => usePreferenciasVoz());
    const b = renderHook(() => usePreferenciasVoz());
    act(() => {
      mudarPreferenciasVoz({ voz: 'Google português do Brasil', silencioMs: 1500 });
    });
    expect(b.result.current[0]).toMatchObject({ voz: 'Google português do Brasil', silencioMs: 1500 });
    expect(a.result.current[0]).toBe(b.result.current[0]);
    expect(JSON.parse(localStorage.getItem('fluxo:voz') ?? '{}')).toMatchObject({ voz: 'Google português do Brasil', silencioMs: 1500 });
  });
});
