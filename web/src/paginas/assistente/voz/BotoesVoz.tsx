import { useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { Icone } from '../../../icones/Icone';
import { mensagemDeErro } from './reconhecimento';
import { useQuadros } from './useQuadros';

interface PropsDitado {
  ouvindo: boolean;
  suportado: boolean;
  local: boolean;
  nivel: () => number;
  aoClicar: () => void;
}

/** Botão do ditado: com o microfone aberto, um anel pulsa no ritmo da voz. */
export function BotaoDitado({ ouvindo, suportado, local, nivel, aoClicar }: PropsDitado) {
  const anel = useRef<HTMLSpanElement>(null);
  const reduzir = useReducedMotion();
  useQuadros(() => {
    const el = anel.current;
    if (!el) return;
    const n = nivel();
    el.style.transform = `scale(${(1 + n * 0.6).toFixed(3)})`;
    el.style.opacity = (0.3 + n * 0.6).toFixed(3);
  }, ouvindo && !reduzir);

  const motor = local ? 'no computador' : 'pelo Google (online)';
  const titulo = !suportado
    ? mensagemDeErro('sem-suporte')
    : ouvindo
      ? 'Parar o ditado (Alt+M ou Esc)'
      : `Ditar: fale e o texto aparece na caixa (Alt+M) · reconhecimento ${motor}`;
  return (
    <button
      type="button"
      className={`compositor__voz botao-ditado ${ouvindo ? 'botao-ditado--ouvindo' : ''}`}
      onClick={aoClicar}
      aria-pressed={ouvindo}
      aria-disabled={!suportado || undefined}
      aria-label={ouvindo ? 'Parar ditado' : 'Ditar mensagem'}
      aria-keyshortcuts="Alt+M"
      title={titulo}
    >
      {ouvindo && <span ref={anel} className="botao-ditado__anel" aria-hidden />}
      <Icone nome="microfone" tamanho={18} />
    </button>
  );
}

/** Ondinha ao lado do "Ouvindo…": quatro barras que sobem com a voz. */
export function OndaMini({ nivel, ativa }: { nivel: () => number; ativa: boolean }) {
  const barras = useRef<HTMLSpanElement>(null);
  const reduzir = useReducedMotion();
  useQuadros((t) => {
    const el = barras.current;
    if (!el) return;
    const n = nivel();
    Array.from(el.children).forEach((filho, i) => {
      const onda = 0.5 + 0.5 * Math.sin(t * 9 + i * 1.7);
      const altura = 0.22 + Math.min(1, n * (0.7 + 0.6 * onda));
      (filho as HTMLElement).style.transform = `scaleY(${altura.toFixed(3)})`;
    });
  }, ativa && !reduzir);
  return (
    <span ref={barras} className="onda-mini" aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/** Abre o modo conversação (falar com o assistente, que responde em voz). */
export function BotaoConversa({ aoClicar, desabilitado }: { aoClicar: () => void; desabilitado: boolean }) {
  return (
    <button
      type="button"
      className="compositor__voz botao-conversa"
      onClick={aoClicar}
      disabled={desabilitado}
      aria-label="Conversar por voz"
      aria-keyshortcuts="Alt+V"
      title="Conversar por voz: você fala, o assistente responde falando (Alt+V)"
    >
      <Icone nome="onda" tamanho={18} traco={2} />
    </button>
  );
}
