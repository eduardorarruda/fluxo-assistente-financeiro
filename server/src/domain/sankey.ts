import { CATEGORIA_POR_ID } from './categorias';
import type { ResumoMes } from './resumo';
import type { Centavos } from './types';

export type LadoSankey = 'ORIGEM' | 'CENTRO' | 'DESTINO';

export interface NoSankey {
  id: string;
  nome: string;
  lado: LadoSankey;
  cor: string;
  icone: string;
  valor: Centavos;
}

export interface LigacaoSankey {
  origem: string;
  destino: string;
  valor: Centavos;
}

export interface Sankey {
  nos: NoSankey[];
  ligacoes: LigacaoSankey[];
  total: Centavos;
  /** Parte do resgate de caixinhas que o mês não precisou: foi para outra coisa (fatura antiga, saldo). */
  resgateForaDoMes: Centavos;
}

const CENTRO: Omit<NoSankey, 'valor'> = { id: 'voce', nome: 'Você', lado: 'CENTRO', cor: '#8B5CF6', icone: 'fluxo' };

function noDeCategoria(categoriaId: string, lado: LadoSankey, valor: Centavos): NoSankey {
  const c = CATEGORIA_POR_ID.get(categoriaId);
  return {
    id: `${lado === 'ORIGEM' ? 'in' : 'out'}:${categoriaId}`,
    nome: c?.nome ?? categoriaId,
    lado,
    cor: c?.cor ?? '#64748B',
    icone: c?.icone ?? 'pontos',
    valor,
  };
}

/**
 * "De onde veio → para onde foi" de um mês. Por construção os dois lados
 * somam o mesmo: se gastou mais do que ganhou, a diferença entra como "Do
 * saldo"; se sobrou, sai como "Sobrou". Categorias além das `maxDestinos`
 * maiores são agrupadas para o desenho não virar espaguete.
 *
 * Resgate de caixinha só entra até cobrir o que faltou no mês. O resto não é
 * "sobra": o gasto é por competência e o resgate costuma pagar a fatura de
 * compras de meses anteriores. Esse resto sai em `resgateForaDoMes`.
 */
export function montarSankey(r: ResumoMes, maxDestinos = 8): Sankey {
  const origens: NoSankey[] = r.receitasPorCategoria
    .filter((c) => c.valor > 0)
    .map((c) => noDeCategoria(c.categoriaId, 'ORIGEM', c.valor));

  const positivas = r.porCategoria.filter((c) => c.valor > 0);
  const estornoLiquido = -r.porCategoria.filter((c) => c.valor < 0).reduce((s, c) => s + c.valor, 0);

  const destinos: NoSankey[] = positivas
    .slice(0, maxDestinos)
    .map((c) => noDeCategoria(c.categoriaId, 'DESTINO', c.valor));
  const resto = positivas.slice(maxDestinos).reduce((s, c) => s + c.valor, 0);
  if (resto > 0) {
    destinos.push({ id: 'out:demais', nome: 'Demais categorias', lado: 'DESTINO', cor: '#475569', icone: 'pontos', valor: resto });
  }

  if (r.guardado > 0) {
    destinos.push({ id: 'out:guardado', nome: 'Guardado', lado: 'DESTINO', cor: '#F5B83D', icone: 'cofre', valor: r.guardado });
  }
  if (estornoLiquido > 0) {
    origens.push({ id: 'in:estornos', nome: 'Estornos', lado: 'ORIGEM', cor: '#06B6D4', icone: 'volta', valor: estornoLiquido });
  }
  const resgate = Math.max(0, -r.guardado);
  const faltou = Math.max(0, destinos.reduce((s, n) => s + n.valor, 0) - origens.reduce((s, n) => s + n.valor, 0));
  const resgateUsado = Math.min(resgate, faltou);
  if (resgateUsado > 0) {
    origens.push({ id: 'in:resgate', nome: 'Resgate de caixinhas', lado: 'ORIGEM', cor: '#F5B83D', icone: 'cofre', valor: resgateUsado });
  }
  const resgateForaDoMes = resgate - resgateUsado;

  const somaOrigens = origens.reduce((s, n) => s + n.valor, 0);
  const somaDestinos = destinos.reduce((s, n) => s + n.valor, 0);
  if (somaOrigens > somaDestinos) {
    destinos.push({ id: 'out:sobra', nome: 'Sobrou', lado: 'DESTINO', cor: '#10B981', icone: 'check', valor: somaOrigens - somaDestinos });
  } else if (somaDestinos > somaOrigens) {
    origens.push({ id: 'in:saldo', nome: 'Do saldo', lado: 'ORIGEM', cor: '#FB7185', icone: 'alerta', valor: somaDestinos - somaOrigens });
  }

  const total = Math.max(somaOrigens, somaDestinos);
  if (total === 0) return { nos: [], ligacoes: [], total: 0, resgateForaDoMes };

  return {
    nos: [...origens, { ...CENTRO, valor: total }, ...destinos],
    ligacoes: [
      ...origens.map((n) => ({ origem: n.id, destino: CENTRO.id, valor: n.valor })),
      ...destinos.map((n) => ({ origem: CENTRO.id, destino: n.id, valor: n.valor })),
    ],
    total,
    resgateForaDoMes,
  };
}
