import { type FocusEvent, useEffect, useState } from 'react';
import { Icone } from '../../icones/Icone';
import { ErroCampo } from './DetalhesConta';

interface Props {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  /** Motivo da recusa, já decidido por quem usa (null = nada a mostrar). */
  erro: string | null;
  /** Página do provedor onde se cria a chave: vira o link "Criar uma chave ↗". */
  ondeCriar?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
}

/**
 * A chave de API: campo de senha (nunca preenchido com a salva — o servidor nem a
 * devolve), com o olho para conferir o que foi colado. Sem autocompletar, sem
 * corretor: o navegador não tem nada a sugerir nem a guardar aqui.
 */
export function CampoChave({ id, rotulo, valor, aoMudar, erro, ondeCriar, placeholder, autoFocus, disabled, onBlur }: Props) {
  const [visivel, setVisivel] = useState(false);
  const idErro = `${id}-erro`;

  // Campo esvaziado (salvou ou desistiu): volta a esconder.
  useEffect(() => {
    if (!valor) setVisivel(false);
  }, [valor]);

  return (
    <div className="campo campo-chave">
      <div className="campo-chave__topo">
        <label htmlFor={id} className="campo-ia__rotulo">{rotulo}</label>
        {ondeCriar && (
          <a className="campo-chave__link" href={ondeCriar} target="_blank" rel="noreferrer noopener">
            Criar uma chave <span aria-hidden>↗</span>
            <span className="oculto-leitor"> (abre o site do provedor em outra janela)</span>
          </a>
        )}
      </div>
      <div className="campo-chave__caixa">
        <input
          id={id}
          className="entrada mono campo-chave__entrada"
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? idErro : undefined}
        />
        <button
          type="button"
          className="campo-chave__ver"
          onClick={() => setVisivel((v) => !v)}
          aria-pressed={visivel}
          aria-controls={id}
          aria-label="Mostrar a chave"
          title={visivel ? 'Esconder a chave' : 'Mostrar a chave'}
          disabled={disabled}
        >
          <Icone nome={visivel ? 'olho-fechado' : 'olho'} tamanho={16} />
        </button>
      </div>
      <ErroCampo id={idErro} texto={erro} />
    </div>
  );
}
