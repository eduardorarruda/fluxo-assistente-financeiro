import { describe, expect, it, vi } from 'vitest';
import { ehFalhaDeCarregamento, recarregarUmaVez } from './recarga';

function memoria(): Pick<Storage, 'getItem' | 'setItem'> {
  const dados = new Map<string, string>();
  return { getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => void dados.set(k, v) };
}

describe('ehFalhaDeCarregamento', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://127.0.0.1:8778/assets/Extrato-abc.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
    "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of 'text/html'.",
    'Unable to preload CSS for /assets/x.css',
  ])('reconhece "%s"', (mensagem) => {
    expect(ehFalhaDeCarregamento(new TypeError(mensagem))).toBe(true);
  });

  it('não confunde erro comum de render com versão velha', () => {
    expect(ehFalhaDeCarregamento(new TypeError("Cannot read properties of undefined (reading 'total')"))).toBe(false);
    expect(ehFalhaDeCarregamento('texto solto')).toBe(false);
    expect(ehFalhaDeCarregamento(undefined)).toBe(false);
  });
});

describe('recarregarUmaVez', () => {
  it('recarrega na primeira falha', () => {
    const recarregar = vi.fn();
    expect(recarregarUmaVez({ agora: 1_000, armazenamento: memoria(), recarregar })).toBe(true);
    expect(recarregar).toHaveBeenCalledOnce();
  });

  it('não entra em laço: se acabou de recarregar, desiste e deixa a tela de erro aparecer', () => {
    const armazenamento = memoria();
    const recarregar = vi.fn();
    recarregarUmaVez({ agora: 1_000, armazenamento, recarregar });
    expect(recarregarUmaVez({ agora: 5_000, armazenamento, recarregar })).toBe(false);
    expect(recarregar).toHaveBeenCalledOnce();
  });

  it('depois de um tempo, pode recarregar de novo (outra versão nova)', () => {
    const armazenamento = memoria();
    const recarregar = vi.fn();
    recarregarUmaVez({ agora: 1_000, armazenamento, recarregar });
    expect(recarregarUmaVez({ agora: 61_000, armazenamento, recarregar })).toBe(true);
  });

  it('armazenamento bloqueado não impede a recarga', () => {
    const quebrado = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    const recarregar = vi.fn();
    expect(recarregarUmaVez({ agora: 1_000, armazenamento: quebrado, recarregar })).toBe(true);
  });

  it('ambiente em que só acessar o sessionStorage já lança (bloqueio de cookies) também recarrega', () => {
    const recarregar = vi.fn();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new DOMException('bloqueado', 'SecurityError'); } });
    try {
      expect(recarregarUmaVez({ agora: 1_000, recarregar })).toBe(true);
      expect(recarregar).toHaveBeenCalledOnce();
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    }
  });
});
