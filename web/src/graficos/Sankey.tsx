import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { motion } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import type { NoSankey } from '../api/tipos';
import { Icone } from '../icones/Icone';
import { pct, reais } from '../util/formato';
import { useTamanho } from './useTamanho';

type No = NoSankey & { indice?: number };
type Ligacao = { source: string; target: string; value: number };
type NoLayout = SankeyNode<No, Ligacao>;
type LigLayout = SankeyLink<No, Ligacao>;

interface Props {
  nos: NoSankey[];
  ligacoes: { origem: string; destino: string; valor: number }[];
  total: number;
  altura?: number;
}

const ROTULO = 170;

/**
 * O "de onde vem → para onde vai" do mês. As fitas se desenham da origem ao
 * destino e um brilho corre por elas sem parar — o dinheiro literalmente
 * fluindo. Passar o mouse numa ponta acende só o caminho dela.
 */
export function Sankey({ nos, ligacoes, total, altura = 460 }: Props) {
  const { ref, largura } = useTamanho<HTMLDivElement>(altura);
  const id = useId().replace(/:/g, '');
  const [foco, setFoco] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (nos.length === 0) return null;
    const gerador = sankey<No, Ligacao>()
      .nodeId((n) => n.id)
      .nodeWidth(12)
      .nodePadding(Math.max(10, Math.min(22, altura / (nos.length + 2))))
      .nodeSort(null)
      .extent([
        [ROTULO, 16],
        [Math.max(ROTULO + 200, largura - ROTULO), altura - 16],
      ]);
    return gerador({
      nodes: nos.map((n) => ({ ...n })),
      links: ligacoes.map((l) => ({ source: l.origem, target: l.destino, value: l.valor })),
    });
  }, [nos, ligacoes, largura, altura]);

  if (!layout) return null;
  const caminho = sankeyLinkHorizontal<No, Ligacao>();
  const ligadoAoFoco = (l: LigLayout) => {
    if (!foco) return true;
    const s = (l.source as NoLayout).id;
    const t = (l.target as NoLayout).id;
    return s === foco || t === foco;
  };

  return (
    <div ref={ref} className="grafico sankey" style={{ height: altura }}>
      <svg width={largura} height={altura} role="img" aria-label="De onde veio e para onde foi o dinheiro do mês">
        <defs>
          {layout.links.map((l, i) => {
            const s = l.source as NoLayout;
            const t = l.target as NoLayout;
            return (
              <linearGradient key={i} id={`fita${id}${i}`} gradientUnits="userSpaceOnUse" x1={s.x1} x2={t.x0}>
                <stop offset="0" stopColor={s.cor} />
                <stop offset="1" stopColor={t.cor} />
              </linearGradient>
            );
          })}
        </defs>

        <g>
          {layout.links.map((l, i) => {
            const d = caminho(l) ?? '';
            const aceso = ligadoAoFoco(l);
            const largura = Math.max(1.5, l.width ?? 1);
            const lado = (l.source as NoLayout).lado === 'ORIGEM' ? 0 : 0.5;
            return (
              <g key={i}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={`url(#fita${id}${i})`}
                  strokeWidth={largura}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: aceso ? 0.5 : 0.08 }}
                  transition={{ pathLength: { duration: 1.1, delay: lado + i * 0.04, ease: [0.65, 0, 0.35, 1] }, opacity: { duration: 0.25 } }}
                  style={{ mixBlendMode: 'screen' }}
                />
                {aceso && (
                  <motion.path
                    d={d}
                    fill="none"
                    stroke="white"
                    strokeOpacity={0.2}
                    strokeWidth={Math.max(1, largura * 0.45)}
                    strokeDasharray="6 42"
                    className="sankey__corrente"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.4 + lado }}
                    style={{ animationDuration: `${2.4 + (i % 5) * 0.35}s` }}
                  />
                )}
              </g>
            );
          })}
        </g>

        {layout.nodes.map((n, i) => {
          const no = n as NoLayout;
          const x0 = no.x0 ?? 0;
          const x1 = no.x1 ?? 0;
          const y0 = no.y0 ?? 0;
          const y1 = no.y1 ?? 0;
          const aceso = !foco || foco === no.id || layout.links.some((l) => ligadoAoFoco(l) && ((l.source as NoLayout).id === no.id || (l.target as NoLayout).id === no.id));
          const esquerda = no.lado === 'ORIGEM';
          const centro = no.lado === 'CENTRO';
          const meio = (y0 + y1) / 2;
          return (
            <g key={no.id} onPointerEnter={() => !centro && setFoco(no.id)} onPointerLeave={() => setFoco(null)} style={{ cursor: centro ? 'default' : 'pointer' }}>
              <motion.rect
                x={x0}
                width={x1 - x0}
                rx={4}
                fill={no.cor}
                initial={{ y: meio, height: 0 }}
                animate={{ y: y0, height: Math.max(2, y1 - y0), opacity: aceso ? 1 : 0.25 }}
                transition={{ type: 'spring', stiffness: 160, damping: 22, delay: 0.1 + i * 0.03 }}
                style={{ filter: `drop-shadow(0 0 10px ${no.cor}66)` }}
              />
              {!centro && (
                <motion.foreignObject
                  x={esquerda ? x0 - ROTULO + 4 : x1 + 10}
                  y={meio - 20}
                  width={ROTULO - 14}
                  height={40}
                  initial={{ opacity: 0, x: esquerda ? -10 : 10 }}
                  animate={{ opacity: aceso ? 1 : 0.3, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.03 }}
                >
                  <div className={`sankey__rotulo ${esquerda ? 'sankey__rotulo--esq' : ''}`}>
                    <span className="sankey__icone" style={{ color: no.cor }}><Icone nome={no.icone} tamanho={14} /></span>
                    <span className="sankey__textos">
                      <span className="sankey__nome">{no.nome}</span>
                      <span className="sankey__valor numero valor-privado">
                        {reais(no.valor)} <em>{pct(no.valor / total)}</em>
                      </span>
                    </span>
                  </div>
                </motion.foreignObject>
              )}
              {centro && (
                <motion.text x={(x0 + x1) / 2} y={y0 - 8} textAnchor="middle" className="sankey__centro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
                  {no.nome}
                </motion.text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
