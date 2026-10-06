import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Onde desenhar uma lista flutuante (dropdown) presa a um elemento: embaixo
 * dele, ou em cima quando não cabe; nunca para fora da janela. Acompanha
 * rolagem e redimensionamento enquanto está aberta.
 */

export type Lado = 'baixo' | 'cima';

export interface PosicaoFlutuante {
  estilo: CSSProperties;
  lado: Lado;
}

const MARGEM = 8;
const AFASTAMENTO = 6;
const ALTURA_MAXIMA = 340;
const ALTURA_MINIMA_PREFERIDA = 180;

export function calcularPosicao(ancora: DOMRect, janela: { largura: number; altura: number }, alinhar: 'inicio' | 'fim'): PosicaoFlutuante {
  const espacoAbaixo = janela.altura - ancora.bottom - MARGEM - AFASTAMENTO;
  const espacoAcima = ancora.top - MARGEM - AFASTAMENTO;
  const lado: Lado = espacoAbaixo >= Math.min(ALTURA_MINIMA_PREFERIDA, ALTURA_MAXIMA) || espacoAbaixo >= espacoAcima ? 'baixo' : 'cima';
  const alturaMaxima = Math.max(120, Math.min(ALTURA_MAXIMA, lado === 'baixo' ? espacoAbaixo : espacoAcima));
  const larguraMinima = Math.min(Math.max(ancora.width, 200), janela.largura - MARGEM * 2);
  const vertical: CSSProperties = lado === 'baixo'
    ? { top: ancora.bottom + AFASTAMENTO }
    : { bottom: janela.altura - ancora.top + AFASTAMENTO };
  const horizontal: CSSProperties = alinhar === 'inicio'
    ? { left: Math.max(MARGEM, Math.min(ancora.left, janela.largura - larguraMinima - MARGEM)) }
    : { right: Math.max(MARGEM, janela.largura - ancora.right) };
  return {
    lado,
    estilo: {
      position: 'fixed',
      ...vertical,
      ...horizontal,
      minWidth: larguraMinima,
      maxWidth: janela.largura - MARGEM * 2,
      maxHeight: alturaMaxima,
      transformOrigin: `${alinhar === 'inicio' ? 'left' : 'right'} ${lado === 'baixo' ? 'top' : 'bottom'}`,
    },
  };
}

export function usePosicaoFlutuante(ancora: RefObject<HTMLElement | null>, aberto: boolean, alinhar: 'inicio' | 'fim' = 'inicio'): PosicaoFlutuante | null {
  const [posicao, setPosicao] = useState<PosicaoFlutuante | null>(null);

  useLayoutEffect(() => {
    if (!aberto || !ancora.current) return setPosicao(null);
    setPosicao(calcularPosicao(ancora.current.getBoundingClientRect(), { largura: window.innerWidth, altura: window.innerHeight }, alinhar));
  }, [aberto, ancora, alinhar]);

  useEffect(() => {
    if (!aberto) return;
    let quadro = 0;
    const atualizar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        if (ancora.current) setPosicao(calcularPosicao(ancora.current.getBoundingClientRect(), { largura: window.innerWidth, altura: window.innerHeight }, alinhar));
      });
    };
    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, true);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar, true);
    };
  }, [aberto, ancora, alinhar]);

  return posicao;
}

const LARGURA_SUBMENU = 220;

/** Submenu ao lado de uma opção: à direita se couber, senão à esquerda; alinhado ao topo da opção. */
export function posicaoLateral(opcao: DOMRect, janela: { largura: number; altura: number }): CSSProperties {
  const cabeADireita = opcao.right + AFASTAMENTO + LARGURA_SUBMENU + MARGEM <= janela.largura;
  const alturaMaxima = Math.min(ALTURA_MAXIMA, janela.altura - MARGEM * 2);
  const topo = Math.max(MARGEM, Math.min(opcao.top - 6, janela.altura - MARGEM - alturaMaxima));
  return {
    position: 'fixed',
    top: topo,
    ...(cabeADireita ? { left: opcao.right + AFASTAMENTO } : { right: janela.largura - opcao.left + AFASTAMENTO }),
    minWidth: LARGURA_SUBMENU,
    maxHeight: alturaMaxima,
    transformOrigin: cabeADireita ? 'left top' : 'right top',
  };
}

/** Fecha quando o ponteiro desce fora dos elementos dados (o gatilho e a lista). */
export function useCliqueFora(aberto: boolean, dentro: readonly RefObject<HTMLElement | null>[], fechar: () => void): void {
  useEffect(() => {
    if (!aberto) return;
    const aoApertar = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!dentro.some((r) => r.current?.contains(alvo))) fechar();
    };
    document.addEventListener('pointerdown', aoApertar, true);
    return () => document.removeEventListener('pointerdown', aoApertar, true);
  }, [aberto, dentro, fechar]);
}
