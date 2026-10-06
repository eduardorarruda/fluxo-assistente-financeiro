import { useEffect, useRef } from 'react';

/**
 * Chama `aCadaQuadro(tempoEmSegundos)` a cada quadro enquanto `ativo`. Serve para
 * animar direto no DOM/canvas pelo nível do microfone, sem renderizar o React 60
 * vezes por segundo. O retorno mais recente é sempre o usado.
 */
export function useQuadros(aCadaQuadro: (t: number) => void, ativo: boolean): void {
  const retorno = useRef(aCadaQuadro);
  retorno.current = aCadaQuadro;
  useEffect(() => {
    if (!ativo || typeof requestAnimationFrame !== 'function') return;
    let quadro = 0;
    const passo = (agora: number) => {
      retorno.current(agora / 1000);
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [ativo]);
}
