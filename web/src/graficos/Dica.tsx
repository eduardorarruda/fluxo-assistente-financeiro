import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

/** Balão que segue o ponteiro dentro de um gráfico. Posição em px relativa ao contêiner. */
export function Dica({ x, y, visivel, children, largura }: { x: number; y: number; visivel: boolean; children: ReactNode; largura: number }) {
  const aDireita = x < largura * 0.62;
  return (
    <AnimatePresence>
      {visivel && (
        <motion.div
          className="dica"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1, left: aDireita ? x + 14 : x - 14, top: y }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 700, damping: 40, mass: 0.4 }}
          style={{ translateX: aDireita ? 0 : '-100%', translateY: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
