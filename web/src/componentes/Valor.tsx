import { animate, useInView, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Centavos } from '../api/tipos';
import { reais } from '../util/formato';

interface Props {
  centavos: Centavos;
  formatar?: (c: number) => string;
  sinal?: 'cor' | 'nenhum';
  className?: string;
  duracao?: number;
}

/**
 * Valor em dinheiro que "corre" até o número novo — de zero na primeira vez,
 * do valor anterior quando muda (trocar o mês anima a diferença). Respeita o
 * modo privacidade (embaça) e o "menos movimento" do sistema.
 */
export function Valor({ centavos, formatar = reais, sinal = 'nenhum', className = '', duracao = 1.1 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const visivel = useInView(ref, { once: true, margin: '-40px' });
  const reduzir = useReducedMotion();
  const atual = useMotionValue(0);
  const [texto, setTexto] = useState(() => formatar(reduzir ? centavos : 0));

  useEffect(() => {
    if (!visivel) return;
    if (reduzir) {
      atual.set(centavos);
      setTexto(formatar(centavos));
      return;
    }
    const controle = animate(atual, centavos, {
      duration: duracao,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setTexto(formatar(Math.round(v))),
    });
    return () => controle.stop();
  }, [centavos, visivel, reduzir, duracao, formatar, atual]);

  const cor = sinal === 'cor' ? (centavos > 0 ? 'valor--positivo' : centavos < 0 ? 'valor--negativo' : '') : '';
  return (
    <span ref={ref} className={`numero valor-privado ${cor} ${className}`} aria-label={formatar(centavos)}>
      {texto}
    </span>
  );
}
