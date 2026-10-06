import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { motion } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import { reais, reaisCompacto } from '../util/formato';
import { Dica } from './Dica';
import { useTamanho } from './useTamanho';

interface Ponto {
  dia: number;
  atual: number | null;
  anterior: number;
}

const M = { topo: 14, dir: 12, baixo: 24, esq: 56 };

/** Ritmo do mês: gasto acumulado dia a dia, este mês (cheio) contra o anterior (tracejado). */
export function GraficoRitmo({ pontos, altura = 240 }: { pontos: Ponto[]; altura?: number }) {
  const { ref, largura } = useTamanho<HTMLDivElement>(altura);
  const id = useId().replace(/:/g, '');
  const [foco, setFoco] = useState<number | null>(null);

  const g = useMemo(() => {
    const max = Math.max(1, ...pontos.map((p) => Math.max(p.anterior, p.atual ?? 0)));
    const x = scaleLinear().domain([1, Math.max(2, pontos.length)]).range([M.esq, largura - M.dir]);
    const y = scaleLinear().domain([0, max * 1.08]).nice(4).range([altura - M.baixo, M.topo]);
    const atuais = pontos.filter((p) => p.atual !== null);
    return {
      x,
      y,
      anterior: line<Ponto>().x((p) => x(p.dia)).y((p) => y(p.anterior)).curve(curveMonotoneX)(pontos) ?? '',
      atual: line<Ponto>().x((p) => x(p.dia)).y((p) => y(p.atual ?? 0)).curve(curveMonotoneX)(atuais) ?? '',
      areaAtual: area<Ponto>().x((p) => x(p.dia)).y0(altura - M.baixo).y1((p) => y(p.atual ?? 0)).curve(curveMonotoneX)(atuais) ?? '',
      marcas: y.ticks(4),
      ultimo: atuais.at(-1),
    };
  }, [pontos, largura, altura]);

  const pf = foco !== null ? pontos[foco - 1] : null;
  return (
    <div ref={ref} className="grafico" style={{ height: altura }}>
      <svg
        width={largura}
        height={altura}
        onPointerMove={(e) => {
          const caixa = e.currentTarget.getBoundingClientRect();
          setFoco(Math.max(1, Math.min(pontos.length, Math.round(g.x.invert(e.clientX - caixa.left)))));
        }}
        onPointerLeave={() => setFoco(null)}
        role="img"
        aria-label="Gasto acumulado no mês comparado ao mês anterior"
      >
        <defs>
          <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--saida)" stopOpacity={0.28} />
            <stop offset="1" stopColor="var(--saida)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {g.marcas.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={largura - M.dir} y1={g.y(v)} y2={g.y(v)} className="grafico__grade" />
            <text x={M.esq - 10} y={g.y(v)} className="grafico__eixo" textAnchor="end" dominantBaseline="middle">{reaisCompacto(v)}</text>
          </g>
        ))}
        {[1, 5, 10, 15, 20, 25, pontos.length].map((d) => (
          <text key={d} x={g.x(d)} y={altura - 6} textAnchor="middle" className="grafico__eixo">{d}</text>
        ))}
        <motion.path d={g.anterior} fill="none" stroke="var(--texto-3)" strokeWidth={1.8} strokeDasharray="5 6" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1 }} />
        <motion.path d={g.areaAtual} fill={`url(#r${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />
        <motion.path d={g.atual} fill="none" stroke="var(--saida)" strokeWidth={2.6} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }} />
        {g.ultimo && (
          <g>
            <circle cx={g.x(g.ultimo.dia)} cy={g.y(g.ultimo.atual ?? 0)} r={9} fill="var(--saida)" opacity={0.2} className="pulsar" />
            <circle cx={g.x(g.ultimo.dia)} cy={g.y(g.ultimo.atual ?? 0)} r={4} fill="var(--saida)" />
          </g>
        )}
        {pf && foco !== null && <line x1={g.x(foco)} x2={g.x(foco)} y1={M.topo} y2={altura - M.baixo} className="grafico__mira" />}
      </svg>
      <Dica x={foco !== null ? g.x(foco) : 0} y={altura / 2.5} visivel={pf !== null} largura={largura}>
        {pf && (
          <div className="dica__tabela">
            <strong className="dica__titulo">Até o dia {pf.dia}</strong>
            {pf.atual !== null && (<><span><i style={{ background: 'var(--saida)' }} />Este mês</span><b className="numero">{reais(pf.atual)}</b></>)}
            <span><i style={{ background: 'var(--texto-3)' }} />Mês anterior</span><b className="numero">{reais(pf.anterior)}</b>
          </div>
        )}
      </Dica>
    </div>
  );
}

/** Mini gráfico de linha para cartões. Sem eixo, só a tendência. */
export function Faisca({ valores, cor = 'var(--marca)', largura = 120, altura = 36 }: { valores: (number | null)[]; cor?: string; largura?: number; altura?: number }) {
  const id = useId().replace(/:/g, '');
  const pontos = valores.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (pontos.length < 2) return <svg width={largura} height={altura} />;
  const min = Math.min(...pontos.map((p) => p.v));
  const max = Math.max(...pontos.map((p) => p.v));
  const x = scaleLinear().domain([0, valores.length - 1]).range([2, largura - 2]);
  const y = scaleLinear().domain([min, max === min ? min + 1 : max]).range([altura - 3, 3]);
  const d = line<{ i: number; v: number }>().x((p) => x(p.i)).y((p) => y(p.v)).curve(curveMonotoneX)(pontos) ?? '';
  const a = area<{ i: number; v: number }>().x((p) => x(p.i)).y0(altura).y1((p) => y(p.v)).curve(curveMonotoneX)(pontos) ?? '';
  return (
    <svg width={largura} height={altura} aria-hidden="true">
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cor} stopOpacity={0.3} />
          <stop offset="1" stopColor={cor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path d={a} fill={`url(#f${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} />
      <motion.path d={d} fill="none" stroke={cor} strokeWidth={2} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} />
    </svg>
  );
}
