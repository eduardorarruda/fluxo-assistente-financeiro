import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useCategorias, useEscrita, useOrcamento } from '../api/consultas';
import type { LinhaOrcamento } from '../api/tipos';
import { useAvisar } from '../componentes/Avisos';
import { opcoesDeCategoria } from '../componentes/opcoes';
import { Seletor } from '../componentes/Seletor';
import { Anel, Barra, Botao, BotaoIcone, Carregando, Cartao, CategoriaIcone, Pagina, Selo, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { lerReais, pct, reais } from '../util/formato';
import { useMes } from '../util/useMes';

function EditorLimite({ inicial, aoSalvar, aoCancelar }: { inicial: number; aoSalvar: (c: number) => void; aoCancelar: () => void }) {
  const [texto, setTexto] = useState(inicial ? (inicial / 100).toFixed(2).replace('.', ',') : '');
  const valor = lerReais(texto);
  return (
    <form
      className="editor-limite"
      onSubmit={(e) => {
        e.preventDefault();
        if (valor !== null) aoSalvar(valor);
      }}
    >
      <span className="editor-limite__prefixo">R$</span>
      <input
        className="entrada"
        autoFocus
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && aoCancelar()}
        aria-label="Limite mensal"
      />
      <BotaoIcone icone="check" rotulo="Salvar" type="submit" disabled={valor === null} />
      <BotaoIcone icone="fechar" rotulo="Cancelar" onClick={aoCancelar} />
    </form>
  );
}

function Linha({ l, editando, aoEditar, aoSalvar }: { l: LinhaOrcamento; editando: boolean; aoEditar: () => void; aoSalvar: (c: number | null) => void }) {
  const cat = useCategoriaPorId()(l.categoriaId);
  const cor = l.situacao === 'ESTOUROU' ? 'var(--saida)' : l.situacao === 'ATENCAO' ? 'var(--atencao)' : cat.cor;
  const fracaoHoje = l.limite ? l.esperadoAteHoje / l.limite : 0;
  return (
    <motion.div layout className="orcamento-linha">
      <CategoriaIcone categoria={cat} tamanho={40} />
      <div className="orcamento-linha__meio">
        <div className="orcamento-linha__topo">
          <strong>{cat.nome}</strong>
          {editando ? (
            <EditorLimite inicial={l.limite} aoSalvar={aoSalvar} aoCancelar={() => aoSalvar(null)} />
          ) : (
            <button type="button" className="orcamento-linha__valores" onClick={aoEditar} title="Mudar o limite">
              <span className="numero valor-privado">{reais(l.gasto)}</span>
              <span className="texto-3"> de </span>
              <span className="numero valor-privado">{reais(l.limite)}</span>
              <Icone nome="editar" tamanho={13} className="texto-3" />
            </button>
          )}
        </div>
        <Barra valor={l.percentual} cor={cor} marca={fracaoHoje < 1 ? fracaoHoje : undefined} altura={10} />
        <div className="orcamento-linha__rodape pequeno">
          <span className={l.restante < 0 ? 'valor--negativo' : 'texto-3'}>
            {l.restante >= 0 ? `Restam ${reais(l.restante)}` : `${reais(-l.restante)} acima do limite`}
          </span>
          {l.projecao !== l.gasto && (
            <span className={l.projecao > l.limite ? 'valor--negativo' : 'texto-3'}>
              No ritmo atual, fecha o mês em {reais(l.projecao)}
            </span>
          )}
        </div>
      </div>
      <Selo tom={l.situacao === 'ESTOUROU' ? 'ruim' : l.situacao === 'ATENCAO' ? 'atencao' : 'bom'}>{pct(l.percentual)}</Selo>
    </motion.div>
  );
}

export function Orcamento() {
  const { mes } = useMes();
  const { data, isLoading } = useOrcamento(mes);
  const categorias = useCategorias().data ?? [];
  const categoria = useCategoriaPorId();
  const avisar = useAvisar();
  const [editando, setEditando] = useState<string | null>(null);
  const [nova, setNova] = useState('');
  const definir = useEscrita(({ categoriaId, limite }: { categoriaId: string; limite: number }) =>
    api.put(`/orcamento/${categoriaId}`, { limite }),
  );
  if (isLoading || !data) return <Carregando />;

  const salvar = (categoriaId: string, limite: number | null) => {
    setEditando(null);
    if (limite === null) return;
    definir.mutate(
      { categoriaId, limite },
      {
        onSuccess: () => avisar('sucesso', limite === 0 ? `Limite de ${categoria(categoriaId).nome} removido.` : `Limite de ${categoria(categoriaId).nome}: ${reais(limite)} por mês.`),
        onError: (e) => avisar('erro', (e as Error).message),
      },
    );
  };

  const usado = data.totalLimite ? data.totalGasto / data.totalLimite : 0;
  const semLimiteNenhum = categorias.filter((c) => c.grupo === 'DESPESA' && !data.linhas.some((l) => l.categoriaId === c.id));

  return (
    <Pagina>
      <div className="grade grade--8-12">
        <Cartao destaque className="orcamento-resumo">
          <Anel valor={usado} cor={usado > 1 ? 'var(--saida)' : usado > 0.8 ? 'var(--atencao)' : 'var(--marca)'} tamanho={150} espessura={12}>
            <span>
              <strong className="orcamento-resumo__pct">{pct(usado)}</strong>
              <small className="texto-3">do planejado</small>
            </span>
          </Anel>
          <div className="orcamento-resumo__numeros">
            <span><small className="texto-3">Gasto nas categorias com limite</small><Valor centavos={data.totalGasto} className="orcamento-resumo__valor" /></span>
            <span><small className="texto-3">Soma dos limites</small><strong className="numero valor-privado">{reais(data.totalLimite)}</strong></span>
            {data.receitas > 0 && (
              <span><small className="texto-3">Limites vs. o que entrou no mês</small><strong className="numero">{pct(data.totalLimite / data.receitas)}</strong></span>
            )}
          </div>
        </Cartao>
        <Cartao titulo="Como funciona" icone="info">
          <ul className="como-ler">
            <li><Icone nome="alvo" tamanho={16} /> <span>O limite vale para todo mês. O gasto conta pelo mês da compra, com as parcelas no mês de cada uma.</span></li>
            <li><Icone nome="relogio" tamanho={16} /> <span>O risquinho na barra mostra onde o gasto “deveria” estar hoje para fechar o mês no limite.</span></li>
            <li><Icone nome="editar" tamanho={16} /> <span>Clique no valor para mudar o limite. Zero remove.</span></li>
          </ul>
        </Cartao>
      </div>

      <Cartao titulo="Limites por categoria" icone="orcamento">
        {data.linhas.length === 0 ? (
          <Vazio icone="alvo" titulo="Nenhum limite ainda" texto="Comece pelas sugestões abaixo — elas partem da média do que você gastou nos últimos três meses." />
        ) : (
          <motion.div layout className="orcamento-linhas">
            <AnimatePresence initial={false}>
              {data.linhas.map((l) => (
                <Linha key={l.categoriaId} l={l} editando={editando === l.categoriaId} aoEditar={() => setEditando(l.categoriaId)} aoSalvar={(v) => salvar(l.categoriaId, v)} />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </Cartao>

      {data.semLimite.length > 0 && (
        <Cartao titulo="Gastos sem limite neste mês" icone="faisca">
          <div className="sugestoes">
            {data.semLimite.map((s, i) => {
              const cat = categoria(s.categoriaId);
              return (
                <motion.div key={s.categoriaId} className="sugestao" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}>
                  <CategoriaIcone categoria={cat} tamanho={34} />
                  <span className="linha__texto">
                    <span className="linha__titulo">{cat.nome}</span>
                    <span className="linha__sub numero valor-privado">gastou {reais(s.gasto)}</span>
                  </span>
                  {editando === s.categoriaId ? (
                    <EditorLimite inicial={s.sugestao} aoSalvar={(v) => salvar(s.categoriaId, v)} aoCancelar={() => setEditando(null)} />
                  ) : (
                    <>
                      <Botao pequeno variante="secundario" onClick={() => salvar(s.categoriaId, s.sugestao)} title="Média dos últimos 3 meses, arredondada">
                        Limitar em {reais(s.sugestao).replace(/,00$/, '')}
                      </Botao>
                      <BotaoIcone icone="editar" rotulo="Outro valor" onClick={() => setEditando(s.categoriaId)} />
                    </>
                  )}
                </motion.div>
              );
            })}
          </div>
        </Cartao>
      )}

      <Cartao titulo="Adicionar limite" icone="mais">
        <div className="adicionar-limite">
          <Seletor
            className="selecao"
            rotulo="Categoria"
            valor={nova}
            vazio="Escolha a categoria…"
            aoMudar={setNova}
            opcoes={opcoesDeCategoria(semLimiteNenhum)}
          />
          {nova && <EditorLimite inicial={0} aoSalvar={(v) => { salvar(nova, v); setNova(''); }} aoCancelar={() => setNova('')} />}
        </div>
      </Cartao>
    </Pagina>
  );
}
