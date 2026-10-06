import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { motion } from 'motion/react';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { reaisCompacto } from '../util/formato';
import { Dica } from './Dica';
import { useTamanho } from './useTamanho';

export interface PontoArea {
  rotulo: string;
  valor: number;
}

interface Props {
  pontos: PontoArea[];
  cor?: string;
  altura?: number;
  eixo?: boolean;
  dica?: (p: PontoArea, i: number) => ReactNode;
}

const M = { topo: 16, dir: 12, baixo: 26, esq: 56 };

/** Área com linha suave. A linha se desenha, a área acende, e o ponteiro revela cada ponto. */
export function GraficoArea({ pontos, cor = 'var(--marca)', altura = 220, eixo = true, dica }: Props) {
  const { ref, largura } = useTamanho<HTMLDivElement>(altura);
  const id = useId().replace(/:/g, '');
  const [foco, setFoco] = useState<number | null>(null);
  const m = eixo ? M : { topo: 8, dir: 4, baixo: 8, esq: 4 };

  const { x, y, caminhoLinha, caminhoArea, marcas } = useMemo(() => {
    const valores = pontos.map((p) => p.valor);
    const min = Math.min(...valores, 0);
    const max = Math.max(...valores, 1);
    const folga = (max - min) * 0.12 || 1;
    const x = scaleLinear().domain([0, Math.max(1, pontos.length - 1)]).range([m.esq, largura - m.dir]);
    // Série só positiva não desce abaixo de zero; com negativos, dá folga para baixo também.
    const inferior = min >= 0 ? Math.max(0, min - folga) : min - folga;
    const y = scaleLinear().domain([inferior, max + folga]).nice(4).range([altura - m.baixo, m.topo]);
    const gerarLinha = line<PontoArea>().x((_, i) => x(i)).y((p) => y(p.valor)).curve(curveMonotoneX);
    const gerarArea = area<PontoArea>().x((_, i) => x(i)).y0(altura - m.baixo).y1((p) => y(p.valor)).curve(curveMonotoneX);
    return { x, y, caminhoLinha: gerarLinha(pontos) ?? '', caminhoArea: gerarArea(pontos) ?? '', marcas: y.ticks(4) };
  }, [pontos, largura, altura, m.baixo, m.dir, m.esq, m.topo]);

  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - caixa.left;
    const i = Math.round(x.invert(px));
    setFoco(Math.max(0, Math.min(pontos.length - 1, i)));
  };

  const pf = foco !== null ? pontos[foco] : null;
  return (
    <div ref={ref} className="grafico" style={{ height: altura }}>
      <svg width={largura} height={altura} onPointerMove={aoMover} onPointerLeave={() => setFoco(null)} role="img" aria-label="Gráfico de evolução">
        <defs>
          <linearGradient id={`area${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={cor} stopOpacity={0.34} />
            <stop offset="1" stopColor={cor} stopOpacity={0} />
          </linearGradient>
          <filter id={`brilho${id}`} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {eixo &&
          marcas.map((v) => (
            <g key={v}>
              <line x1={m.esq} x2={largura - m.dir} y1={y(v)} y2={y(v)} className="grafico__grade" />
              <text x={m.esq - 10} y={y(v)} className="grafico__eixo" textAnchor="end" dominantBaseline="middle">
                {reaisCompacto(v)}
              </text>
            </g>
          ))}
        {eixo &&
          pontos.map((p, i) =>
            pontos.length <= 13 || i % 2 === 0 ? (
              <text key={i} x={x(i)} y={altura - 6} className="grafico__eixo" textAnchor="middle">
                {p.rotulo}
              </text>
            ) : null,
          )}
        <motion.path d={caminhoArea} fill={`url(#area${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.35 }} />
        <motion.path
          d={caminhoLinha}
          fill="none"
          stroke={cor}
          strokeWidth={2.5}
          strokeLinecap="round"
          filter={`url(#brilho${id})`}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.3, ease: [0.65, 0, 0.35, 1] }}
        />
        {pf && foco !== null && (
          <g>
            <line x1={x(foco)} x2={x(foco)} y1={m.topo} y2={altura - m.baixo} className="grafico__mira" />
            <motion.circle cx={x(foco)} cy={y(pf.valor)} r={5} fill="var(--fundo)" stroke={cor} strokeWidth={2.5} layout />
          </g>
        )}
        {foco === null && pontos.length > 0 && (
          <motion.circle
            cx={x(pontos.length - 1)}
            cy={y(pontos[pontos.length - 1]!.valor)}
            r={4}
            fill={cor}
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.4, 1] }}
            transition={{ delay: 1.2, duration: 0.5 }}
          />
        )}
      </svg>
      {dica && (
        <Dica x={foco !== null ? x(foco) : 0} y={pf ? y(pf.valor) : 0} visivel={pf !== null} largura={largura}>
          {pf && foco !== null && dica(pf, foco)}
        </Dica>
      )}
    </div>
  );
}
