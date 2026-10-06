import { arc, pie } from 'd3-shape';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { pct } from '../../../util/formato';
import { formatarValor, PALETA, type EspecGrafico } from './especGrafico';

interface Fatia {
  nome: string;
  valor: number;
  cor: string;
}

const FATIAS_VISIVEIS = 7;
const TAMANHO = 200;

/** As maiores fatias e, se houver muitas, o resto somado em "Outros" (a tabela embaixo traz todas). */
export function agruparFatias(g: EspecGrafico): Fatia[] {
  const valores = g.series[0]?.valores ?? [];
  const pares = g.rotulos.map((nome, i) => ({ nome, valor: valores[i] ?? 0 })).filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
  const principais = pares.length > FATIAS_VISIVEIS + 1 ? pares.slice(0, FATIAS_VISIVEIS) : pares;
  const resto = pares.slice(principais.length).reduce((s, p) => s + p.valor, 0);
  const fatias = principais.map((p, i) => ({ ...p, cor: PALETA[i % PALETA.length]! }));
  return resto > 0 ? [...fatias, { nome: 'Outros', valor: resto, cor: 'var(--texto-3)' }] : fatias;
}

/** Composição em rosca: passar o ponteiro (numa fatia ou na legenda) conta a história daquela fatia no centro. */
export function GraficoPizza({ espec, descricao }: { espec: EspecGrafico; descricao: string }) {
  const [foco, setFoco] = useState<number | null>(null);
  const fatias = useMemo(() => agruparFatias(espec), [espec]);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const raio = TAMANHO / 2;
  const arcos = useMemo(() => pie<Fatia>().value((f) => f.valor).sort(null).padAngle(0.018)(fatias), [fatias]);
  const gerar = arc<(typeof arcos)[number]>().cornerRadius(4);
  const focada = foco !== null ? fatias[foco] : undefined;

  return (
    <div className="grafico-ia__pizza">
      <div className="rosca" style={{ width: TAMANHO, height: TAMANHO }}>
        <svg width={TAMANHO} height={TAMANHO} viewBox={`${-raio} ${-raio} ${TAMANHO} ${TAMANHO}`} role="img" aria-label={descricao}>
          {arcos.map((a, i) => {
            const ativo = foco === i;
            const d = gerar({ ...a, innerRadius: raio * 0.64, outerRadius: ativo ? raio : raio - 7 } as never) ?? '';
            return (
              <motion.path
                key={i}
                d={d}
                fill={a.data.cor}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: foco !== null && !ativo ? 0.35 : 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 120, damping: 18, delay: i * 0.05 }}
                onPointerEnter={() => setFoco(i)}
                onPointerLeave={() => setFoco(null)}
              />
            );
          })}
        </svg>
        <div className="rosca__centro" aria-hidden="true">
          <span className="rosca__rotulo">{focada ? focada.nome : 'Total'}</span>
          <strong className="numero rosca__valor">{formatarValor(focada ? focada.valor : total, espec.unidade)}</strong>
          {focada && total > 0 && <span className="rosca__pct">{pct(focada.valor / total)}</span>}
        </div>
      </div>
      <ul className="grafico-ia__fatias" aria-hidden="true">
        {fatias.map((f, i) => (
          <li key={i} className={foco === i ? 'grafico-ia__fatia--ativa' : ''} onPointerEnter={() => setFoco(i)} onPointerLeave={() => setFoco(null)}>
            <i style={{ background: f.cor }} />
            <span className="grafico-ia__fatia-nome">{f.nome}</span>
            <b className="numero">{formatarValor(f.valor, espec.unidade)}</b>
            <span className="numero texto-3">{total > 0 ? pct(f.valor / total) : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
