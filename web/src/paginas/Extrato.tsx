import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCategorias, useEstado, useMovimentos, type FiltroExtrato } from '../api/consultas';
import type { Movimento, Natureza } from '../api/tipos';
import { opcoesDeCategoria } from '../componentes/opcoes';
import { Seletor } from '../componentes/Seletor';
import { Botao, Cartao, Carregando, Pagina, Vazio } from '../componentes/ui';
import { Icone } from '../icones/Icone';
import { diaAmigavel, inteiro, reais } from '../util/formato';
import { useMes } from '../util/useMes';
import { EditorMovimento } from './componentes/EditorMovimento';
import { LinhaMovimento } from './componentes/LinhaMovimento';

const FILTROS_NATUREZA: { valor: Natureza | undefined; nome: string }[] = [
  { valor: undefined, nome: 'Tudo' },
  { valor: 'DESPESA', nome: 'Gastos' },
  { valor: 'RECEITA', nome: 'Receitas' },
  { valor: 'PAGAMENTO_FATURA', nome: 'Fatura' },
  { valor: 'INVESTIMENTO', nome: 'Caixinhas' },
  { valor: 'TRANSFERENCIA', nome: 'Entre contas' },
  { valor: 'ESTORNO', nome: 'Estornos' },
];

function usarAtraso<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

export function Extrato() {
  const { mes } = useMes();
  const [params, setParams] = useSearchParams();
  const estado = useEstado().data;
  const categorias = useCategorias().data ?? [];
  const [busca, setBusca] = useState('');
  const [contaId, setContaId] = useState<string | undefined>();
  const [natureza, setNatureza] = useState<Natureza | undefined>();
  const [categoriaId, setCategoriaId] = useState<string | undefined>();
  const [por, setPor] = useState<'data' | 'competencia'>('data');
  const [todosOsMeses, setTodosOsMeses] = useState(false);
  const [editados, setEditados] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<Movimento | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const buscaAtrasada = usarAtraso(busca, 220);

  useEffect(() => {
    if (params.get('focar')) {
      campo.current?.focus();
      params.delete('focar');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const filtro: FiltroExtrato = {
    mes: todosOsMeses || buscaAtrasada ? undefined : mes,
    por,
    contaId,
    natureza,
    categoriaId,
    busca: buscaAtrasada || undefined,
    editados,
    pagina,
  };
  useEffect(() => setPagina(1), [mes, por, contaId, natureza, categoriaId, buscaAtrasada, editados, todosOsMeses]);

  const { data, isLoading, isFetching } = useMovimentos(filtro);
  const contas = estado?.conexoes.flatMap((c) => c.contas) ?? [];
  const hoje = estado?.hoje ?? '';

  const grupos = useMemo(() => {
    const mapa = new Map<string, Movimento[]>();
    for (const m of data?.itens ?? []) mapa.set(m.data, [...(mapa.get(m.data) ?? []), m]);
    return [...mapa.entries()];
  }, [data]);

  return (
    <Pagina>
      <Cartao className="filtros">
        <div className="filtros__linha">
          <label className="busca">
            <Icone nome="busca" tamanho={17} />
            <input
              ref={campo}
              className="entrada"
              placeholder="Buscar por nome, loja, pessoa, nota ou valor…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar movimentos"
            />
          </label>
          <Seletor
            className="selecao"
            rotulo="Conta"
            valor={contaId ?? ''}
            aoMudar={(v) => setContaId(v || undefined)}
            opcoes={[
              { valor: '', rotulo: 'Todas as contas', icone: <Icone nome="camadas" tamanho={16} /> },
              ...contas.map((c) => ({ valor: c.id, rotulo: c.nome, icone: <Icone nome={c.tipo === 'CARTAO' ? 'cartao' : 'banco'} tamanho={16} /> })),
            ]}
          />
          <Seletor
            className="selecao"
            rotulo="Categoria"
            valor={categoriaId ?? ''}
            aoMudar={(v) => setCategoriaId(v || undefined)}
            opcoes={[{ valor: '', rotulo: 'Todas as categorias', icone: <Icone nome="filtro" tamanho={16} /> }, ...opcoesDeCategoria(categorias)]}
          />
        </div>
        <div className="filtros__linha">
          <div className="chips">
            {FILTROS_NATUREZA.map((f) => (
              <button key={f.nome} type="button" className={`chip ${natureza === f.valor ? 'chip--ativo' : ''}`} onClick={() => setNatureza(f.valor)}>
                {f.nome}
              </button>
            ))}
          </div>
          <div className="chips filtros__direita">
            <button type="button" className={`chip ${editados ? 'chip--ativo' : ''}`} onClick={() => setEditados((v) => !v)}>
              <Icone nome="editar" tamanho={13} /> Editados
            </button>
            <button type="button" className={`chip ${todosOsMeses ? 'chip--ativo' : ''}`} onClick={() => setTodosOsMeses((v) => !v)} title="Ignorar o mês escolhido lá em cima">
              <Icone nome="calendario" tamanho={13} /> Todos os meses
            </button>
            <button
              type="button"
              className={`chip ${por === 'competencia' ? 'chip--ativo' : ''}`}
              onClick={() => setPor((p) => (p === 'data' ? 'competencia' : 'data'))}
              title="Pelo mês da compra: parcelas aparecem no mês a que pertencem"
            >
              <Icone nome="camadas" tamanho={13} /> {por === 'data' ? 'Pela data' : 'Pelo mês da compra'}
            </button>
          </div>
        </div>
      </Cartao>

      <div className="resumo-extrato">
        <span>{data ? `${inteiro(data.total)} movimento${data.total === 1 ? '' : 's'}` : '…'}</span>
        {data && (
          <>
            <span className="resumo-extrato__item"><i style={{ background: 'var(--entrada)' }} />Entradas <strong className="numero valor-privado">{reais(data.entradas)}</strong></span>
            <span className="resumo-extrato__item"><i style={{ background: 'var(--saida)' }} />Gastos <strong className="numero valor-privado">{reais(data.saidas)}</strong></span>
          </>
        )}
        {isFetching && <Icone nome="sincronizar" tamanho={14} className="girando texto-3" />}
      </div>

      {isLoading ? (
        <Carregando linhas={5} />
      ) : grupos.length === 0 ? (
        <Cartao>
          <Vazio icone="busca" titulo="Nada encontrado" texto="Tente outra busca ou tire algum filtro." />
        </Cartao>
      ) : (
        <Cartao className="extrato">
          <AnimatePresence initial={false}>
            {grupos.map(([dia, itens], gi) => {
              const saldoDoDia = itens.reduce((s, m) => s + (m.natureza === 'RECEITA' || m.natureza === 'ESTORNO' ? m.valor : m.natureza === 'DESPESA' ? -m.valor : 0), 0);
              return (
                <motion.div key={dia} className="extrato__dia" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(gi * 0.03, 0.3) }}>
                  <div className="extrato__cabeca">
                    <span>{diaAmigavel(dia, hoje)}</span>
                    {saldoDoDia !== 0 && <span className={`numero valor-privado ${saldoDoDia > 0 ? 'valor--positivo' : 'texto-3'}`}>{saldoDoDia > 0 ? '+' : '−'} {reais(Math.abs(saldoDoDia))}</span>}
                  </div>
                  {itens.map((m) => (
                    <LinhaMovimento key={m.id} m={m} aoClicar={() => setAberto(m)} />
                  ))}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {data && data.paginas > 1 && (
            <div className="paginacao">
              <Botao pequeno icone="chevron-esq" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Botao>
              <span className="texto-3">Página {data.pagina} de {data.paginas}</span>
              <Botao pequeno disabled={pagina >= data.paginas} onClick={() => setPagina((p) => p + 1)}>Próxima <Icone nome="chevron-dir" tamanho={15} /></Botao>
            </div>
          )}
        </Cartao>
      )}
      <EditorMovimento m={aberto} aoFechar={() => setAberto(null)} />
    </Pagina>
  );
}
