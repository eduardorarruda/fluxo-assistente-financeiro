import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Categoria } from '../api/tipos';
import { Icone } from '../icones/Icone';
import { pct } from '../util/formato';

/** Variações para entrar em cascata: o contêiner rege, os filhos seguem. */
export const cascata = {
  inicial: {},
  visivel: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};
export const surgir = {
  inicial: { opacity: 0, y: 18 },
  visivel: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 28 } },
};

export function Pagina({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={`pagina ${className}`} variants={cascata} initial="inicial" animate="visivel">
      {children}
    </motion.div>
  );
}

interface CartaoProps extends Omit<HTMLMotionProps<'section'>, 'title'> {
  titulo?: ReactNode;
  icone?: string;
  acoes?: ReactNode;
  children?: ReactNode;
  destaque?: boolean;
  className?: string;
}

export function Cartao({ titulo, icone, acoes, children, destaque, className = '', ...resto }: CartaoProps) {
  return (
    <motion.section variants={surgir} className={`cartao ${destaque ? 'cartao--destaque' : ''} ${className}`} {...resto}>
      {(titulo || acoes) && (
        <header className="cartao__topo">
          {titulo && (
            <h2 className="cartao__titulo">
              {icone && <Icone nome={icone} tamanho={16} />}
              {titulo}
            </h2>
          )}
          {acoes && <div className="cartao__acoes">{acoes}</div>}
        </header>
      )}
      {children}
    </motion.section>
  );
}

type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo';
interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  icone?: string;
  carregando?: boolean;
  pequeno?: boolean;
}

export function Botao({ variante = 'secundario', icone, carregando, pequeno, children, className = '', disabled, ...resto }: BotaoProps) {
  return (
    <button
      type="button"
      className={`botao botao--${variante} ${pequeno ? 'botao--pequeno' : ''} ${className}`}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...resto}
    >
      {icone && <Icone nome={carregando ? 'sincronizar' : icone} tamanho={pequeno ? 15 : 17} className={carregando ? 'girando' : ''} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function BotaoIcone({ icone, rotulo, className = '', ...resto }: ButtonHTMLAttributes<HTMLButtonElement> & { icone: string; rotulo: string }) {
  return (
    <button type="button" className={`botao-icone ${className}`} aria-label={rotulo} title={rotulo} {...resto}>
      <Icone nome={icone} tamanho={18} />
    </button>
  );
}

export function CategoriaIcone({ categoria, tamanho = 36, icone, cor }: { categoria?: Categoria; tamanho?: number; icone?: string; cor?: string }) {
  const c = cor ?? categoria?.cor ?? '#64748B';
  return (
    <span
      className="categoria-icone"
      style={{ width: tamanho, height: tamanho, color: c, background: `color-mix(in srgb, ${c} 16%, transparent)`, borderColor: `color-mix(in srgb, ${c} 26%, transparent)` }}
    >
      <Icone nome={icone ?? categoria?.icone ?? 'pontos'} tamanho={Math.round(tamanho * 0.5)} />
    </span>
  );
}

export function Delta({ atual, anterior, inverter = false }: { atual: number; anterior: number; inverter?: boolean }) {
  if (anterior === 0) return null;
  const variacao = (atual - anterior) / Math.abs(anterior);
  if (!Number.isFinite(variacao) || Math.abs(variacao) < 0.005) return <span className="delta delta--neutro">estável</span>;
  const subiu = variacao > 0;
  const bom = inverter ? !subiu : subiu;
  return (
    <span className={`delta ${bom ? 'delta--bom' : 'delta--ruim'}`}>
      <Icone nome={subiu ? 'subir' : 'descer'} tamanho={13} traco={2.2} />
      {pct(Math.abs(variacao))}
    </span>
  );
}

export function Barra({ valor, cor, marca, altura = 8 }: { valor: number; cor: string; marca?: number; altura?: number }) {
  return (
    <div className="barra" style={{ height: altura }}>
      <motion.div
        className="barra__cheia"
        style={{ background: cor }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, valor * 100))}%` }}
        transition={{ type: 'spring', stiffness: 90, damping: 20, delay: 0.1 }}
      />
      {valor > 1 && (
        <motion.div className="barra__excesso" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} />
      )}
      {marca !== undefined && marca > 0 && marca < 1 && <div className="barra__marca" style={{ left: `${marca * 100}%` }} title="Onde deveria estar hoje" />}
    </div>
  );
}

export function Anel({ valor, cor, tamanho = 64, espessura = 7, children }: { valor: number; cor: string; tamanho?: number; espessura?: number; children?: ReactNode }) {
  const r = (tamanho - espessura) / 2;
  const c = 2 * Math.PI * r;
  const id = useId();
  return (
    <div className="anel" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={cor} stopOpacity={0.65} />
            <stop offset="1" stopColor={cor} />
          </linearGradient>
        </defs>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="var(--superficie-3)" strokeWidth={espessura} />
        <motion.circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke={`url(#${CSS.escape(id)})`}
          strokeWidth={espessura}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, valor))) }}
          transition={{ type: 'spring', stiffness: 60, damping: 18, delay: 0.15 }}
          transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
        />
      </svg>
      <div className="anel__centro">{children}</div>
    </div>
  );
}

export function Selo({ children, tom = 'neutro', icone }: { children: ReactNode; tom?: 'neutro' | 'bom' | 'ruim' | 'atencao' | 'marca' | 'ouro' | 'info'; icone?: string }) {
  return (
    <span className={`selo selo--${tom}`}>
      {icone && <Icone nome={icone} tamanho={12} traco={2.2} />}
      {children}
    </span>
  );
}

export function Vazio({ icone = 'fluxo', titulo, texto, acao }: { icone?: string; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <motion.div className="vazio" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="vazio__icone">
        <Icone nome={icone} tamanho={28} />
      </div>
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      {acao}
    </motion.div>
  );
}

export function Esqueleto({ altura = 16, largura = '100%', raio = 8 }: { altura?: number; largura?: number | string; raio?: number }) {
  return <span className="esqueleto" style={{ height: altura, width: largura, borderRadius: raio }} />;
}

export function Carregando({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="carregando" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => (
        <Esqueleto key={i} altura={i === 0 ? 120 : 64} raio={18} />
      ))}
    </div>
  );
}

export function Interruptor({ ligado, aoMudar, rotulo }: { ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} className={`interruptor ${ligado ? 'interruptor--ligado' : ''}`} onClick={() => aoMudar(!ligado)}>
      <motion.span className="interruptor__bola" layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} />
    </button>
  );
}

/** Painel que desliza da direita. Esc ou clique fora fecham. */
export function Gaveta({ aberta, aoFechar, titulo, children, largura = 460 }: { aberta: boolean; aoFechar: () => void; titulo: ReactNode; children: ReactNode; largura?: number }) {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberta, aoFechar]);
  return createPortal(
    <AnimatePresence>
      {aberta && (
        <>
          <motion.div className="veu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={aoFechar} />
          <motion.aside
            className="gaveta"
            role="dialog"
            aria-modal="true"
            style={{ width: largura }}
            initial={{ x: largura + 40 }}
            animate={{ x: 0 }}
            exit={{ x: largura + 40 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <header className="gaveta__topo">
              <h2>{titulo}</h2>
              <BotaoIcone icone="fechar" rotulo="Fechar" onClick={aoFechar} />
            </header>
            <div className="gaveta__corpo">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ aberto, aoFechar, titulo, children }: { aberto: boolean; aoFechar: () => void; titulo: ReactNode; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    // Foco entra no diálogo (no primeiro campo; senão no primeiro botão do corpo) e volta para quem abriu.
    const antes = document.activeElement as HTMLElement | null;
    const quadro = requestAnimationFrame(() => {
      const corpo = caixa.current?.querySelector<HTMLElement>('.modal__corpo');
      const alvo = corpo?.querySelector<HTMLElement>('input, textarea, select') ?? corpo?.querySelector<HTMLElement>(FOCAVEIS) ?? caixa.current;
      alvo?.focus();
    });
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return aoFechar();
      if (e.key !== 'Tab' || !caixa.current) return;
      const focaveis = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)];
      if (!focaveis.length) return;
      const [primeiro, ultimo] = [focaveis[0]!, focaveis.at(-1)!];
      if (e.shiftKey && document.activeElement === primeiro) (e.preventDefault(), ultimo.focus());
      else if (!e.shiftKey && document.activeElement === ultimo) (e.preventDefault(), primeiro.focus());
    };
    window.addEventListener('keydown', tecla);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('keydown', tecla);
      antes?.focus?.();
    };
  }, [aberto, aoFechar]);
  return createPortal(
    <AnimatePresence>
      {aberto && (
        <motion.div className="veu veu--centro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
          <motion.div
            ref={caixa}
            className="modal"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <header className="gaveta__topo">
              <h2>{titulo}</h2>
              <BotaoIcone icone="fechar" rotulo="Fechar" onClick={aoFechar} />
            </header>
            <div className="modal__corpo">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
