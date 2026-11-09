import { describe, expect, it } from 'vitest';
import { tituloDaPagina } from './titulo';

describe('tituloDaPagina', () => {
  it('usa o nome da tela da navegação', () => {
    expect(tituloDaPagina('/')).toBe('Visão geral · Fluxo');
    expect(tituloDaPagina('/assistente/abc')).toBe('Assistente · Fluxo');
    expect(tituloDaPagina('/ajustes')).toBe('Ajustes · Fluxo');
  });

  it('diz que a página não existe quando o caminho é desconhecido', () => {
    expect(tituloDaPagina('/nao-existe')).toBe('Página não encontrada · Fluxo');
  });
});
