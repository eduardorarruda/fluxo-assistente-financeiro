import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useCartoes, useEstado, useItensDaFatura } from '../api/consultas';
import type { FaturaMes, Movimento, VisaoCartao } from '../api/tipos';
import { Anel, Cartao as Painel, Carregando, CategoriaIcone, Pagina, Selo, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { capitalizar, diaAmigavel, diaEMes, mesCurto, mesCurtoSemAno, mesSemAno, pct, reais } from '../util/formato';
import { EditorMovimento } from './componentes/EditorMovimento';
import { LinhaMovimento } from './componentes/LinhaMovimento';

type Rotulo = { nome: string; tom: 'bom' | 'atencao' | 'marca' | 'neutro' };

const SITUACAO: Record<FaturaMes['situacao'], Rotulo> = {
  PAGA: { nome: 'Paga', tom: 'bom' },
  FECHADA: { nome: 'Fechada', tom: 'atencao' },
  ABERTA: { nome: 'Aberta', tom: 'marca' },
  FUTURA: { nome: 'Futura', tom: 'neutro' },
};

/** Fatura quitada sem pagamento integral: a dívida não sumiu, mudou de lugar. */
const QUITACAO: Partial<Record<NonNullable<FaturaMes['quitacao']>, Rotulo & { detalhe: string }>> = {
  PARCELAMENTO: { nome: 'Parcelada', tom: 'neutro', detalhe: 'o que faltou virou parcelamento da fatura' },
  PROXIMA_FATURA: { nome: 'Na seguinte', tom: 'neutro', detalhe: 'o saldo em aberto foi cobrado na fatura seguinte' },
};

const rotuloDa = (f: FaturaMes): Rotulo => (f.quitacao && QUITACAO[f.quitacao]) || SITUACAO[f.situacao];

/** O cartão de plástico, que inclina acompanhando o mouse e tem um reflexo que corre pela superfície. */
function Plastico({ c }: { c: VisaoCartao }) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [10, -10]), { stiffness: 200, damping: 20 });
  const ry = useSpring(useTransform(x, [0, 1], [-14, 14]), { stiffness: 200, damping: 20 });
  const brilhoX = useTransform(x, [0, 1], ['0%', '100%']);
  const brilhoY = useTransform(y, [0, 1], ['0%', '100%']);
  const reflexo = useMotionTemplate`radial-gradient(420px circle at ${brilhoX} ${brilhoY}, rgba(255,255,255,.28), transparent 45%)`;
  const aberta = c.faturas.find((f) => f.mes === c.faturaAtual);
  return (
    <div className="plastico-palco">
      <motion.div
        className="plastico"
        style={{ rotateX: rx, rotateY: ry }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          x.set((e.clientX - r.left) / r.width);
          y.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          x.set(0.5);
          y.set(0.5);
        }}
        initial={{ opacity: 0, y: 30, rotateX: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16 }}
      >
        <motion.div className="plastico__reflexo" style={{ background: reflexo }} />
        <div className="plastico__topo">
          <span className="plastico__nome">{c.nome}</span>
          <svg width="38" height="28" viewBox="0 0 38 28" aria-hidden="true">
            <circle cx="13" cy="14" r="12" fill="#EB001B" opacity=".9" />
            <circle cx="25" cy="14" r="12" fill="#F79E1B" opacity=".85" />
          </svg>
        </div>
        <div className="plastico__chip" />
        <div className="plastico__rodape">
          <span>
            <small>Fatura de {aberta ? mesSemAno(aberta.mes) : '—'}</small>
            <strong className="numero valor-privado">{reais(aberta?.total ?? 0)}</strong>
          </span>
          <span className="plastico__vence">
            <small>Vence</small>
            {aberta ? diaEMes(aberta.vencimento) : '—'}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function Limite({ c }: { c: VisaoCartao }) {
  if (c.limite === null) return null;
  const uso = (c.usado ?? 0) / c.limite;
  return (
    <div className="limite-cartao">
      <Anel valor={uso} cor={uso > 0.8 ? 'var(--saida)' : 'var(--marca)'} tamanho={112} espessura={10}>
        <span>
          <strong className="limite-cartao__pct">{pct(uso)}</strong>
          <small className="texto-3">usado</small>
        </span>
      </Anel>
      <dl className="limite-cartao__numeros">
        <div><dt>Limite total</dt><dd className="numero valor-privado">{reais(c.limite)}</dd></div>
        <div><dt>Disponível</dt><dd className="numero valor-privado valor--positivo">{reais(c.disponivel ?? 0)}</dd></div>
        <div><dt>Parcelas que ainda vão cair</dt><dd className="numero valor-privado">{reais(c.compromissoFuturo)}</dd></div>
      </dl>
    </div>
  );
}

function LinhaDoTempo({ faturas, escolhida, aoEscolher }: { faturas: FaturaMes[]; escolhida: string; aoEscolher: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const maior = Math.max(1, ...faturas.map((f) => f.total));
  useEffect(() => {
    ref.current?.querySelector('[data-escolhida="sim"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [escolhida]);
  return (
    <div className="linha-do-tempo" ref={ref}>
      {faturas.map((f, i) => {
        const ativa = f.mes === escolhida;
        return (
          <button key={f.mes} type="button" data-escolhida={ativa ? 'sim' : 'nao'} className={`fatura-pilula fatura-pilula--${f.situacao.toLowerCase()} ${ativa ? 'fatura-pilula--ativa' : ''}`} onClick={() => aoEscolher(f.mes)}>
            {ativa && <motion.span layoutId="fatura-escolhida" className="fatura-pilula__fundo" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="fatura-pilula__barra">
              <motion.span initial={{ height: 0 }} animate={{ height: `${Math.max(4, (f.total / maior) * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 18, delay: i * 0.025 }} />
            </span>
            <span className="fatura-pilula__mes">{mesCurto(f.mes)}</span>
            <span className="fatura-pilula__valor numero valor-privado">{reais(f.total)}</span>
            <span className="fatura-pilula__situacao">{rotuloDa(f).nome}</span>
          </button>
        );
      })}
    </div>
  );
}

function DetalheDaFatura({ c, f, hoje }: { c: VisaoCartao; f: FaturaMes; hoje: string }) {
  const categoria = useCategoriaPorId();
  const { data: itens } = useItensDaFatura(c.contaId, f.mes);
  const [aberto, setAberto] = useState<Movimento | null>(null);
  const total = f.porCategoria.reduce((s, x) => s + x.valor, 0);
  const s = rotuloDa(f);
  const quitada = f.quitacao ? QUITACAO[f.quitacao] : undefined;
  const quando = quitada
    ? `${capitalizar(quitada.detalhe)} · venceu ${diaEMes(f.vencimento)}`
    : f.situacao === 'PAGA' ? `Paga · venceu ${diaEMes(f.vencimento)}` : `Vence ${diaEMes(f.vencimento)}`;
  return (
    <Painel titulo={<>Fatura de {capitalizar(mesSemAno(f.mes))} <Selo tom={s.tom}>{s.nome}</Selo></>} icone="recibo">
      <div className="fatura__cabeca">
        <div>
          <span className="kpi__rotulo">Total</span>
          <Valor centavos={f.total} className="fatura__total" />
          <span className="texto-3 pequeno">
            {quando} · {f.quantidade} lançamento{f.quantidade === 1 ? '' : 's'}
          </span>
        </div>
        {f.somaItens !== f.total && (
          <div className="aviso-inline aviso-inline--info" title="O banco fecha a fatura com juros, IOF e ajustes que nem sempre chegam como lançamento">
            <Icone nome="info" tamanho={15} /> Os lançamentos somam {reais(f.somaItens)}; o banco fechou em {reais(f.total)}.
          </div>
        )}
      </div>
      {total > 0 && (
        <>
          <div className="fatura__pilha">
            {f.porCategoria.map((x, i) => (
              <motion.span
                key={x.categoriaId}
                style={{ background: categoria(x.categoriaId).cor }}
                initial={{ flexGrow: 0 }}
                animate={{ flexGrow: x.valor }}
                transition={{ type: 'spring', stiffness: 80, damping: 18, delay: i * 0.04 }}
                title={`${categoria(x.categoriaId).nome}: ${reais(x.valor)}`}
              />
            ))}
          </div>
          <div className="fatura__categorias">
            {f.porCategoria.slice(0, 8).map((x) => (
              <span key={x.categoriaId}>
                <i style={{ background: categoria(x.categoriaId).cor }} />
                {categoria(x.categoriaId).nome}
                <strong className="numero valor-privado">{reais(x.valor)}</strong>
              </span>
            ))}
          </div>
        </>
      )}
      <div className="fatura__itens">
        {(itens ?? []).map((m) => (
          <LinhaMovimento key={m.id} m={m} sub={diaAmigavel(m.data, hoje)} aoClicar={() => setAberto(m)} />
        ))}
      </div>
      <EditorMovimento m={aberto} aoFechar={() => setAberto(null)} />
    </Painel>
  );
}

function Parcelamentos({ c }: { c: VisaoCartao }) {
  const categoria = useCategoriaPorId();
  if (c.parcelamentos.length === 0) return null;
  const totalRestante = c.parcelamentos.reduce((s, p) => s + p.restante, 0);
  return (
    <Painel titulo="Compras parceladas" icone="camadas" acoes={<span className="texto-3 pequeno">Ainda faltam <strong className="numero valor-privado texto-2">{reais(totalRestante)}</strong></span>}>
      <div className="parcelas">
        {c.parcelamentos.map((p, i) => (
          <motion.div key={p.chave} className="parcela" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <CategoriaIcone categoria={categoria(p.categoriaId)} tamanho={38} />
            <div className="parcela__meio">
              <div className="parcela__topo">
                <span className="linha__titulo">{p.descricao}</span>
                <span className="numero valor-privado">{reais(p.valorParcela)}<small className="texto-3">/mês</small></span>
              </div>
              <div className="parcela__pontos" aria-label={`Parcela ${p.parcelaAtual} de ${p.totalParcelas}`}>
                {Array.from({ length: p.totalParcelas }, (_, k) => (
                  <motion.span
                    key={k}
                    className={k < p.parcelaAtual ? 'parcela__ponto parcela__ponto--paga' : 'parcela__ponto'}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2 + i * 0.05 + k * 0.02 }}
                  />
                ))}
              </div>
              <div className="parcela__rodape texto-3 pequeno">
                <span>{p.parcelaAtual} de {p.totalParcelas} · termina em {mesCurto(p.ultimaFatura)}</span>
                <span>faltam <strong className="numero valor-privado texto-2">{reais(p.restante)}</strong> de {reais(p.valorTotal)}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Painel>
  );
}

function Futuro({ c }: { c: VisaoCartao }) {
  const futuras = c.faturas.filter((f) => f.situacao === 'FUTURA' || f.situacao === 'ABERTA').slice(0, 12);
  if (futuras.length < 2) return null;
  const maior = Math.max(1, ...futuras.map((f) => f.total));
  return (
    <Painel titulo="O que já está comprometido" icone="calendario">
      <p className="texto-3 pequeno" style={{ marginBottom: 14 }}>Parcelas que você já assumiu, fatura a fatura. Compras novas vão somar em cima disso.</p>
      <div className="futuro">
        {futuras.map((f, i) => (
          <div key={f.mes} className="futuro__coluna" title={`${mesCurto(f.mes)}: ${reais(f.total)}`}>
            <span className="futuro__valor numero valor-privado">{reais(f.total).replace(/,\d\d$/, '')}</span>
            <div className="futuro__trilho">
              <motion.div className="futuro__barra" initial={{ height: 0 }} animate={{ height: `${(f.total / maior) * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 16, delay: i * 0.05 }} />
            </div>
            <span className="futuro__mes">{mesCurtoSemAno(f.mes)}</span>
          </div>
        ))}
      </div>
    </Painel>
  );
}

export function Cartao() {
  const { data, isLoading } = useCartoes();
  const hoje = useEstado().data?.hoje ?? '';
  const [indice, setIndice] = useState(0);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  if (isLoading || !data) return <Carregando />;
  if (data.length === 0) {
    return (
      <Pagina>
        <Painel>
          <Vazio icone="cartao" titulo="Nenhum cartão de crédito" texto="Quando uma conexão trouxer um cartão, as faturas, parcelas e o limite aparecem aqui." />
        </Painel>
      </Pagina>
    );
  }
  const c = data[Math.min(indice, data.length - 1)]!;
  const mes = escolhida ?? c.faturaAtual;
  // Cartão recém-conectado pode não ter fatura nenhuma ainda.
  const fatura = c.faturas.find((f) => f.mes === mes) ?? c.faturas.at(-1) ?? null;

  return (
    <Pagina>
      {data.length > 1 && (
        <div className="chips">
          {data.map((k, i) => (
            <button key={k.contaId} type="button" className={`chip ${i === indice ? 'chip--ativo' : ''}`} onClick={() => { setIndice(i); setEscolhida(null); }}>
              <Icone nome="cartao" tamanho={14} /> {k.nome}
            </button>
          ))}
        </div>
      )}
      <div className="grade grade--8-12">
        <Painel className="cartao-painel">
          <Plastico c={c} />
          <Limite c={c} />
        </Painel>
        <div className="coluna">
          <Painel titulo="Faturas" icone="calendario" acoes={<span className="texto-3 pequeno">Clique numa fatura para ver os lançamentos</span>}>
            {fatura ? (
              <LinhaDoTempo faturas={c.faturas} escolhida={fatura.mes} aoEscolher={setEscolhida} />
            ) : (
              <Vazio icone="calendario" titulo="Nenhuma fatura ainda" texto="As faturas aparecem aqui quando houver a primeira compra no cartão ou a primeira fatura do banco." />
            )}
          </Painel>
          <Futuro c={c} />
        </div>
      </div>
      <div className="grade grade--12-8">
        {fatura && <DetalheDaFatura c={c} f={fatura} hoje={hoje} />}
        <Parcelamentos c={c} />
      </div>
    </Pagina>
  );
}
