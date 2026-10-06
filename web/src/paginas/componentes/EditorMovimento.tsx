import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '../../api/cliente';
import { useCategorias, useEscrita } from '../../api/consultas';
import type { Movimento, Natureza } from '../../api/tipos';
import { useAvisar } from '../../componentes/Avisos';
import { Botao, CategoriaIcone, Gaveta, Interruptor, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { NATUREZAS, useCategoriaPorId } from '../../util/categorias';
import { dataCurta, diaDaSemana, mesCurto, reais } from '../../util/formato';

const OPCOES_NATUREZA: { valor: Natureza; nome: string; icone: string; ajuda: string }[] = [
  { valor: 'DESPESA', nome: 'Gasto', icone: 'saida', ajuda: 'Conta como gasto na categoria.' },
  { valor: 'RECEITA', nome: 'Receita', icone: 'entrada', ajuda: 'Dinheiro que entrou de fora.' },
  { valor: 'ESTORNO', nome: 'Estorno', icone: 'volta', ajuda: 'Devolução: abate do gasto da categoria.' },
  { valor: 'TRANSFERENCIA', nome: 'Entre contas', icone: 'setas', ajuda: 'Dinheiro seu mudando de lugar. Não conta.' },
  { valor: 'INVESTIMENTO', nome: 'Caixinha', icone: 'caixinha', ajuda: 'Guardado ou resgatado. Não é gasto.' },
  { valor: 'PAGAMENTO_FATURA', nome: 'Fatura', icone: 'cartao', ajuda: 'Pagamento do cartão. As compras já contaram.' },
];

/** Tudo que dá para mudar num movimento, numa gaveta só. */
export function EditorMovimento({ m, aoFechar }: { m: Movimento | null; aoFechar: () => void }) {
  const categorias = useCategorias().data ?? [];
  const categoria = useCategoriaPorId();
  const avisar = useAvisar();
  const [natureza, setNatureza] = useState<Natureza>('DESPESA');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [ignorar, setIgnorar] = useState(false);
  const [criarRegra, setCriarRegra] = useState(false);
  const [textoRegra, setTextoRegra] = useState('');

  useEffect(() => {
    if (!m) return;
    setNatureza(m.natureza);
    setCategoriaId(m.categoriaId);
    setNota(m.nota ?? '');
    setIgnorar(m.ignorado);
    setCriarRegra(false);
    setTextoRegra('');
    api.get<{ texto: string }>(`/movimentos/${encodeURIComponent(m.id)}/sugestao-de-regra`).then((r) => setTextoRegra(r.texto)).catch(() => undefined);
  }, [m]);

  const salvar = useEscrita((corpo: object) => api.patch<Movimento>(`/movimentos/${encodeURIComponent(m!.id)}`, corpo));

  if (!m) return <Gaveta aberta={false} aoFechar={aoFechar} titulo="">{null}</Gaveta>;

  const grupo = natureza === 'RECEITA' ? 'RECEITA' : natureza === 'DESPESA' || natureza === 'ESTORNO' ? 'DESPESA' : null;
  const opcoes = categorias.filter((c) => c.grupo === grupo);
  const catAtual = categoriaId && opcoes.some((c) => c.id === categoriaId) ? categoriaId : null;
  const natInfo = NATUREZAS[m.natureza];

  const enviar = () => {
    // Só vai o que mudou: abrir e salvar sem mexer não marca o movimento como editado.
    const notaNova = nota.trim() || null;
    const corpo: Record<string, unknown> = {};
    if (natureza !== m.natureza) corpo.natureza = natureza;
    if (grupo && catAtual && catAtual !== m.categoriaId) corpo.categoriaId = catAtual;
    if (notaNova !== (m.nota ?? null)) corpo.nota = notaNova;
    if (ignorar !== m.ignorado) corpo.ignorar = ignorar;
    const comRegra = criarRegra && catAtual && textoRegra.trim().length >= 2;
    if (comRegra) {
      corpo.categoriaId = catAtual;
      corpo.regra = { texto: textoRegra.trim() };
    }
    if (Object.keys(corpo).length === 0) return aoFechar();
    salvar.mutate(corpo, {
      onSuccess: () => {
        avisar('sucesso', comRegra ? `Salvo. Tudo com "${textoRegra.trim()}" agora vai para ${categoria(catAtual).nome}.` : 'Movimento atualizado.');
        aoFechar();
      },
      onError: (e) => avisar('erro', (e as Error).message),
    });
  };

  return (
    <Gaveta aberta={Boolean(m)} aoFechar={aoFechar} titulo="Detalhes do movimento" largura={480}>
      <div className="editor__cabeca">
        <CategoriaIcone categoria={m.categoriaId ? categoria(m.categoriaId) : undefined} icone={natInfo?.icone} cor={natInfo?.cor} tamanho={52} />
        <div>
          <h3 className="editor__titulo">{m.estabelecimento || m.descricao}</h3>
          {m.estabelecimento && m.estabelecimento !== m.descricao && <p className="texto-3 pequeno">{m.descricao}</p>}
        </div>
        <strong className={`editor__valor numero valor-privado ${m.sentido === 'ENTRADA' ? 'valor--positivo' : ''}`}>
          {m.sentido === 'ENTRADA' ? '+' : '−'} {reais(m.valor)}
        </strong>
      </div>

      <dl className="editor__fatos">
        <div><dt>Data</dt><dd>{dataCurta(m.data)} · {diaDaSemana(m.data)}</dd></div>
        <div><dt>Conta</dt><dd>{m.conta || (m.tipoConta === 'CARTAO' ? 'Cartão' : 'Conta')}</dd></div>
        <div><dt>Conta no mês</dt><dd style={{ textTransform: 'capitalize' }}>{mesCurto(m.competencia)}</dd></div>
        {m.parcela && <div><dt>Parcela</dt><dd>{m.parcela.numero} de {m.parcela.total}{m.parcela.valorTotal ? ` · total ${reais(m.parcela.valorTotal)}` : ''}</dd></div>}
        {m.meioPagamento && <div><dt>Meio</dt><dd>{m.meioPagamento}</dd></div>}
        {m.contraparteNome && <div><dt>{m.sentido === 'SAIDA' ? 'Para' : 'De'}</dt><dd>{m.contraparteNome}</dd></div>}
        {m.categoriaProvedor && <div><dt>Categoria do banco</dt><dd>{m.categoriaProvedor}</dd></div>}
        {m.pendente && <div><dt>Situação</dt><dd><Selo icone="relogio">ainda pendente</Selo></dd></div>}
      </dl>

      <section className="editor__secao">
        <h4>O que é este movimento</h4>
        <div className="segmentos">
          {OPCOES_NATUREZA.map((o) => (
            <button key={o.valor} type="button" className={`segmento ${natureza === o.valor ? 'segmento--ativo' : ''}`} onClick={() => setNatureza(o.valor)} title={o.ajuda}>
              {natureza === o.valor && <motion.span layoutId="segmento-natureza" className="segmento__fundo" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <Icone nome={o.icone} tamanho={15} />
              <span>{o.nome}</span>
            </button>
          ))}
        </div>
        <p className="texto-3 pequeno">{OPCOES_NATUREZA.find((o) => o.valor === natureza)?.ajuda}</p>
      </section>

      <AnimatePresence initial={false}>
        {grupo && (
          <motion.section className="editor__secao" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <h4>Categoria</h4>
            <div className="grade-categorias">
              {opcoes.map((c) => (
                <button key={c.id} type="button" className={`opcao-categoria ${catAtual === c.id ? 'opcao-categoria--ativa' : ''}`} onClick={() => setCategoriaId(c.id)} style={{ '--cor': c.cor } as React.CSSProperties}>
                  <CategoriaIcone categoria={c} tamanho={30} />
                  <span>{c.nome}</span>
                </button>
              ))}
            </div>
            {catAtual && (
              <label className="regra-toggle">
                <Interruptor ligado={criarRegra} aoMudar={setCriarRegra} rotulo="Aplicar a movimentos parecidos" />
                <span>
                  Sempre que aparecer
                  <input className="entrada entrada--inline" value={textoRegra} onChange={(e) => setTextoRegra(e.target.value)} onFocus={() => setCriarRegra(true)} maxLength={80} />
                  usar esta categoria — no passado e no futuro.
                </span>
              </label>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <section className="editor__secao">
        <h4>Nota</h4>
        <textarea className="entrada" value={nota} maxLength={500} placeholder="Ex.: presente de aniversário da Ana" onChange={(e) => setNota(e.target.value)} />
      </section>

      <label className="regra-toggle">
        <Interruptor ligado={ignorar} aoMudar={setIgnorar} rotulo="Ignorar nas contas" />
        <span>Ignorar nas contas (some dos gastos, do orçamento e do fluxo, mas continua no extrato)</span>
      </label>

      <div className="editor__rodape">
        {m.editado && (
          <Botao
            variante="fantasma"
            icone="volta"
            onClick={() =>
              salvar.mutate(
                { natureza: null, categoriaId: null, nota: null, ignorar: false },
                { onSuccess: () => { avisar('sucesso', 'De volta à classificação automática.'); aoFechar(); } },
              )
            }
          >
            Voltar ao automático
          </Botao>
        )}
        <span style={{ flex: 1 }} />
        <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
        <Botao variante="primario" icone="check" carregando={salvar.isPending} onClick={enviar}>Salvar</Botao>
      </div>
    </Gaveta>
  );
}
