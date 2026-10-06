import { AnimatePresence, motion } from 'motion/react';
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Dia, Mes } from '../api/tipos';
import { Icone } from '../icones/Icone';
import { capitalizar, diaDaSemana, diaEMes, nomeDoMes, SEMANA_CURTA, somarMeses } from '../util/formato';
import { useCliqueFora, usePosicaoFlutuante } from './flutuante';

/**
 * Escolha de um dia, no lugar do <input type="date"> nativo (que o sistema
 * desenha do jeito dele). Um botão como os do Seletor abre um calendário:
 * setas andam pelos dias, PageUp/PageDown trocam o mês, Home/End vão ao começo
 * e ao fim da semana, Enter/Espaço escolhem e Esc fecha.
 */

export interface PropsCampoData {
  /** 'AAAA-MM-DD' ou '' (nenhum). */
  valor: Dia;
  aoMudar: (dia: Dia) => void;
  /** Hoje, no fuso do servidor (o `hoje` do estado). */
  hoje: Dia;
  /** Nome acessível ("Vencimento"). */
  rotulo: string;
  vazio?: string;
  id?: string;
  desabilitado?: boolean;
}

const ANIMACAO = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.1 } },
  transition: { type: 'spring', stiffness: 520, damping: 34 },
} as const;

const dois = (n: number) => String(n).padStart(2, '0');

function paraData(dia: Dia): Date {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(a, m - 1, d);
}

function deData(data: Date): Dia {
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

export function somarDiasA(dia: Dia, n: number): Dia {
  const data = paraData(dia);
  data.setDate(data.getDate() + n);
  return deData(data);
}

/** Mesmo dia em outro mês, limitado ao fim dele (31/01 + 1 mês = 28/02). */
function somarMesesAoDia(dia: Dia, n: number): Dia {
  const mes = somarMeses(dia.slice(0, 7), n);
  const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  return `${mes}-${dois(Math.min(Number(dia.slice(8, 10)), ultimo))}`;
}

/** As semanas (domingo a sábado) que cobrem o mês; dias de fora vêm como null. */
export function semanasDoMes(mes: Mes): (Dia | null)[][] {
  const [a, m] = [Number(mes.slice(0, 4)), Number(mes.slice(5, 7))];
  const primeiro = new Date(a, m - 1, 1).getDay();
  const total = new Date(a, m, 0).getDate();
  const celulas: (Dia | null)[] = [...Array<null>(primeiro).fill(null)];
  for (let d = 1; d <= total; d++) celulas.push(`${mes}-${dois(d)}`);
  while (celulas.length % 7) celulas.push(null);
  const semanas: (Dia | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

/** "sexta, 10 de outubro de 2026" */
export function dataPorExtenso(dia: Dia): string {
  const mes = nomeDoMes(dia.slice(0, 7));
  return `${capitalizar(diaDaSemana(dia))}, ${Number(dia.slice(8, 10))} de ${mes}`;
}

/** "Sáb, 10 out 2026": cabe no campo; o leitor de tela recebe a data por extenso. */
export function dataNoCampo(dia: Dia): string {
  return `${capitalizar(SEMANA_CURTA[paraData(dia).getDay()]!)}, ${diaEMes(dia)} ${dia.slice(0, 4)}`;
}

export function CampoData({ valor, aoMudar, hoje, rotulo, vazio = 'Escolha o dia', id, desabilitado = false }: PropsCampoData) {
  const base = useId();
  const gatilho = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState<Dia>(valor || hoje);
  const mes = foco.slice(0, 7);
  const posicao = usePosicaoFlutuante(gatilho, aberto);
  const semanas = useMemo(() => semanasDoMes(mes), [mes]);

  const fechar = useCallback((devolverFoco = true) => {
    setAberto(false);
    if (devolverFoco) gatilho.current?.focus();
  }, []);
  const dentro = useMemo(() => [gatilho, painel], []);
  useCliqueFora(aberto, dentro, () => fechar(false));

  // Com o calendário aberto, o foco acompanha o dia em destaque.
  useEffect(() => {
    if (!aberto) return;
    const quadro = requestAnimationFrame(() => painel.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus());
    return () => cancelAnimationFrame(quadro);
  }, [aberto, foco]);

  const abrir = () => {
    if (desabilitado) return;
    setFoco(valor || hoje);
    setAberto(true);
  };

  const escolher = (dia: Dia) => {
    fechar();
    if (dia !== valor) aoMudar(dia);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    // Tab sai do calendário pelo botão: o foco segue para o campo seguinte do formulário.
    if (e.key === 'Tab') return fechar();
    const acoes: Record<string, () => void> = {
      ArrowLeft: () => setFoco(somarDiasA(foco, -1)),
      ArrowRight: () => setFoco(somarDiasA(foco, 1)),
      ArrowUp: () => setFoco(somarDiasA(foco, -7)),
      ArrowDown: () => setFoco(somarDiasA(foco, 7)),
      PageUp: () => setFoco(somarMesesAoDia(foco, e.shiftKey ? -12 : -1)),
      PageDown: () => setFoco(somarMesesAoDia(foco, e.shiftKey ? 12 : 1)),
      Home: () => setFoco(somarDiasA(foco, -paraData(foco).getDay())),
      End: () => setFoco(somarDiasA(foco, 6 - paraData(foco).getDay())),
      Escape: () => fechar(),
    };
    const acao = acoes[e.key];
    if (!acao) return;
    e.preventDefault();
    // Esc fecha só o calendário, não o diálogo em volta.
    e.stopPropagation();
    acao();
  };

  const idPainel = `${base}-calendario`;
  const idTitulo = `${base}-titulo`;
  return (
    <>
      <button
        ref={gatilho}
        id={id}
        type="button"
        aria-label={`${rotulo}: ${valor ? dataPorExtenso(valor) : vazio}`}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        className={`seletor seletor--campo campo-data ${aberto ? 'seletor--aberto' : ''}`}
        disabled={desabilitado}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={(e) => {
          if (!aberto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            abrir();
          }
        }}
      >
        <span className="seletor__icone"><Icone nome="calendario" tamanho={16} /></span>
        <span className={`seletor__texto ${valor ? '' : 'seletor__texto--vazio'}`}>{valor ? dataNoCampo(valor) : vazio}</span>
        <Icone nome="chevron-baixo" tamanho={15} className="seletor__seta" />
      </button>
      {createPortal(
        <AnimatePresence>
          {aberto && posicao && (
            <motion.div
              key="calendario"
              ref={painel}
              id={idPainel}
              role="dialog"
              aria-modal="false"
              aria-labelledby={idTitulo}
              className="flutuante calendario"
              style={{ ...posicao.estilo, maxHeight: 'none', minWidth: 0 }}
              onKeyDown={aoTeclar}
              {...ANIMACAO}
            >
              <div className="calendario__topo">
                <button type="button" className="calendario__nav" aria-label="Mês anterior" onClick={() => setFoco(somarMesesAoDia(foco, -1))}>
                  <Icone nome="chevron-esq" tamanho={16} />
                </button>
                <strong id={idTitulo} className="calendario__mes" aria-live="polite">{capitalizar(nomeDoMes(mes))}</strong>
                <button type="button" className="calendario__nav" aria-label="Próximo mês" onClick={() => setFoco(somarMesesAoDia(foco, 1))}>
                  <Icone nome="chevron-dir" tamanho={16} />
                </button>
              </div>
              <table className="calendario__grade" role="grid" aria-labelledby={idTitulo}>
                <thead>
                  <tr>
                    {SEMANA_CURTA.map((d) => <th key={d} scope="col" abbr={d}>{d.charAt(0).toUpperCase()}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {semanas.map((semana, i) => (
                    <tr key={i}>
                      {semana.map((dia, j) => (
                        <td key={dia ?? `vazio-${i}-${j}`} role="gridcell" aria-selected={dia ? dia === valor : undefined}>
                          {dia && (
                            <button
                              type="button"
                              data-dia={dia}
                              tabIndex={dia === foco ? 0 : -1}
                              aria-label={dataPorExtenso(dia)}
                              aria-current={dia === hoje ? 'date' : undefined}
                              className={[
                                'calendario__dia',
                                dia === valor && 'calendario__dia--escolhido',
                                dia === hoje && 'calendario__dia--hoje',
                                dia === foco && 'calendario__dia--foco',
                              ].filter(Boolean).join(' ')}
                              onClick={() => escolher(dia)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  escolher(dia);
                                }
                              }}
                            >
                              {Number(dia.slice(8, 10))}
                            </button>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="calendario__rodape">
                <button type="button" className="calendario__atalho" onClick={() => escolher(hoje)}>Hoje</button>
                <button type="button" className="calendario__atalho" onClick={() => escolher(somarDiasA(hoje, 1))}>Amanhã</button>
                <button type="button" className="calendario__atalho" onClick={() => escolher(somarDiasA(hoje, 7))}>Daqui a 7 dias</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
