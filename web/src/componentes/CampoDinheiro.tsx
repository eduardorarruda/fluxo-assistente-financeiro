import { type ClipboardEvent, type InputHTMLAttributes, useLayoutEffect, useRef } from 'react';
import type { Centavos } from '../api/tipos';
import { lerReais, reais } from '../util/formato';

/**
 * Campo de dinheiro com a máscara de real, como numa maquininha: cada
 * algarismo entra pela direita (1 → R$ 0,01; 15000 → R$ 150,00) e apagar tira
 * o último. Colar "150", "150,00" ou "R$ 1.234,56" entende como reais.
 */

const MAXIMO_ALGARISMOS = 10; // R$ 99.999.999,99 — abaixo do teto do servidor (R$ 100 milhões)

type Atributos = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>;

export interface PropsCampoDinheiro extends Atributos {
  valor: Centavos | null;
  aoMudar: (centavos: Centavos | null) => void;
}

/** "R$ 1.234,5" digitado → centavos pelos algarismos (o último par são os centavos). */
export function centavosDosAlgarismos(texto: string): Centavos | null {
  const algarismos = texto.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAXIMO_ALGARISMOS);
  return algarismos ? Number(algarismos) : null;
}

export function CampoDinheiro({ valor, aoMudar, className = '', placeholder = 'R$ 0,00', onPaste, ...resto }: PropsCampoDinheiro) {
  const campo = useRef<HTMLInputElement>(null);
  const texto = valor === null ? '' : reais(valor);

  // O cursor fica sempre no fim: é lá que os algarismos entram.
  useLayoutEffect(() => {
    const el = campo.current;
    if (el && document.activeElement === el) el.setSelectionRange(texto.length, texto.length);
  }, [texto]);

  const colar = (e: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(e);
    const colado = e.clipboardData.getData('text');
    const lido = lerReais(colado);
    if (lido === null) return;
    e.preventDefault();
    aoMudar(lido > 0 ? Math.min(lido, 10 ** MAXIMO_ALGARISMOS - 1) : null);
  };

  return (
    <input
      ref={campo}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={`entrada numero campo-dinheiro ${className}`}
      placeholder={placeholder}
      value={texto}
      onChange={(e) => aoMudar(centavosDosAlgarismos(e.target.value))}
      onPaste={colar}
      {...resto}
    />
  );
}
