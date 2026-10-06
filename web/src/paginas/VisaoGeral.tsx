import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useContasAPagar, useEstado, useVisaoGeral } from '../api/consultas';
import type { Movimento, VisaoGeral as Dados } from '../api/tipos';
import { Anel, Barra, Carregando, Cartao, CategoriaIcone, Delta, Pagina, Selo, surgir, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { BarrasMensais } from '../graficos/BarrasMensais';
import { GraficoArea } from '../graficos/GraficoArea';
import { Rosca } from '../graficos/Rosca';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { diaAmigavel, diaEMes, diasAte, emQuantosDias, mesCurto, mesCurtoSemAno, pct, reais } from '../util/formato';
import { useMes } from '../util/useMes';
import { LinhaMovimento } from './componentes/LinhaMovimento';

function Patrimonio({ d }: { d: Dados }) {
  const p = d.patrimonio;
  const inicio = d.evolucao.find((e) => e.total > 0)?.total ?? 0;
  const fim = d.evolucao.at(-1)?.total ?? 0;
  // O saldo do cartão é a dívida inteira (limite usado): a fatura aberta mais as parcelas já contratadas.
  const faturaAberta = d.cartoes.reduce((s, c) => s + (c.faturaAberta?.total ?? 0), 0);
  const parcelasFuturas = d.cartoes.reduce((s, c) => s + c.compromissoFuturo, 0);
  const partes = [
    { nome: 'Em conta', valor: p.contas, cor: 'var(--info)', icone: 'banco' },
    { nome: 'Caixinhas', valor: p.caixinhas, cor: 'var(--guardado)', icone: 'caixinha' },
    { nome: 'Investimentos', valor: p.investimentos, cor: 'var(--entrada)', icone: 'broto' },
    {
      nome: 'Dívida no cartão', valor: -p.faturaAberta, cor: 'var(--saida)', icone: 'cartao',
      detalhe: d.cartoes.length ? `fatura aberta ${reais(faturaAberta)} · parcelas futuras ${reais(parcelasFuturas)}` : null,
    },
  ];
  return (
    <Cartao destaque className="patrimonio">
      <div className="patrimonio__cabeca">
        <div>
          <span className="kpi__rotulo">
            <Icone nome="camadas" tamanho={15} /> Patrimônio líquido
          </span>
          <Valor centavos={p.total} className="patrimonio__valor" duracao={1.6} />
          <div className="kpi__rodape">
            {inicio > 0 && <Delta atual={fim} anterior={inicio} />}
            <span>em 12 meses, sem contar o cartão</span>
          </div>
        </div>
        <div className="patrimonio__partes">
          {partes.map((parte, i) => (
            <motion.div key={parte.nome} className="patrimonio__parte" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.07 }}>
              <span className="patrimonio__parte-icone" style={{ color: parte.cor }}><Icone nome={parte.icone} tamanho={15} /></span>
              <span className="texto-3">
                {parte.nome}
                {parte.detalhe && (
                  <small className="valor-privado" style={{ display: 'block', fontSize: 11 }}>{parte.detalhe}</small>
                )}
              </span>
              <strong className="numero valor-privado">{reais(parte.valor)}</strong>
            </motion.div>
          ))}
        </div>
      </div>
      <GraficoArea
        altura={190}
        pontos={d.evolucao.map((e) => ({ rotulo: mesCurtoSemAno(e.mes), valor: e.total }))}
        dica={(ponto, i) => {
          const e = d.evolucao[i]!;
          return (
            <div className="dica__tabela">
              <strong className="dica__titulo">{mesCurto(e.mes)}</strong>
              <span><i style={{ background: 'var(--info)' }} />Conta</span><b className="numero">{reais(e.contas)}</b>
              <span><i style={{ background: 'var(--guardado)' }} />Caixinhas</span><b className="numero">{reais(e.caixinhas)}</b>
              {e.investimentos > 0 && (<><span><i style={{ background: 'var(--entrada)' }} />Investido</span><b className="numero">{reais(e.investimentos)}</b></>)}
              <span className="dica__linha">Total</span><b className="numero dica__linha">{reais(ponto.valor)}</b>
            </div>
          );
        }}
      />
    </Cartao>
  );
}

/** Fatura fechada que já venceu faz tempo não é "a pagar": ou foi paga, ou o saldo rolou para a seguinte. */
const AVISO_ATE_DIAS_APOS_VENCIMENTO = 30;

function CartaoDeCredito({ d }: { d: Dados }) {
  const navegar = useNavigate();
  const hoje = useEstado().data?.hoje;
  const c = d.cartoes[0];
  if (!c) {
    return (
      <Cartao titulo="Cartão de crédito" icone="cartao">
        <Vazio icone="cartao" titulo="Nenhum cartão" texto="Quando o banco mandar um cartão, ele aparece aqui." />
      </Cartao>
    );
  }
  const aberta = c.faturaAberta;
  const uso = c.limite ? (c.usado ?? 0) / c.limite : 0;
  const fechada = c.faturaFechada;
  const aPagar = fechada ? fechada.total - fechada.pago : 0;
  const avisarFechada = fechada && aPagar > 0 && hoje && diasAte(fechada.vencimento, hoje) <= AVISO_ATE_DIAS_APOS_VENCIMENTO;
  return (
    <Cartao titulo="Cartão de crédito" icone="cartao" className="cartao--interativo" onClick={() => navegar('/cartao')}>
      <div className="mini-cartao">
        <div className="mini-cartao__brilho" />
        <span className="mini-cartao__nome">{c.nome}</span>
        <span className="mini-cartao__rotulo">Fatura de {aberta ? mesCurtoSemAno(aberta.mes) : '—'} · aberta</span>
        <Valor centavos={aberta?.total ?? 0} className="mini-cartao__valor" />
        <span className="mini-cartao__vence">
          {aberta ? `Vence ${diaEMes(aberta.vencimento)}` : 'Sem fatura aberta'}
        </span>
      </div>
      {avisarFechada && (
        <div className="aviso-inline aviso-inline--atencao">
          <Icone nome="relogio" tamanho={15} />
          Fatura de {mesCurtoSemAno(fechada.mes)} fechada: {reais(aPagar)} a pagar
        </div>
      )}
      {c.limite !== null && (
        <div className="limite">
          <div className="limite__linha">
            <span className="texto-3">Limite usado</span>
            <span className="numero valor-privado">
              <strong>{reais(c.usado ?? 0)}</strong> <span className="texto-3">de {reais(c.limite)}</span>
            </span>
          </div>
          <Barra valor={uso} cor={uso > 0.8 ? 'var(--saida)' : 'linear-gradient(90deg, var(--marca), var(--marca-clara))'} />
          <div className="limite__linha pequeno">
            <span className="texto-3">Disponível <strong className="numero valor-privado texto-2">{reais(c.disponivel ?? 0)}</strong></span>
            <span className="texto-3">Parcelas futuras <strong className="numero valor-privado texto-2">{reais(c.compromissoFuturo)}</strong></span>
          </div>
        </div>
      )}
    </Cartao>
  );
}

function Kpi({ rotulo, icone, cor, valor, anterior, inverter, rodape }: { rotulo: string; icone: string; cor: string; valor: number; anterior: number; inverter?: boolean; rodape?: string }) {
  return (
    <Cartao className="kpi">
      <span className="kpi__rotulo">
        <span className="kpi__icone" style={{ color: cor, background: `color-mix(in srgb, ${cor} 14%, transparent)` }}>
          <Icone nome={icone} tamanho={15} traco={2} />
        </span>
        {rotulo}
      </span>
      <Valor centavos={valor} className="kpi__valor" />
      <div className="kpi__rodape">
        <Delta atual={valor} anterior={anterior} inverter={inverter} />
        <span>{rodape ?? 'vs. mês anterior'}</span>
      </div>
      <div className="kpi__aura" style={{ background: cor }} />
    </Cartao>
  );
}

function Categorias({ d }: { d: Dados }) {
  const categoria = useCategoriaPorId();
  const navegar = useNavigate();
  const total = d.resumo.despesas;
  const fatias = d.categorias.filter((c) => c.valor > 0).map((c) => {
    const cat = categoria(c.categoriaId);
    return { id: c.categoriaId, nome: cat.nome, valor: c.valor, cor: cat.cor };
  });
  const resto = total - fatias.reduce((s, f) => s + f.valor, 0);
  if (resto > 0) fatias.push({ id: 'resto', nome: 'Demais', valor: resto, cor: '#475569' });

  return (
    <Cartao titulo="Para onde foi" icone="orcamento" acoes={<button type="button" className="link" onClick={() => navegar('/fluxo')}>Ver fluxo <Icone nome="seta-dir" tamanho={14} /></button>}>
      {fatias.length === 0 ? (
        <Vazio icone="orcamento" titulo="Nenhum gasto neste mês" />
      ) : (
        <div className="composicao">
          <Rosca fatias={fatias} tamanho={200} rotuloCentro="Gastos do mês" />
          <ul className="composicao__lista">
            {fatias.map((f, i) => {
              const cat = categoria(f.id);
              return (
                <motion.li key={f.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.05 }}>
                  <CategoriaIcone categoria={f.id === 'resto' ? undefined : cat} icone={f.id === 'resto' ? 'pontos' : undefined} cor={f.cor} tamanho={28} />
                  <span className="composicao__nome">{f.nome}</span>
                  <span className="composicao__pct">{pct(f.valor / total)}</span>
                  <strong className="numero valor-privado">{reais(f.valor)}</strong>
                </motion.li>
              );
            })}
          </ul>
        </div>
      )}
    </Cartao>
  );
}

/** Dias à frente em que uma conta a pagar aparece nas próximas cobranças (as atrasadas sempre aparecem). */
const DIAS_CONTAS_NA_VISAO = 12;

function Proximas({ d, hoje }: { d: Dados; hoje: string }) {
  const categoria = useCategoriaPorId();
  const navegar = useNavigate();
  const resposta = useContasAPagar().data;
  const contas = (Array.isArray(resposta) ? resposta : [])
    .filter((c) => c.situacao === 'atrasada' || (c.situacao === 'aberta' && diasAte(hoje, c.vencimento) <= DIAS_CONTAS_NA_VISAO))
    .slice(0, 4);
  const verContas = <button type="button" className="link pequeno" onClick={() => navegar('/contas-a-pagar')}>Contas a pagar</button>;
  return (
    <Cartao titulo="Próximas cobranças" icone="calendario" acoes={verContas}>
      {contas.length > 0 && (
        <ul className="lista-simples">
          {contas.map((c) => (
            <li key={c.id} className="linha">
              <CategoriaIcone categoria={c.categoriaId ? categoria(c.categoriaId) : undefined} icone={c.categoriaId ? undefined : 'recibo'} cor={c.categoriaId ? undefined : 'var(--marca)'} tamanho={34} />
              <span className="linha__texto">
                <span className="linha__titulo">{c.descricao}</span>
                <span className="linha__sub">
                  {c.situacao === 'atrasada' ? `venceu ${emQuantosDias(hoje, c.vencimento)}` : `vence ${emQuantosDias(hoje, c.vencimento)}`} · {diaEMes(c.vencimento)}
                </span>
              </span>
              {c.situacao === 'atrasada' && <Selo tom="ruim">Atrasada</Selo>}
              <span className="linha__valor numero valor-privado">{reais(c.valor)}</span>
            </li>
          ))}
        </ul>
      )}
      {d.proximas.length === 0 ? (
        contas.length === 0 && <p className="texto-3 pequeno">Nenhuma cobrança recorrente nem conta a pagar nos próximos dias.</p>
      ) : (
        <ul className="lista-simples">
          {d.proximas.map((r) => (
            <li key={r.chave} className="linha">
              <CategoriaIcone categoria={categoria(r.categoriaId)} tamanho={34} />
              <span className="linha__texto">
                <span className="linha__titulo">{r.nome}</span>
                <span className="linha__sub">{emQuantosDias(hoje, r.proximaData)} · {diaEMes(r.proximaData)}</span>
              </span>
              <span className="linha__valor numero valor-privado">{reais(r.valorTipico)}</span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function CaixinhasResumo({ d }: { d: Dados }) {
  const navegar = useNavigate();
  const maior = Math.max(1, ...d.caixinhas.map((c) => c.valor));
  return (
    <Cartao titulo="Caixinhas" icone="caixinha" className="cartao--interativo" onClick={() => navegar('/caixinhas')}>
      {d.caixinhas.length === 0 ? (
        <p className="texto-3 pequeno">Nenhuma caixinha encontrada.</p>
      ) : (
        <ul className="lista-simples">
          {d.caixinhas.map((c) => (
            <li key={c.id} className="caixinha-mini">
              <div className="caixinha-mini__topo">
                <span>{c.nome}</span>
                <strong className="numero valor-privado">{reais(c.valor)}</strong>
              </div>
              <Barra valor={c.valor / maior} cor="linear-gradient(90deg, var(--guardado), #FDE68A)" altura={6} />
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function OrcamentoResumo({ d }: { d: Dados }) {
  const categoria = useCategoriaPorId();
  const navegar = useNavigate();
  return (
    <Cartao titulo="Orçamento do mês" icone="orcamento" className="cartao--interativo" onClick={() => navegar('/orcamento')}>
      {d.orcamento.length === 0 ? (
        <div className="texto-3 pequeno orcamento-convite">
          <Icone nome="alvo" tamanho={18} />
          Defina limites por categoria para saber a tempo quando um gasto sai do controle.
        </div>
      ) : (
        <ul className="lista-simples">
          {d.orcamento.map((l) => {
            const cat = categoria(l.categoriaId);
            const cor = l.situacao === 'ESTOUROU' ? 'var(--saida)' : l.situacao === 'ATENCAO' ? 'var(--atencao)' : cat.cor;
            return (
              <li key={l.categoriaId} className="orcamento-mini">
                <Anel valor={l.percentual} cor={cor} tamanho={40} espessura={5}>
                  <Icone nome={cat.icone} tamanho={14} style={{ color: cat.cor }} />
                </Anel>
                <span className="linha__texto">
                  <span className="linha__titulo">{cat.nome}</span>
                  <span className="linha__sub numero valor-privado">{reais(l.gasto)} de {reais(l.limite)}</span>
                </span>
                <Selo tom={l.situacao === 'ESTOUROU' ? 'ruim' : l.situacao === 'ATENCAO' ? 'atencao' : 'bom'}>{pct(l.percentual)}</Selo>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

function Ultimos({ movimentos, hoje }: { movimentos: Movimento[]; hoje: string }) {
  const navegar = useNavigate();
  return (
    <Cartao titulo="Últimas movimentações" icone="extrato" acoes={<button type="button" className="link" onClick={() => navegar('/extrato')}>Ver extrato <Icone nome="seta-dir" tamanho={14} /></button>}>
      <div className="ultimos">
        {movimentos.map((m, i) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.04 }}>
            <LinhaMovimento m={m} sub={diaAmigavel(m.data, hoje)} />
          </motion.div>
        ))}
      </div>
    </Cartao>
  );
}

export function VisaoGeral() {
  const { mes, mesAtual, definirMes } = useMes();
  const { data: d, isLoading, error } = useVisaoGeral(mes);
  if (isLoading || !d) return error ? <Vazio icone="alerta" titulo="Não consegui carregar" texto={(error as Error).message} /> : <Carregando />;
  const r = d.resumo;
  const hoje = d.ultimos[0]?.data ?? `${mesAtual}-01`;
  const criticos = d.alertas.filter((a) => a.gravidade === 'CRITICO');

  return (
    <Pagina>
      {criticos.map((a) => (
        <motion.div key={a.id} variants={surgir} className="faixa-alerta">
          <Icone nome="alerta" tamanho={18} />
          <span><strong>{a.titulo}.</strong> {a.detalhe}</span>
        </motion.div>
      ))}
      <div className="grade grade--12-8">
        <Patrimonio d={d} />
        <CartaoDeCredito d={d} />
      </div>
      <div className="grade grade--4">
        <Kpi rotulo="Entrou" icone="entrada" cor="var(--entrada)" valor={r.receitas} anterior={d.anterior.receitas} />
        <Kpi rotulo="Saiu" icone="saida" cor="var(--saida)" valor={r.despesas} anterior={d.anterior.despesas} inverter />
        <Kpi rotulo="Guardado" icone="caixinha" cor="var(--guardado)" valor={r.guardado} anterior={d.anterior.guardado} />
        <Kpi
          rotulo="Sobrou"
          icone="check"
          cor={r.resultado >= 0 ? 'var(--marca-clara)' : 'var(--saida)'}
          valor={r.resultado}
          anterior={d.anterior.resultado}
          rodape={r.receitas > 0 ? `${pct(Math.max(0, r.resultado) / r.receitas)} do que entrou` : undefined}
        />
      </div>
      <div className="grade grade--12-8">
        <Cartao titulo="Entradas e saídas · 12 meses" icone="subir" acoes={<span className="legenda"><i style={{ background: 'var(--entrada)' }} />Entrou <i style={{ background: 'var(--saida)' }} />Saiu</span>}>
          <BarrasMensais meses={d.serieMensal} mesAtivo={mes} aoEscolher={(m) => m <= mesAtual && definirMes(m)} />
        </Cartao>
        <Categorias d={d} />
      </div>
      <div className="grade grade--3">
        <Proximas d={d} hoje={hoje} />
        <CaixinhasResumo d={d} />
        <OrcamentoResumo d={d} />
      </div>
      <Ultimos movimentos={d.ultimos} hoje={hoje} />
    </Pagina>
  );
}
