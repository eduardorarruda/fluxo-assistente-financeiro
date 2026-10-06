import { useCallback, useEffect, useRef, useState } from 'react';
import { usePreferenciasVoz } from './preferencias-voz';
import { criarEscuta, type ErroEscuta, type Escuta, mensagemDeErro, suportaReconhecimento, useReconhecimentoLocal, usarLocal } from './reconhecimento';

export interface OpcoesUseEscuta {
  aoParcial: (texto: string) => void;
  aoFinal: (texto: string) => void;
  aoErro?: (erro: ErroEscuta) => void;
}

export interface ControleEscuta {
  suportado: boolean;
  ouvindo: boolean;
  erro: ErroEscuta | null;
  /** O motor em uso agora é o do computador (senão, o do Google). */
  local: boolean;
  iniciar: () => void;
  parar: () => void;
  abortar: () => void;
  limparErro: () => void;
}

/**
 * Escuta contínua para componentes React: escolhe o motor pelas preferências
 * (no computador quando o pacote pt-BR está pronto, senão o do Google), guarda
 * o último erro e desliga ao desmontar. Os retornos podem mudar a cada render.
 */
export function useEscuta(opcoes: OpcoesUseEscuta): ControleEscuta {
  const [prefs] = usePreferenciasVoz();
  const situacaoLocal = useReconhecimentoLocal();
  const local = usarLocal(prefs, situacaoLocal.estado);
  const suportado = suportaReconhecimento();
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState<ErroEscuta | null>(null);
  const retornos = useRef(opcoes);
  retornos.current = opcoes;
  const escuta = useRef<Escuta | null>(null);

  const iniciar = useCallback(() => {
    if (!suportado) {
      const e = { codigo: 'sem-suporte', mensagem: mensagemDeErro('sem-suporte') };
      setErro(e);
      retornos.current.aoErro?.(e);
      return;
    }
    escuta.current?.abortar();
    const nova = criarEscuta({
      local,
      aoParcial: (t) => retornos.current.aoParcial(t),
      aoFinal: (t) => retornos.current.aoFinal(t),
      aoErro: (e) => {
        if (escuta.current !== nova) return;
        setErro(e);
        setOuvindo(false);
        retornos.current.aoErro?.(e);
      },
    });
    escuta.current = nova;
    setErro(null);
    setOuvindo(true);
    nova?.iniciar();
  }, [local, suportado]);

  const parar = useCallback(() => {
    escuta.current?.parar();
    setOuvindo(false);
  }, []);

  const abortar = useCallback(() => {
    escuta.current?.abortar();
    escuta.current = null;
    setOuvindo(false);
  }, []);

  const limparErro = useCallback(() => setErro(null), []);

  useEffect(() => () => escuta.current?.abortar(), []);

  return { suportado, ouvindo, erro, local, iniciar, parar, abortar, limparErro };
}
