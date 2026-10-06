import { scaleBand, scaleLinear, type ScaleBand, type ScaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { motion } from 'motion/react';
import { type PointerEvent, useId, useMemo, useState } from 'react';
import { Dica } from '../../../graficos/Dica';
import { useTamanho } from '../../../graficos/useTamanho';
import { corDaSerie, formatarEixo, formatarValor, type EspecGrafico } from './especGrafico';

const M = { topo: 14, dir: 12, baixo: 28, esq: 62 };
const LARGURA_POR_ROTULO = 58;
const CARACTERES_DO_ROTULO = 10;
const FOLGA = 1.08;
const PONTOS_VISIVEIS = 24;

interface Escalas {
  x: ScaleBand<number>;
  y: ScaleLinear<number, number>;
  marcas: number[];
  /** Barras empilhadas: [base, topo] de cada série em cada rótulo. */
  pilhas: [number, number][][];
}

/** Domínio do eixo y: inclui o zero, soma as pilhas (positivas para cima, negativas para baixo) e dá uma folga. */
function montarEscalas(g: EspecGrafico, largura: number, altura: number, barras: boolean): Escalas {
  const empilhado = g.tipo === 'barras_empilhadas';
  const pilhas = g.series.map(() => [] as [number, number][]);
  const extremos: number[] = [0];
  g.rotulos.forEach((_, i) => {
    let positivo = 0;
    let negativo = 0;
    g.series.forEach((s, j) => {
      const v = s.valores[i] ?? 0;
      if (!empilhado) return void extremos.push(v);
      const base = v >= 0 ? positivo : negativo;
      pilhas[j]![i] = [base, base + v];
      if (v >= 0) positivo += v;
      else negativo += v;
    });
    if (empilhado) extremos.push(positivo, negativo);
  });
  const min = Math.min(...extremos);
  const max = Math.max(...extremos);
  const y = scaleLinear().domain([min * FOLGA, max === min ? 1 : max * FOLGA]).nice(4).range([altura - M.baixo, M.topo]);
  const x = scaleBand<number>().domain(g.rotulos.map((_, i) => i)).range([M.esq, Math.max(M.esq + 1, largura - M.dir)]).padding(barras ? 0.24 : 0);
  return { x, y, marcas: y.ticks(4), pilhas };
}

const encurtar = (r: string) => (r.length > CARACTERES_DO_ROTULO ? `${r.slice(0, CARACTERES_DO_ROTULO - 1)}…` : r);

interface Props {
  espec: EspecGrafico;
  descricao: string;
  altura?: number;
}

/** Barras (lado a lado ou empilhadas), linhas ou área, com várias séries, eixo formatado pela unidade e dica ao passar o ponteiro. */
export function GraficoSeries({ espec, descricao, altura = 260 }: Props) {
  const { ref, largura } = useTamanho<HTMLDivElement>(altura);
  const id = useId().replace(/:/g, '');
  const [foco, setFoco] = useState<number | null>(null);
  const barras = espec.tipo === 'barras' || espec.tipo === 'barras_empilhadas';
  const g = useMemo(() => montarEscalas(espec, largura, altura, barras), [espec, largura, altura, barras]);
  const n = espec.rotulos.length;
  const centro = (i: number) => (g.x(i) ?? 0) + g.x.bandwidth() / 2;
  const passoRotulo = Math.max(1, Math.ceil((n * LARGURA_POR_ROTULO) / Math.max(1, largura - M.esq - M.dir)));

  const aoMover = (e: PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setFoco(Math.max(0, Math.min(n - 1, Math.floor((px - M.esq) / Math.max(1, g.x.step())))));
  };

  return (
    <div ref={ref} className="grafico" style={{ height: altura }}>
      <svg width={largura} height={altura} onPointerMove={aoMover} onPointerLeave={() => setFoco(null)} role="img" aria-label={descricao}>
        {g.marcas.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={largura - M.dir} y1={g.y(v)} y2={g.y(v)} className="grafico__grade" />
            <text x={M.esq - 10} y={g.y(v)} className="grafico__eixo" textAnchor="end" dominantBaseline="middle">{formatarEixo(v, espec.unidade)}</text>
          </g>
        ))}
        {foco !== null && barras && (
          <rect x={(g.x(foco) ?? 0) - 4} y={M.topo} width={g.x.bandwidth() + 8} height={altura - M.baixo - M.topo} rx={8} className="grafico__coluna grafico__coluna--ativa" />
        )}
        {barras ? <Barras espec={espec} g={g} foco={foco} /> : <Curvas espec={espec} g={g} id={id} centro={centro} altura={altura} />}
        {foco !== null && !barras && <line x1={centro(foco)} x2={centro(foco)} y1={M.topo} y2={altura - M.baixo} className="grafico__mira" />}
        {espec.rotulos.map((r, i) => (i % passoRotulo === 0 ? (
          <text key={i} x={centro(i)} y={altura - 8} textAnchor="middle" className={`grafico__eixo ${foco === i ? 'grafico__eixo--ativo' : ''}`}>{encurtar(r)}</text>
        ) : null))}
      </svg>
      <Dica x={foco !== null ? centro(foco) : 0} y={altura / 2.4} visivel={foco !== null} largura={largura}>
        {foco !== null && <ConteudoDica espec={espec} indice={foco} />}
      </Dica>
    </div>
  );
}

function Barras({ espec, g, foco }: { espec: EspecGrafico; g: Escalas; foco: number | null }) {
  const empilhado = espec.tipo === 'barras_empilhadas';
  const dentro = scaleBand<number>().domain(espec.series.map((_, j) => j)).range([0, g.x.bandwidth()]).padding(0.12);
  const zero = g.y(0);
  return (
    <>
      {espec.series.map((s, j) => (
        <g key={j}>
          {s.valores.map((v, i) => {
            const [base, topo] = empilhado ? (g.pilhas[j]?.[i] ?? [0, v]) : [0, v];
            const y1 = g.y(Math.max(base, topo));
            const h = Math.max(0, g.y(Math.min(base, topo)) - y1);
            const largura = empilhado ? g.x.bandwidth() : dentro.bandwidth();
            return (
              <motion.rect
                key={i}
                x={(g.x(i) ?? 0) + (empilhado ? 0 : (dentro(j) ?? 0))}
                width={largura}
                rx={empilhado ? 2 : Math.min(5, largura / 2)}
                fill={corDaSerie(s, j)}
                initial={{ y: zero, height: 0 }}
                animate={{ y: y1, height: h, opacity: foco === null || foco === i ? 1 : 0.4 }}
                transition={{ type: 'spring', stiffness: 140, damping: 20, delay: Math.min(0.6, i * 0.025 + j * 0.04) }}
              />
            );
          })}
        </g>
      ))}
    </>
  );
}

function Curvas({ espec, g, id, centro, altura }: { espec: EspecGrafico; g: Escalas; id: string; centro: (i: number) => number; altura: number }) {
  const comArea = espec.tipo === 'area';
  const base = Math.min(altura - M.baixo, Math.max(M.topo, g.y(0)));
  return (
    <>
      <defs>
        {espec.series.map((s, j) => (
          <linearGradient key={j} id={`s${id}-${j}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={corDaSerie(s, j)} stopOpacity={0.3} />
            <stop offset="1" stopColor={corDaSerie(s, j)} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {espec.series.map((s, j) => {
        const linha = line<number>().x((_, i) => centro(i)).y((v) => g.y(v)).curve(curveMonotoneX)(s.valores) ?? '';
        const preenchimento = area<number>().x((_, i) => centro(i)).y0(base).y1((v) => g.y(v)).curve(curveMonotoneX)(s.valores) ?? '';
        const cor = corDaSerie(s, j);
        return (
          <g key={j}>
            {comArea && <motion.path d={preenchimento} fill={`url(#s${id}-${j})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />}
            <motion.path d={linha} fill="none" stroke={cor} strokeWidth={2.4} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }} />
            {s.valores.length <= PONTOS_VISIVEIS && s.valores.map((v, i) => <circle key={i} cx={centro(i)} cy={g.y(v)} r={3} fill="var(--fundo)" stroke={cor} strokeWidth={2} />)}
          </g>
        );
      })}
    </>
  );
}

function ConteudoDica({ espec, indice }: { espec: EspecGrafico; indice: number }) {
  const total = espec.series.reduce((soma, s) => soma + (s.valores[indice] ?? 0), 0);
  return (
    <div className="dica__tabela">
      <strong className="dica__titulo">{espec.rotulos[indice]}</strong>
      {espec.series.map((s, j) => (
        <span key={j} style={{ display: 'contents' }}>
          <span><i style={{ background: corDaSerie(s, j) }} />{s.nome}</span>
          <b className="numero">{formatarValor(s.valores[indice] ?? 0, espec.unidade)}</b>
        </span>
      ))}
      {espec.tipo === 'barras_empilhadas' && espec.series.length > 1 && (
        <>
          <span className="dica__linha">Total</span>
          <b className="numero dica__linha">{formatarValor(total, espec.unidade)}</b>
        </>
      )}
    </div>
  );
}
