import { type KeyboardEvent, useRef } from 'react';

interface Props {
  inicial: string;
  aoSalvar: (titulo: string) => void;
  aoCancelar: () => void;
  className?: string;
}

const LIMITE_TITULO = 120;

/** Campo de renomear no lugar: Enter (ou sair do campo) salva, Esc desiste. */
export function CampoRenomear({ inicial, aoSalvar, aoCancelar, className = '' }: Props) {
  const terminou = useRef(false);
  const concluir = (valor: string) => {
    if (terminou.current) return;
    terminou.current = true;
    const limpo = valor.trim();
    if (limpo && limpo !== inicial) aoSalvar(limpo);
    else aoCancelar();
  };
  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      concluir(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      terminou.current = true;
      aoCancelar();
    }
  };
  return (
    <input
      className={`campo-renomear ${className}`}
      defaultValue={inicial}
      maxLength={LIMITE_TITULO}
      aria-label="Novo nome da conversa"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={aoTeclar}
      onBlur={(e) => concluir(e.currentTarget.value)}
    />
  );
}
