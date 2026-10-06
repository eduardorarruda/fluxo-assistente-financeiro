import { arc, pie } from 'd3-shape';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { pct, reais } from '../util/formato';

export interface Fatia {
  id: string;
  nome: string;
  valor: number;
  cor: string;
}

/**
 * Rosca de composição. As fatias se abrem em sequência; passar o mouse
 * destaca a fatia e o centro passa a contar a história dela.
 */
export function Rosca({ fatias, tamanho = 220, rotuloCentro = 'Total', aoFocar }: { fatias: Fatia[]; tamanho?: number; rotuloCentro?: string; aoFocar?: (id: string | null) => void }) {
  const [foco, setFoco] = useState<string | null>(null);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const raio = tamanho / 2;
  const arcos = useMemo(() => pie<Fatia>().value((f) => f.valor).sort(null).padAngle(0.018)(fatias), [fatias]);
  const gerar = arc<(typeof arcos)[number]>().cornerRadius(5);
  const focada = fatias.find((f) => f.id === foco);

  const focar = (id: string | null) => {
    setFoco(id);
    aoFocar?.(id);
  };

  return (
    <div className="rosca" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} viewBox={`${-raio} ${-raio} ${tamanho} ${tamanho}`} role="img" aria-label="Composição dos gastos">
        {arcos.map((a, i) => {
          const ativo = foco === a.data.id;
          const d = gerar({ ...a, innerRadius: raio * 0.66, outerRadius: ativo ? raio : raio - 8 } as never) ?? '';
          return (
            <motion.path
              key={a.data.id}
              d={d}
              fill={a.data.cor}
              initial={{ opacity: 0, scale: 0.6, rotate: -40 }}
              animate={{ opacity: foco && !ativo ? 0.35 : 1, scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 120, damping: 18, delay: i * 0.06 }}
              onPointerEnter={() => focar(a.data.id)}
              onPointerLeave={() => focar(null)}
              style={{ cursor: 'pointer', filter: ativo ? `drop-shadow(0 0 12px ${a.data.cor})` : undefined }}
            />
          );
        })}
      </svg>
      <div className="rosca__centro">
        <motion.span key={focada?.id ?? 'total'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rosca__rotulo">
          {focada ? focada.nome : rotuloCentro}
        </motion.span>
        <motion.strong key={`v${focada?.id ?? 'total'}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="numero valor-privado rosca__valor">
          {reais(focada ? focada.valor : total)}
        </motion.strong>
        {focada && total > 0 && <span className="rosca__pct">{pct(focada.valor / total)} do total</span>}
      </div>
    </div>
  );
}
