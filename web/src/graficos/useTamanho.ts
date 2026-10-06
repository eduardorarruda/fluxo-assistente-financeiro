import { useEffect, useRef, useState } from 'react';

/** Largura real do contêiner, atualizada ao redimensionar — os gráficos desenham no tamanho certo, sem esticar. */
export function useTamanho<T extends HTMLElement>(alturaPadrao: number) {
  const ref = useRef<T>(null);
  const [tamanho, setTamanho] = useState({ largura: 600, altura: alturaPadrao });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observador = new ResizeObserver(([e]) => {
      if (!e) return;
      const largura = Math.max(120, Math.round(e.contentRect.width));
      setTamanho((t) => (t.largura === largura ? t : { largura, altura: alturaPadrao }));
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, [alturaPadrao]);
  return { ref, ...tamanho };
}
