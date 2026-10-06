import { scaleBand, scaleLinear } from 'd3-scale';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { mesCurtoSemAno, reais, reaisCompacto } from '../util/formato';
import { Dica } from './Dica';
import { useTamanho } from './useTamanho';

interface Mes {
  mes: string;
  receitas: number;
  despesas: number;
  guardado: number;
  resultado: number;
}

const M = { topo: 14, dir: 8, baixo: 26, esq: 56 };

/** Doze meses lado a lado: quanto entrou (menta) × quanto saiu (rosa). As barras crescem em onda. */
export function BarrasMensais({ meses, altura = 240, mesAtivo, aoEscolher }: { meses: Mes[]; altura?: number; mesAtivo?: string; aoEscolher?: (mes: string) => void }) {
  const { ref, largura } = useTamanho<HTMLDivElement>(altura);
  const [foco, setFoco] = useState<number | null>(null);

  const { x, y, dentro, marcas } = useMemo(() => {
    const max = Math.max(1, ...meses.flatMap((m) => [m.receitas, m.despesas]));
    const x = scaleBand<number>().domain(meses.map((_, i) => i)).range([M.esq, largura - M.dir]).padding(0.28);
    const dentro = scaleBand<string>().domain(['r', 'd']).range([0, x.bandwidth()]).padding(0.14);
    const y = scaleLinear().domain([0, max * 1.08]).nice(4).range([altura - M.baixo, M.topo]);
    return { x, y, dentro, marcas: y.ticks(4) };
  }, [meses, largura, altura]);

  const pf = foco !== null ? meses[foco] : null;
  const base = altura - M.baixo;
  return (
    <div ref={ref} className="grafico" style={{ height: altura }}>
      <svg width={largura} height={altura} onPointerLeave={() => setFoco(null)} role="img" aria-label="Receitas e despesas por mês">
        {marcas.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={largura - M.dir} y1={y(v)} y2={y(v)} className="grafico__grade" />
            <text x={M.esq - 10} y={y(v)} className="grafico__eixo" textAnchor="end" dominantBaseline="middle">
              {reaisCompacto(v)}
            </text>
          </g>
        ))}
        {meses.map((m, i) => {
          const x0 = x(i) ?? 0;
          const ativo = m.mes === mesAtivo;
          return (
            <g
              key={m.mes}
              onPointerEnter={() => setFoco(i)}
              onClick={() => aoEscolher?.(m.mes)}
              style={{ cursor: aoEscolher ? 'pointer' : undefined }}
            >
              <rect x={x0 - 6} y={M.topo} width={x.bandwidth() + 12} height={base - M.topo} rx={10} className={`grafico__coluna ${foco === i || ativo ? 'grafico__coluna--ativa' : ''}`} />
              {(['r', 'd'] as const).map((k, j) => {
                const v = k === 'r' ? m.receitas : m.despesas;
                const h = Math.max(0, base - y(v));
                return (
                  <motion.rect
                    key={k}
                    x={x0 + (dentro(k) ?? 0)}
                    width={dentro.bandwidth()}
                    rx={Math.min(5, dentro.bandwidth() / 2)}
                    fill={k === 'r' ? 'var(--entrada)' : 'var(--saida)'}
                    initial={{ y: base, height: 0 }}
                    animate={{ y: base - h, height: h, opacity: foco === null || foco === i ? 1 : 0.4 }}
                    transition={{ type: 'spring', stiffness: 140, damping: 20, delay: i * 0.035 + j * 0.05 }}
                  />
                );
              })}
              <text x={x0 + x.bandwidth() / 2} y={altura - 6} textAnchor="middle" className={`grafico__eixo ${ativo ? 'grafico__eixo--ativo' : ''}`}>
                {mesCurtoSemAno(m.mes)}
              </text>
            </g>
          );
        })}
      </svg>
      <Dica x={foco !== null ? (x(foco) ?? 0) + x.bandwidth() / 2 : 0} y={altura / 2.4} visivel={pf !== null} largura={largura}>
        {pf && (
          <div className="dica__tabela">
            <strong className="dica__titulo">{mesCurtoSemAno(pf.mes)} {pf.mes.slice(0, 4)}</strong>
            <span><i style={{ background: 'var(--entrada)' }} />Entrou</span><b className="numero">{reais(pf.receitas)}</b>
            <span><i style={{ background: 'var(--saida)' }} />Saiu</span><b className="numero">{reais(pf.despesas)}</b>
            <span><i style={{ background: 'var(--guardado)' }} />Guardou</span><b className="numero">{reais(pf.guardado)}</b>
            <span className="dica__linha">Sobrou</span><b className={`numero dica__linha ${pf.resultado >= 0 ? 'valor--positivo' : 'valor--negativo'}`}>{reais(pf.resultado)}</b>
          </div>
        )}
      </Dica>
    </div>
  );
}
