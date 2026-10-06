import { motion } from 'motion/react';
import { useId } from 'react';

/**
 * A caixinha como um pote de vidro com líquido dourado. O nível sobe até a
 * fração pedida e a superfície ondula devagar (duas ondas defasadas).
 */
export function Pote({ nivel, cor = 'var(--guardado)', tamanho = 96 }: { nivel: number; cor?: string; tamanho?: number }) {
  const id = useId().replace(/:/g, '');
  const n = Math.max(0.04, Math.min(1, nivel));
  const topoLiquido = 108 - n * 84; // área útil do pote: y de 24 a 108
  const onda = (fase: number) =>
    `M-60 ${topoLiquido} q 15 ${-5 + fase} 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 V 120 H -60 Z`;
  return (
    <svg width={tamanho} height={tamanho * 1.1} viewBox="0 0 100 120" aria-hidden="true" className="pote">
      <defs>
        <clipPath id={`vidro${id}`}>
          <path d="M30 14 h40 v8 c10 6 16 16 16 30 v50 a12 12 0 0 1 -12 12 H26 a12 12 0 0 1 -12 -12 V52 c0 -14 6 -24 16 -30 z" />
        </clipPath>
        <linearGradient id={`liq${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cor} stopOpacity={0.95} />
          <stop offset="1" stopColor={cor} stopOpacity={0.55} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#vidro${id})`}>
        <rect x="0" y="0" width="100" height="120" fill="var(--superficie-3)" opacity={0.6} />
        <motion.g initial={{ y: 90 }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 40, damping: 12, delay: 0.2 }}>
          <path d={onda(0)} fill={`url(#liq${id})`} opacity={0.55} className="pote__onda pote__onda--lenta" />
          <path d={onda(2)} fill={`url(#liq${id})`} className="pote__onda" />
        </motion.g>
        <rect x="24" y="30" width="6" height="60" rx="3" fill="white" opacity={0.08} />
      </g>
      <path d="M30 14 h40 v8 c10 6 16 16 16 30 v50 a12 12 0 0 1 -12 12 H26 a12 12 0 0 1 -12 -12 V52 c0 -14 6 -24 16 -30 z" fill="none" stroke="var(--borda-forte)" strokeWidth="2" />
      <rect x="27" y="6" width="46" height="10" rx="4" fill="var(--superficie-3)" stroke="var(--borda-forte)" strokeWidth="2" />
    </svg>
  );
}
