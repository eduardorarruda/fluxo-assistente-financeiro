import { AnimatePresence, motion } from 'motion/react';
import { type InputHTMLAttributes, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from '../icones/Icone';
import { useCliqueFora, usePosicaoFlutuante } from './flutuante';
import { OpcoesFlutuantes as Opcoes, type OpcaoSeletor } from './OpcoesFlutuantes';

/**
 * Campo de texto livre com sugestões (no lugar do <datalist>, que o sistema
 * desenha do jeito dele). Digitar filtra; setas navegam; Enter escolhe a
 * sugestão em destaque; Esc fecha a lista.
 */

type AtributosDoInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'>;

export interface PropsCampoSugestoes extends AtributosDoInput {
  valor: string;
  aoMudar: (valor: string) => void;
  sugestoes: readonly OpcaoSeletor[];
  /** Enter com a lista fechada (ou sem sugestão em destaque). */
  aoConfirmar?: () => void;
  invalido?: boolean;
}

export function CampoSugestoes({ valor, aoMudar, sugestoes, aoConfirmar, invalido, className = '', id, disabled, onKeyDown, ...resto }: PropsCampoSugestoes) {
  const base = useId();
  const idCampo = id ?? `${base}-campo`;
  const idLista = `${base}-lista`;
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [todas, setTodas] = useState(false);
  const [ativa, setAtiva] = useState(-1);
  const posicao = usePosicaoFlutuante(caixa, aberto);

  const filtro = valor.trim().toLowerCase();
  const visiveis = useMemo(
    () => (todas || !filtro ? sugestoes : sugestoes.filter((s) => s.rotulo.toLowerCase().includes(filtro) || s.valor.toLowerCase().includes(filtro))),
    [sugestoes, filtro, todas],
  );
  const mostrar = aberto && visiveis.length > 0;
  const dentro = useMemo(() => [caixa, lista], []);
  useCliqueFora(aberto, dentro, () => setAberto(false));

  useEffect(() => {
    if (ativa >= visiveis.length) setAtiva(visiveis.length - 1);
  }, [ativa, visiveis.length]);

  useEffect(() => {
    if (mostrar && ativa >= 0) document.getElementById(`${base}-opcao-${ativa}`)?.scrollIntoView({ block: 'nearest' });
  }, [mostrar, ativa, base]);

  const abrir = (mostrarTodas: boolean) => {
    if (disabled) return;
    setTodas(mostrarTodas);
    setAtiva(Math.max(0, sugestoes.findIndex((s) => s.valor === valor)));
    setAberto(true);
  };

  const escolher = (i: number) => {
    const s = visiveis[i];
    if (!s) return;
    aoMudar(s.valor);
    setAberto(false);
    campo.current?.focus();
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    tratarTecla(e);
    // Quem usa o campo vê a tecla depois (e sabe, por defaultPrevented, se a lista já tratou).
    onKeyDown?.(e);
  };

  const tratarTecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!mostrar) return abrir(e.altKey || !filtro);
      setAtiva((a) => Math.min(visiveis.length - 1, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      if (mostrar && ativa >= 0) {
        e.preventDefault();
        escolher(ativa);
      } else if (aoConfirmar) {
        e.preventDefault();
        aoConfirmar();
      }
    } else if (e.key === 'Escape' && mostrar) {
      e.preventDefault();
      e.stopPropagation();
      setAberto(false);
    } else if (e.key === 'Tab') {
      setAberto(false);
    }
  };

  return (
    <div ref={caixa} className={`campo-sugestoes ${invalido ? 'campo-sugestoes--invalido' : ''} ${mostrar ? 'campo-sugestoes--aberto' : ''} ${className}`}>
      <input
        {...resto}
        ref={campo}
        id={idCampo}
        className="entrada campo-sugestoes__entrada"
        value={valor}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mostrar}
        aria-controls={idLista}
        aria-activedescendant={mostrar && ativa >= 0 ? `${base}-opcao-${ativa}` : undefined}
        aria-invalid={invalido || undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          aoMudar(e.target.value);
          setTodas(false);
          setAtiva(0);
          setAberto(true);
        }}
        onKeyDown={aoTeclar}
      />
      {sugestoes.length > 0 && (
        <button
          type="button"
          className="campo-sugestoes__botao"
          tabIndex={-1}
          aria-label="Ver sugestões"
          disabled={disabled}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => (mostrar ? setAberto(false) : (abrir(true), campo.current?.focus()))}
        >
          <Icone nome="chevron-baixo" tamanho={15} />
        </button>
      )}
      {createPortal(
        <AnimatePresence>
          {mostrar && posicao && (
            <motion.div
              ref={lista}
              id={idLista}
              role="listbox"
              aria-label="Sugestões"
              className="flutuante"
              style={posicao.estilo}
              initial={{ opacity: 0, scale: 0.97, y: posicao.lado === 'baixo' ? -4 : 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              onPointerDown={(e) => e.preventDefault()}
            >
              <Opcoes opcoes={visiveis} base={base} valor={valor} ativa={ativa} aoApontar={setAtiva} aoEscolher={escolher} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
