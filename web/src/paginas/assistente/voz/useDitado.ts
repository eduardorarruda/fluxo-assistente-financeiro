import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { juntarFala } from './maquina-conversa';
import { useNivelMicrofone } from './nivel-microfone';
import { type ControleEscuta, useEscuta } from './useEscuta';

/**
 * Ditado na caixa de texto: o que a pessoa fala aparece na hora, no lugar do
 * cursor, sem apagar o que já estava escrito. O trecho ainda provisório (que o
 * reconhecimento pode corrigir) é trocado a cada resultado; o confirmado fica.
 */

export interface AncoraDitado {
  /** Texto antes do cursor quando o ditado começou. */
  antes: string;
  /** Texto depois do cursor (ou da seleção, que é substituída). */
  depois: string;
  confirmado: string;
  parcial: string;
}

const FIM_DE_FRASE = /[.!?…]\s*$/;

/** Começo de frase ganha maiúscula (o reconhecimento costuma devolver tudo minúsculo). */
function capitalizar(corpo: string, antes: string): string {
  const comecoDeFrase = antes.trim() === '' || FIM_DE_FRASE.test(antes);
  return comecoDeFrase ? corpo.replace(/^\p{Ll}/u, (l) => l.toLocaleUpperCase('pt-BR')) : corpo;
}

/** Texto da caixa e posição do cursor (logo depois do que foi ditado). */
export function montarTextoDitado(a: AncoraDitado): { texto: string; cursor: number } {
  const corpo = capitalizar(juntarFala(a.confirmado, a.parcial), a.antes);
  if (!corpo) return { texto: a.antes + a.depois, cursor: a.antes.length };
  const espacoAntes = a.antes && !/\s$/.test(a.antes) ? ' ' : '';
  const espacoDepois = a.depois && !/^[\s,.;:!?…]/.test(a.depois) ? ' ' : '';
  const ate = a.antes + espacoAntes + corpo;
  return { texto: ate + espacoDepois + a.depois, cursor: ate.length };
}

export interface ControleDitado {
  escuta: ControleEscuta;
  ouvindo: boolean;
  /** Nível do microfone, 0–1, para o anel do botão. */
  nivel: () => number;
  alternar: () => void;
  /** Para e mantém o que foi dito (inclusive o provisório). */
  parar: () => void;
  /** Para e esquece: o texto foi enviado ou a pessoa passou a digitar. */
  soltar: () => void;
}

interface Opcoes {
  texto: string;
  setTexto: (texto: string) => void;
  caixa: RefObject<HTMLTextAreaElement | null>;
}

export function useDitado({ texto, setTexto, caixa }: Opcoes): ControleDitado {
  const ancora = useRef<AncoraDitado | null>(null);
  const cursor = useRef<number | null>(null);
  const textoAtual = useRef(texto);
  textoAtual.current = texto;

  const aplicar = useCallback(() => {
    const a = ancora.current;
    if (!a) return;
    const montado = montarTextoDitado(a);
    cursor.current = montado.cursor;
    setTexto(montado.texto);
  }, [setTexto]);

  const escuta = useEscuta({
    aoParcial: (t) => {
      if (!ancora.current || ancora.current.parcial === t) return;
      ancora.current = { ...ancora.current, parcial: t };
      aplicar();
    },
    aoFinal: (t) => {
      if (!ancora.current) return;
      ancora.current = { ...ancora.current, confirmado: juntarFala(ancora.current.confirmado, t), parcial: '' };
      aplicar();
    },
  });
  const microfone = useNivelMicrofone(escuta.ouvindo);

  // Depois de cada atualização, o cursor fica no fim do que foi ditado (e a caixa rola até ele).
  useLayoutEffect(() => {
    const el = caixa.current;
    const pos = cursor.current;
    if (!el || pos === null) return;
    cursor.current = null;
    if (document.activeElement === el) el.setSelectionRange(pos, pos);
  }, [texto, caixa]);

  const iniciar = useCallback(() => {
    const el = caixa.current;
    const atual = textoAtual.current;
    const inicio = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? inicio;
    ancora.current = { antes: atual.slice(0, inicio), depois: atual.slice(fim), confirmado: '', parcial: '' };
    escuta.iniciar();
    el?.focus();
  }, [caixa, escuta]);

  const { parar: pararEscuta, abortar } = escuta;
  // Ao parar, a âncora continua: o Chrome ainda entrega o resultado final do que estava sendo dito.
  const parar = useCallback(() => pararEscuta(), [pararEscuta]);
  const soltar = useCallback(() => {
    ancora.current = null;
    abortar();
  }, [abortar]);

  const alternar = useCallback(() => (escuta.ouvindo ? parar() : iniciar()), [escuta.ouvindo, parar, iniciar]);

  // Esc para o ditado de qualquer lugar da tela.
  useEffect(() => {
    if (!escuta.ouvindo) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      parar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [escuta.ouvindo, parar]);

  return { escuta, ouvindo: escuta.ouvindo, nivel: microfone.nivel, alternar, parar, soltar };
}
