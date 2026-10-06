import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Tema = 'escuro' | 'claro';

interface Preferencias {
  tema: Tema;
  alternarTema: () => void;
  privado: boolean;
  alternarPrivado: () => void;
  recolhida: boolean;
  alternarRecolhida: () => void;
  mes: string | null;
  definirMes: (mes: string) => void;
}

const Contexto = createContext<Preferencias | null>(null);

function lerSalvo<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(`fluxo:${chave}`);
    return v === null ? padrao : (JSON.parse(v) as T);
  } catch {
    return padrao;
  }
}

function salvar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(`fluxo:${chave}`, JSON.stringify(valor));
  } catch {
    /* modo anônimo ou armazenamento cheio: a preferência só não persiste */
  }
}

export function ProvedorPreferencias({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(() => lerSalvo('tema', 'escuro'));
  const [privado, setPrivado] = useState(() => lerSalvo('privado', false));
  const [recolhida, setRecolhida] = useState(() => lerSalvo('recolhida', false));
  const [mes, setMes] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    salvar('tema', tema);
  }, [tema]);
  useEffect(() => {
    document.documentElement.dataset.privado = privado ? 'sim' : 'nao';
    salvar('privado', privado);
  }, [privado]);
  useEffect(() => salvar('recolhida', recolhida), [recolhida]);

  const alternarTema = useCallback(() => setTema((t) => (t === 'escuro' ? 'claro' : 'escuro')), []);
  const alternarPrivado = useCallback(() => setPrivado((p) => !p), []);
  const alternarRecolhida = useCallback(() => setRecolhida((r) => !r), []);

  const valor = useMemo(
    () => ({ tema, alternarTema, privado, alternarPrivado, recolhida, alternarRecolhida, mes, definirMes: setMes }),
    [tema, alternarTema, privado, alternarPrivado, recolhida, alternarRecolhida, mes],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePreferencias(): Preferencias {
  const c = useContext(Contexto);
  if (!c) throw new Error('usePreferencias fora do ProvedorPreferencias');
  return c;
}
