import { AnimatePresence, motion } from 'motion/react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Icone } from '../icones/Icone';

type Tipo = 'sucesso' | 'erro' | 'info';
interface Aviso {
  id: number;
  tipo: Tipo;
  texto: string;
}

const Contexto = createContext<(tipo: Tipo, texto: string) => void>(() => undefined);
let seq = 0;

const ICONE: Record<Tipo, string> = { sucesso: 'check', erro: 'alerta', info: 'info' };

/** Avisos curtos no canto da tela. Somem sozinhos; erro fica mais tempo. */
export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((tipo: Tipo, texto: string) => {
    const id = ++seq;
    setAvisos((a) => [...a.slice(-3), { id, tipo, texto }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'erro' ? 7000 : 3800);
  }, []);
  const valor = useMemo(() => avisar, [avisar]);
  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {avisos.map((a) => (
            <motion.div
              key={a.id}
              layout
              className={`aviso aviso--${a.tipo}`}
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span className="aviso__icone"><Icone nome={ICONE[a.tipo]} tamanho={16} traco={2.2} /></span>
              <span>{a.texto}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Contexto.Provider>
  );
}

export const useAvisar = () => useContext(Contexto);
