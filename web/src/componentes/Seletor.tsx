import { AnimatePresence, motion } from 'motion/react';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from '../icones/Icone';
import { posicaoLateral, useCliqueFora, usePosicaoFlutuante } from './flutuante';
import { contemValor, idDaOpcao, OpcoesFlutuantes, type OpcaoSeletor } from './OpcoesFlutuantes';

export type { OpcaoSeletor };

/**
 * A caixa de escolha do Fluxo, no lugar do <select> nativo (que o sistema
 * desenha quadrado, fora do visual do app). Teclado como no padrão ARIA
 * "select-only combobox": setas, Home/End, Enter/Espaço, Esc, Tab, digitar as
 * primeiras letras e os atalhos 1–9. Seta para a direita abre o submenu
 * ("Mais modelos"), para a esquerda volta.
 */

export interface PropsSeletor {
  valor: string;
  opcoes: readonly OpcaoSeletor[];
  aoMudar: (valor: string) => void;
  /** Nome acessível ("Conta", "Categoria"…). */
  rotulo: string;
  /** Ícone à esquerda dentro do botão (o da opção escolhida, se ela tiver, tem prioridade). */
  prefixo?: ReactNode;
  /** 'campo' = como as entradas de formulário; 'pilula' = compacto e arredondado (barras de ferramenta). */
  variante?: 'campo' | 'pilula';
  /** Texto quando o valor não está entre as opções. */
  vazio?: string;
  desabilitado?: boolean;
  titulo?: string;
  alinhar?: 'inicio' | 'fim';
  className?: string;
  id?: string;
}

const TEMPO_DIGITACAO_MS = 600;
const ANIMACAO = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.1 } },
  transition: { type: 'spring', stiffness: 520, damping: 34 },
} as const;

/** Opção escolhida, procurando também dentro dos submenus. */
function achar(opcoes: readonly OpcaoSeletor[], valor: string): OpcaoSeletor | undefined {
  for (const o of opcoes) {
    if (o.submenu) {
      const dentro = achar(o.submenu, valor);
      if (dentro) return dentro;
    } else if (o.valor === valor) return o;
  }
  return undefined;
}

const habilitadas = (opcoes: readonly OpcaoSeletor[]) => opcoes.map((o, i) => (o.desabilitada ? -1 : i)).filter((i) => i >= 0);

function proxima(lista: number[], atual: number, passo: number): number {
  if (!lista.length) return -1;
  const pos = lista.indexOf(atual);
  return lista[pos < 0 ? 0 : Math.min(lista.length - 1, Math.max(0, pos + passo))]!;
}

export function Seletor(p: PropsSeletor) {
  const { valor, opcoes, aoMudar, rotulo, variante = 'campo', desabilitado = false, alinhar = 'inicio' } = p;
  const base = useId();
  const baseSub = `${base}-sub`;
  const idLista = `${base}-lista`;
  const gatilho = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const painelSub = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [ativa, setAtiva] = useState(-1);
  const [sub, setSub] = useState<{ pai: number; ativa: number; foco: boolean } | null>(null);
  const [estiloSub, setEstiloSub] = useState<CSSProperties | null>(null);
  const busca = useRef({ texto: '', ate: 0 });
  const posicao = usePosicaoFlutuante(gatilho, aberto, alinhar);
  const atual = achar(opcoes, valor);
  const livres = useMemo(() => habilitadas(opcoes), [opcoes]);
  const opcoesSub = sub ? (opcoes[sub.pai]?.submenu ?? []) : [];

  const fechar = useCallback((devolverFoco = true) => {
    setAberto(false);
    setSub(null);
    if (devolverFoco) gatilho.current?.focus();
  }, []);
  const dentro = useMemo(() => [gatilho, lista, painelSub], []);
  useCliqueFora(aberto, dentro, () => fechar(false));

  const abrir = (inicial?: number) => {
    if (desabilitado || !opcoes.length) return;
    const escolhida = opcoes.findIndex((o) => contemValor(o, valor));
    setAtiva(inicial ?? (escolhida >= 0 && !opcoes[escolhida]?.desabilitada ? escolhida : (livres[0] ?? -1)));
    setSub(null);
    setAberto(true);
  };

  const confirmar = (o: OpcaoSeletor | undefined) => {
    if (!o || o.desabilitada || o.submenu) return;
    fechar();
    if (o.valor !== valor) aoMudar(o.valor);
  };

  const abrirSub = (i: number, foco: boolean) => {
    if (!opcoes[i]?.submenu) return setSub(null);
    const primeira = habilitadas(opcoes[i]!.submenu!)[0] ?? -1;
    setSub({ pai: i, ativa: foco ? primeira : -1, foco });
  };

  const escolher = (i: number) => (opcoes[i]?.submenu ? abrirSub(i, true) : confirmar(opcoes[i]));

  const apontar = (i: number) => {
    setAtiva(i);
    if (opcoes[i]?.submenu) abrirSub(i, false);
    else setSub(null);
  };

  const procurar = (letra: string) => {
    const agora = Date.now();
    busca.current = { texto: (agora < busca.current.ate ? busca.current.texto : '') + letra.toLowerCase(), ate: agora + TEMPO_DIGITACAO_MS };
    const achada = livres.find((i) => opcoes[i]!.rotulo.toLowerCase().startsWith(busca.current.texto));
    if (achada === undefined) return;
    if (aberto) setAtiva(achada);
    else if (!opcoes[achada]!.submenu) confirmar(opcoes[achada]);
  };

  const teclaNoSub = (e: KeyboardEvent): boolean => {
    if (!sub?.foco) return false;
    const livresSub = habilitadas(opcoesSub);
    const acoes: Record<string, () => void> = {
      ArrowDown: () => setSub({ ...sub, ativa: proxima(livresSub, sub.ativa, 1) }),
      ArrowUp: () => setSub({ ...sub, ativa: proxima(livresSub, sub.ativa, -1) }),
      Home: () => setSub({ ...sub, ativa: livresSub[0] ?? -1 }),
      End: () => setSub({ ...sub, ativa: livresSub.at(-1) ?? -1 }),
      ArrowLeft: () => setSub(null),
      Escape: () => setSub(null),
      Enter: () => confirmar(opcoesSub[sub.ativa]),
      ' ': () => confirmar(opcoesSub[sub.ativa]),
    };
    const acao = acoes[e.key];
    if (!acao) return false;
    e.preventDefault();
    e.stopPropagation();
    acao();
    return true;
  };

  const teclaNaLista = (e: KeyboardEvent): boolean => {
    const atalho = opcoes.findIndex((o) => o.atalho === e.key && !o.desabilitada);
    const acoes: Record<string, () => void> = {
      ArrowDown: () => (e.altKey ? escolher(ativa) : setAtiva(proxima(livres, ativa, 1))),
      ArrowUp: () => (e.altKey ? escolher(ativa) : setAtiva(proxima(livres, ativa, -1))),
      ArrowRight: () => abrirSub(ativa, true),
      Home: () => setAtiva(livres[0] ?? -1),
      End: () => setAtiva(livres.at(-1) ?? -1),
      PageDown: () => setAtiva(proxima(livres, ativa, 8)),
      PageUp: () => setAtiva(proxima(livres, ativa, -8)),
      Enter: () => escolher(ativa),
      ' ': () => escolher(ativa),
      Escape: () => fechar(),
      ...(atalho >= 0 ? { [e.key]: () => escolher(atalho) } : {}),
    };
    const acao = acoes[e.key];
    if (!acao) return false;
    e.preventDefault();
    if (e.key === 'Escape') e.stopPropagation();
    acao();
    return true;
  };

  const aoTeclar = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (aberto && (teclaNoSub(e) || teclaNaLista(e))) return;
    if (!aberto && ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      return abrir(e.key === 'Home' ? livres[0] : e.key === 'End' ? livres.at(-1) : undefined);
    }
    if (e.key === 'Tab' && aberto) return confirmar(sub?.foco ? opcoesSub[sub.ativa] : opcoes[ativa]);
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) procurar(e.key);
  };

  useEffect(() => {
    if (!aberto || ativa < 0) return;
    document.getElementById(idDaOpcao(base, ativa))?.scrollIntoView({ block: 'nearest' });
  }, [aberto, ativa, base]);

  useEffect(() => {
    const elemento = sub ? document.getElementById(idDaOpcao(base, sub.pai)) : null;
    setEstiloSub(elemento ? posicaoLateral(elemento.getBoundingClientRect(), { largura: window.innerWidth, altura: window.innerHeight }) : null);
  }, [sub?.pai, base, posicao]); // eslint-disable-line react-hooks/exhaustive-deps

  const icone = atual?.icone ?? p.prefixo;
  const ativaDescendente = !aberto ? undefined : sub?.foco && sub.ativa >= 0 ? idDaOpcao(baseSub, sub.ativa) : ativa >= 0 ? idDaOpcao(base, ativa) : undefined;
  return (
    <>
      <button
        ref={gatilho}
        id={p.id}
        type="button"
        role="combobox"
        aria-label={rotulo}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-activedescendant={ativaDescendente}
        className={`seletor seletor--${variante} ${aberto ? 'seletor--aberto' : ''} ${p.className ?? ''}`}
        disabled={desabilitado}
        title={p.titulo}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={aoTeclar}
      >
        {icone && <span className="seletor__icone">{icone}</span>}
        <span className={`seletor__texto ${atual ? '' : 'seletor__texto--vazio'}`}>{atual?.rotulo ?? p.vazio ?? 'Escolha…'}</span>
        <Icone nome="chevron-baixo" tamanho={15} className="seletor__seta" />
      </button>
      {createPortal(
        <AnimatePresence>
          {aberto && posicao && (
            <motion.div key="lista" ref={lista} id={idLista} role="listbox" aria-label={rotulo} className="flutuante" style={posicao.estilo} {...ANIMACAO} onPointerDown={(e) => e.preventDefault()}>
              <OpcoesFlutuantes opcoes={opcoes} base={base} valor={valor} ativa={ativa} aberta={sub?.pai} aoApontar={apontar} aoEscolher={escolher} />
            </motion.div>
          )}
          {aberto && sub && estiloSub && (
            <motion.div key={`sub-${sub.pai}`} ref={painelSub} role="listbox" aria-label={opcoes[sub.pai]?.rotulo} className="flutuante flutuante--sub" style={estiloSub} {...ANIMACAO} onPointerDown={(e) => e.preventDefault()}>
              <OpcoesFlutuantes
                opcoes={opcoesSub}
                base={baseSub}
                valor={valor}
                ativa={sub.ativa}
                aoApontar={(i) => setSub({ ...sub, ativa: i, foco: true })}
                aoEscolher={(i) => confirmar(opcoesSub[i])}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
