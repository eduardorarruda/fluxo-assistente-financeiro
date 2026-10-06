import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useCaixinhas, useEscrita, useEstado, useMetas } from '../api/consultas';
import type { Meta } from '../api/tipos';
import { useAvisar } from '../componentes/Avisos';
import { opcoesDePrazo } from '../componentes/opcoes';
import { Seletor } from '../componentes/Seletor';
import { Anel, Botao, BotaoIcone, Carregando, Cartao, Modal, Pagina, Selo, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { Icone } from '../icones/Icone';
import { lerReais, mesCurto, nomeDoMes, pct, reais } from '../util/formato';

const ICONES = ['alvo', 'aviao', 'casa', 'carro', 'presente', 'livro', 'coracao', 'maleta', 'cofre', 'faisca', 'camiseta', 'pata'];
const CORES = ['#8B5CF6', '#F5B83D', '#34D399', '#22D3EE', '#F472B6', '#FB923C', '#60A5FA', '#A3E635'];

interface Rascunho {
  nome: string;
  alvo: string;
  prazo: string;
  caixinhaId: string;
  valorManual: string;
  icone: string;
  cor: string;
}

const vazio: Rascunho = { nome: '', alvo: '', prazo: '', caixinhaId: '', valorManual: '', icone: 'alvo', cor: CORES[0]! };

function Formulario({ meta, aoFechar }: { meta: Meta | 'nova' | null; aoFechar: () => void }) {
  const caixinhas = useCaixinhas().data?.caixinhas ?? [];
  const mesAtual = useEstado().data?.mesAtual ?? '';
  const avisar = useAvisar();
  const [r, setR] = useState<Rascunho>(vazio);
  const [origem, setOrigem] = useState<Meta | 'nova' | null>(null);
  if (meta !== origem) {
    setOrigem(meta);
    setR(
      meta && meta !== 'nova'
        ? {
            nome: meta.nome,
            alvo: (meta.alvo / 100).toFixed(2).replace('.', ','),
            prazo: meta.prazo ?? '',
            caixinhaId: meta.caixinhaId ?? '',
            valorManual: meta.valorManual ? (meta.valorManual / 100).toFixed(2).replace('.', ',') : '',
            icone: meta.icone,
            cor: meta.cor,
          }
        : vazio,
    );
  }
  const salvar = useEscrita((corpo: object) =>
    meta && meta !== 'nova' ? api.put(`/metas/${meta.id}`, corpo) : api.post('/metas', corpo),
  );
  const alvo = lerReais(r.alvo);
  const valido = r.nome.trim().length > 0 && alvo !== null && alvo > 0;

  const enviar = () =>
    salvar.mutate(
      {
        nome: r.nome.trim(),
        alvo,
        prazo: r.prazo || null,
        caixinhaId: r.caixinhaId || null,
        valorManual: r.caixinhaId ? 0 : (lerReais(r.valorManual) ?? 0),
        icone: r.icone,
        cor: r.cor,
      },
      {
        onSuccess: () => {
          avisar('sucesso', meta === 'nova' ? 'Meta criada.' : 'Meta atualizada.');
          aoFechar();
        },
        onError: (e) => avisar('erro', (e as Error).message),
      },
    );

  return (
    <Modal aberto={meta !== null} aoFechar={aoFechar} titulo={meta === 'nova' ? 'Nova meta' : 'Editar meta'}>
      <label className="campo">
        <span>Nome</span>
        <input className="entrada" value={r.nome} maxLength={60} placeholder="Ex.: Viagem ao Japão" onChange={(e) => setR({ ...r, nome: e.target.value })} autoFocus />
      </label>
      <div className="grade grade--2" style={{ gap: 12 }}>
        <label className="campo">
          <span>Quanto quer juntar</span>
          <input className="entrada" inputMode="decimal" value={r.alvo} placeholder="R$ 30.000,00" onChange={(e) => setR({ ...r, alvo: e.target.value })} />
        </label>
        <label className="campo">
          <span>Até quando (opcional)</span>
          <Seletor rotulo="Até quando" valor={r.prazo} aoMudar={(prazo) => setR({ ...r, prazo })} opcoes={opcoesDePrazo(mesAtual, r.prazo)} prefixo={<Icone nome="calendario" tamanho={16} />} />
        </label>
      </div>
      <label className="campo">
        <span>Acompanhar pela caixinha</span>
        <Seletor
          rotulo="Acompanhar pela caixinha"
          valor={r.caixinhaId}
          aoMudar={(caixinhaId) => setR({ ...r, caixinhaId })}
          opcoes={[
            { valor: '', rotulo: 'Nenhuma', descricao: 'informo o valor à mão', icone: <Icone nome="editar" tamanho={16} /> },
            ...caixinhas.map((c) => ({ valor: c.id, rotulo: c.nome, descricao: reais(c.valor), icone: <Icone nome="caixinha" tamanho={16} /> })),
          ]}
        />
      </label>
      <AnimatePresence initial={false}>
        {!r.caixinhaId && (
          <motion.label className="campo" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <span>Quanto já tem guardado</span>
            <input className="entrada" inputMode="decimal" value={r.valorManual} placeholder="R$ 0,00" onChange={(e) => setR({ ...r, valorManual: e.target.value })} />
          </motion.label>
        )}
      </AnimatePresence>
      <div className="campo">
        <span>Ícone</span>
        <div className="escolha-icones">
          {ICONES.map((i) => (
            <button key={i} type="button" className={`escolha-icone ${r.icone === i ? 'escolha-icone--ativo' : ''}`} onClick={() => setR({ ...r, icone: i })} aria-label={i} style={{ color: r.icone === i ? r.cor : undefined }}>
              <Icone nome={i} tamanho={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="campo">
        <span>Cor</span>
        <div className="escolha-cores">
          {CORES.map((c) => (
            <button key={c} type="button" className={`escolha-cor ${r.cor === c ? 'escolha-cor--ativa' : ''}`} style={{ background: c }} onClick={() => setR({ ...r, cor: c })} aria-label={`Cor ${c}`} />
          ))}
        </div>
      </div>
      <div className="editor__rodape" style={{ position: 'static' }}>
        <span style={{ flex: 1 }} />
        <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
        <Botao variante="primario" icone="check" disabled={!valido} carregando={salvar.isPending} onClick={enviar}>Salvar</Botao>
      </div>
    </Modal>
  );
}

function CartaoMeta({ m, mesAtual, aoEditar, aoApagar }: { m: Meta; mesAtual: string; aoEditar: () => void; aoApagar: () => void }) {
  const p = m.progresso;
  const status = p.concluida
    ? { tom: 'bom' as const, texto: 'Concluída!' }
    : p.noRitmo === false
      ? { tom: 'atencao' as const, texto: 'Fora do ritmo' }
      : p.noRitmo
        ? { tom: 'bom' as const, texto: 'No ritmo' }
        : null;
  return (
    <Cartao className="meta" style={{ '--cor': m.cor } as React.CSSProperties}>
      <div className="meta__acoes">
        <BotaoIcone icone="editar" rotulo="Editar" onClick={aoEditar} />
        <BotaoIcone icone="lixo" rotulo="Apagar" onClick={aoApagar} />
      </div>
      <div className="meta__topo">
        <Anel valor={p.percentual} cor={m.cor} tamanho={96} espessura={9}>
          <Icone nome={m.icone} tamanho={26} style={{ color: m.cor }} />
        </Anel>
        <div>
          <h3 className="meta__nome">{m.nome}</h3>
          <Valor centavos={p.atual} className="meta__valor" />
          <span className="texto-3 pequeno">de <span className="numero valor-privado">{reais(m.alvo)}</span> · {pct(p.percentual)}</span>
        </div>
      </div>
      {p.concluida && <motion.div className="meta__confete" initial={{ scale: 0, rotate: -30 }} animate={{ scale: [0, 1.3, 1], rotate: 0 }}><Icone nome="faisca" tamanho={22} /></motion.div>}
      <div className="meta__fatos">
        {m.caixinhaNome && <span><Icone nome="caixinha" tamanho={14} /> Na caixinha {m.caixinhaNome}</span>}
        {m.prazo && <span><Icone nome="calendario" tamanho={14} /> Até {nomeDoMes(m.prazo)}</span>}
        {p.porMes !== null && p.porMes > 0 && <span><Icone nome="alvo" tamanho={14} /> Guardar <strong className="numero valor-privado">{reais(p.porMes)}</strong> por mês</span>}
        {p.ritmoMensal !== null && <span><Icone nome="subir" tamanho={14} /> Tem guardado <strong className="numero valor-privado">{reais(p.ritmoMensal)}</strong>/mês</span>}
        {!p.concluida && p.previsao && <span><Icone nome="faisca" tamanho={14} /> Nesse ritmo, chega em <strong>{mesCurto(p.previsao)}</strong>{p.previsao === mesAtual ? ' (este mês!)' : ''}</span>}
      </div>
      {status && <Selo tom={status.tom}>{status.texto}</Selo>}
    </Cartao>
  );
}

export function Metas() {
  const { data, isLoading } = useMetas();
  const mesAtual = useEstado().data?.mesAtual ?? '';
  const avisar = useAvisar();
  const [editando, setEditando] = useState<Meta | 'nova' | null>(null);
  const [apagando, setApagando] = useState<Meta | null>(null);
  const apagar = useEscrita((id: string) => api.delete(`/metas/${id}`));
  if (isLoading || !data) return <Carregando />;

  return (
    <Pagina>
      <div className="metas">
        {data.map((m) => (
          <CartaoMeta key={m.id} m={m} mesAtual={mesAtual} aoEditar={() => setEditando(m)} aoApagar={() => setApagando(m)} />
        ))}
        <motion.button type="button" className="meta-nova" onClick={() => setEditando('nova')} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
          <span className="meta-nova__icone"><Icone nome="mais" tamanho={24} /></span>
          <strong>Nova meta</strong>
          <span className="texto-3 pequeno">Uma viagem, uma reserva, um carro. Ligue a uma caixinha e acompanhe sozinho.</span>
        </motion.button>
      </div>
      {data.length === 0 && (
        <Cartao>
          <Vazio icone="meta" titulo="Nenhuma meta ainda" texto="Metas ligadas a uma caixinha mostram quanto guardar por mês e quando você chega lá, no ritmo de verdade." />
        </Cartao>
      )}
      <Formulario meta={editando} aoFechar={() => setEditando(null)} />
      <Modal aberto={apagando !== null} aoFechar={() => setApagando(null)} titulo="Apagar meta?">
        <p className="texto-2">A meta <strong>{apagando?.nome}</strong> sai da lista. A caixinha e o dinheiro não mudam em nada.</p>
        <div className="editor__rodape" style={{ position: 'static' }}>
          <span style={{ flex: 1 }} />
          <Botao variante="fantasma" onClick={() => setApagando(null)}>Manter</Botao>
          <Botao
            variante="perigo"
            icone="lixo"
            carregando={apagar.isPending}
            onClick={() =>
              apagar.mutate(apagando!.id, {
                onSuccess: () => {
                  avisar('sucesso', 'Meta apagada.');
                  setApagando(null);
                },
              })
            }
          >
            Apagar
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
