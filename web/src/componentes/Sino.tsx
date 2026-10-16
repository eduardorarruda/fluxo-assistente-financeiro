import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDispensaDeAlertas, useVisaoGeral, type PedidoDeDispensa } from '../api/consultas';
import type { Alerta } from '../api/tipos';
import { Icone } from '../icones/Icone';
import { useMes } from '../util/useMes';
import { useAvisar } from './Avisos';

/** A linha some encolhendo para a direita; as de baixo sobem junto com a altura. */
const SAIR = { opacity: 0, x: 28, height: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const } };

const plural = (n: number, palavra: string) => `${n} ${palavra}${n === 1 ? '' : 's'}`;

interface LinhaProps {
  alerta: Alerta;
  ordem: number;
  aoAbrir: () => void;
  aoDispensar: () => void;
  registrar: (el: HTMLButtonElement | null) => void;
}

function LinhaDeAlerta({ alerta: a, ordem, aoAbrir, aoDispensar, registrar }: LinhaProps) {
  return (
    <motion.li
      className={`alerta alerta--${a.gravidade.toLowerCase()}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0, height: 'auto', transition: { delay: ordem * 0.04 } }}
      exit={SAIR}
    >
      <button type="button" className="alerta__abrir" ref={registrar} onClick={aoAbrir}>
        <span className="alerta__ponto" />
        <span>
          <strong>{a.titulo}</strong>
          <small>{a.detalhe}</small>
        </span>
      </button>
      <button type="button" className="alerta__dispensar" aria-label="Dispensar este aviso" title="Dispensar este aviso" onClick={aoDispensar}>
        <Icone nome="fechar" tamanho={14} />
      </button>
    </motion.li>
  );
}

/**
 * O sino do topo. Cada aviso tem um X para dispensar (some enquanto continuar o
 * mesmo; volta se piorar), "Marcar todos como vistos" dispensa todos de uma vez
 * e "Mostrar N dispensados" traz de volta o que foi dispensado.
 */
export function Sino() {
  const { mesAtual } = useMes();
  const { data } = useVisaoGeral(mesAtual);
  const [aberto, setAberto] = useState(false);
  const navegar = useNavigate();
  const avisar = useAvisar();
  const dispensa = useDispensaDeAlertas();
  const ref = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const linhas = useRef(new Map<string, HTMLButtonElement>());
  const alertas = data?.alertas ?? [];
  const dispensados = data?.alertasDispensados ?? 0;
  const graves = alertas.filter((a) => a.gravidade !== 'INFO').length;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAberto(false);
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAberto(false);
      botao.current?.focus();
    };
    window.addEventListener('mousedown', fora);
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('mousedown', fora);
      window.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  const pedir = (p: PedidoDeDispensa) =>
    dispensa.mutate(p, { onError: (e) => avisar('erro', `Não consegui ${p.tipo === 'restaurar' ? 'mostrar os avisos' : 'dispensar'}: ${(e as Error).message}`) });

  const dispensarUm = (i: number) => {
    const vizinho = alertas[i + 1] ?? alertas[i - 1];
    pedir({ tipo: 'dispensar', ids: [alertas[i]!.id] });
    // O foco não some junto com a linha: vai para a vizinha, ou para o painel.
    (vizinho ? linhas.current.get(vizinho.id) : painel.current)?.focus();
  };

  const emLote = (tipo: 'dispensar-todos' | 'restaurar') => {
    pedir({ tipo });
    painel.current?.focus();
  };

  return (
    <div className="sino" ref={ref}>
      <motion.button
        ref={botao}
        type="button"
        className="botao-icone"
        aria-label={`Alertas (${alertas.length})`}
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        animate={graves ? { rotate: [0, -14, 12, -8, 5, 0] } : {}}
        transition={{ duration: 0.9, repeat: graves ? Infinity : 0, repeatDelay: 6 }}
      >
        <Icone nome="sino" tamanho={18} />
        <AnimatePresence>
          {alertas.length > 0 && (
            <motion.span
              key="contador"
              className={`sino__contador ${graves ? 'sino__contador--grave' : ''}`}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 30 }}
            >
              {alertas.length}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <AnimatePresence>
        {aberto && (
          <motion.div
            ref={painel}
            tabIndex={-1}
            role="dialog"
            aria-label="Avisos"
            className="popover"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          >
            <h3 className="popover__titulo">Precisa de atenção</h3>
            {alertas.length === 0 && (
              <motion.p className="popover__vazio" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.12 } }}>
                {dispensados ? 'Nenhum aviso novo.' : 'Tudo em ordem por aqui.'}
              </motion.p>
            )}
            <ul className="alertas">
              <AnimatePresence>
                {alertas.map((a, i) => (
                  <LinhaDeAlerta
                    key={a.id}
                    alerta={a}
                    ordem={i}
                    registrar={(el) => (el ? linhas.current.set(a.id, el) : linhas.current.delete(a.id))}
                    aoAbrir={() => {
                      setAberto(false);
                      navegar(a.destino);
                    }}
                    aoDispensar={() => dispensarUm(i)}
                  />
                ))}
              </AnimatePresence>
            </ul>
            {(alertas.length > 0 || dispensados > 0) && (
              <div className="popover__rodape">
                {dispensados > 0 && (
                  <button type="button" className="popover__restaurar" onClick={() => emLote('restaurar')} disabled={dispensa.isPending}>
                    Mostrar {plural(dispensados, 'dispensado')}
                  </button>
                )}
                {alertas.length > 0 && (
                  <button type="button" className="popover__todos" onClick={() => emLote('dispensar-todos')}>
                    <Icone nome="check" tamanho={14} /> Marcar todos como vistos
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
