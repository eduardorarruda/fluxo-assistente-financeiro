import { motion } from 'motion/react';
import { useId } from 'react';

/**
 * A marca do Fluxo: duas correntes — a violeta (o dinheiro que passa) e a
 * dourada (o que fica guardado). Desenha-se ao abrir e flui ao passar o mouse.
 */
export function Marca({ tamanho = 34, comTexto = true }: { tamanho?: number; comTexto?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <motion.div className="marca" whileHover="fluir" initial="inicio" animate="pronto">
      <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#C4B5FD" />
            <stop offset=".5" stopColor="#8B5CF6" />
            <stop offset="1" stopColor="#6D28D9" />
          </linearGradient>
          <radialGradient id={`b${id}`} cx=".3" cy=".2" r="1">
            <stop offset="0" stopColor="#1E1B3A" />
            <stop offset="1" stopColor="#0B0B14" />
          </radialGradient>
        </defs>
        <rect width="64" height="64" rx="18" fill={`url(#b${id})`} />
        <rect x=".5" y=".5" width="63" height="63" rx="17.5" fill="none" stroke="rgba(196,181,253,.18)" />
        <motion.path
          d="M12 40c9 0 11-17 20-17s11 17 20 17"
          fill="none"
          stroke={`url(#g${id})`}
          strokeWidth="6.5"
          strokeLinecap="round"
          variants={{
            inicio: { pathLength: 0 },
            pronto: { pathLength: 1, transition: { duration: 1.1, ease: [0.65, 0, 0.35, 1] } },
            fluir: { pathLength: [1, 0.35, 1], transition: { duration: 1.2, ease: 'easeInOut' } },
          }}
        />
        <motion.path
          d="M12 26c8 0 10 8 19 8"
          fill="none"
          stroke="#F5B83D"
          strokeWidth="4.5"
          strokeLinecap="round"
          variants={{
            inicio: { pathLength: 0, opacity: 0 },
            pronto: { pathLength: 1, opacity: 0.95, transition: { duration: 0.8, delay: 0.5, ease: 'easeOut' } },
            fluir: { x: [0, 3, 0], transition: { duration: 1.2 } },
          }}
        />
      </svg>
      {comTexto && (
        <motion.span className="marca__texto" variants={{ inicio: { opacity: 0, x: -6 }, pronto: { opacity: 1, x: 0, transition: { delay: 0.35 } } }}>
          Fluxo
        </motion.span>
      )}
    </motion.div>
  );
}
