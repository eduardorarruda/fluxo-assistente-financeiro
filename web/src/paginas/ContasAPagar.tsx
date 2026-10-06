import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api/cliente';
import { useContasAPagar, useEscrita, useEstado, useFaturasAPagar } from '../api/consultas';
import type { ContaAPagar, Dia, VencimentoDeCartao } from '../api/tipos';
import { useAvisar } from '../componentes/Avisos';
import { Botao, BotaoIcone, Carregando, Cartao, CategoriaIcone, Modal, Pagina, Selo, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { dataCurta, diaEMes, diasAte, emQuantosDias, mesSemAno, reais } from '../util/formato';
import { agruparContas, NOME_REPETICAO, quandoVence, type Secao } from './contas-a-pagar/agrupar';
import { FormularioConta, type ContaEmEdicao } from './contas-a-pagar/FormularioConta';
import { PagarConta } from './contas-a-pagar/PagarConta';

/** O que a página Recorrências manda ao pedir "Transformar em conta a pagar". */
export interface PedidoDeConta {
  novaConta?: { descricao: string; valor: number; vencimento: Dia; categoriaId: string | null };
}

function Situacao({ c, hoje }: { c: ContaAPagar; hoje: Dia }) {
  if (c.situacao === 'paga') return <Selo tom="bom" icone="check">Paga</Selo>;
  if (c.situacao === 'atrasada') return <Selo tom="ruim" icone="alerta">Atrasada</Selo>;
  if (c.vencimento === hoje) return <Selo tom="atencao" icone="relogio">Vence hoje</Selo>;
  if (diasAte(hoje, c.vencimento) <= 3) return <Selo tom="atencao">Em {diasAte(hoje, c.vencimento)} dia{diasAte(hoje, c.vencimento) > 1 ? 's' : ''}</Selo>;
  return <Selo tom="info">Aberta</Selo>;
}

function Detalhe({ c, hoje }: { c: ContaAPagar; hoje: Dia }) {
  if (c.situacao !== 'paga') return <>{quandoVence(c, hoje)}</>;
  const pago = c.movimento && c.movimento.valor !== c.valor ? ` · ${reais(c.movimento.valor)}` : '';
  return (
    <>
      Paga em {dataCurta(c.pagaEm ?? c.vencimento)}
      {c.movimento ? <> · <Icone nome="link" tamanho={12} /> {c.movimento.descricao}<span className="valor-privado">{pago}</span></> : ' · marcada à mão'}
    </>
  );
}

interface AcoesDaLinha {
  aoPagar: () => void;
  aoReabrir: () => void;
  aoEditar: () => void;
  aoApagar: () => void;
}

function LinhaConta({ c, hoje, i, acoes }: { c: ContaAPagar; hoje: Dia; i: number; acoes: AcoesDaLinha }) {
  const categoria = useCategoriaPorId()(c.categoriaId);
  const paga = c.situacao === 'paga';
  return (
    <motion.li
      className={`conta-pagar conta-pagar--${c.situacao}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 12) * 0.03 }}
    >
      <CategoriaIcone categoria={c.categoriaId ? categoria : undefined} icone={c.categoriaId ? undefined : 'recibo'} cor={c.categoriaId ? undefined : 'var(--marca)'} tamanho={40} />
      <div className="linha__texto">
        <span className="conta-pagar__titulo">
          <span className="linha__titulo">{c.descricao}</span>
          {c.repete !== 'nao' && <Selo tom="marca" icone="repetir">{NOME_REPETICAO[c.repete]}</Selo>}
          {c.origem === 'assistente' && (
            <span className="conta-pagar__origem"><Icone nome="assistente" tamanho={14} titulo="Criada pelo Assistente" /></span>
          )}
        </span>
        <span className="linha__sub"><Detalhe c={c} hoje={hoje} /></span>
      </div>
      <Situacao c={c} hoje={hoje} />
      <strong className="conta-pagar__valor numero valor-privado">{reais(c.valor)}</strong>
      <div className="conta-pagar__acoes">
        {paga ? (
          <BotaoIcone icone="volta" rotulo="Reabrir (não foi paga)" onClick={acoes.aoReabrir} />
        ) : (
          <Botao pequeno variante="secundario" icone="check" onClick={acoes.aoPagar}>Paguei</Botao>
        )}
        <BotaoIcone icone="editar" rotulo="Editar" onClick={acoes.aoEditar} />
        <BotaoIcone icone="lixo" rotulo="Apagar" onClick={acoes.aoApagar} />
      </div>
    </motion.li>
  );
}

function ListaDaSecao({ s, hoje, acoesDe }: { s: Secao; hoje: Dia; acoesDe: (c: ContaAPagar) => AcoesDaLinha }) {
  const total = s.grupos.flatMap((g) => g.contas).reduce((soma, c) => soma + c.valor, 0);
  let i = 0;
  return (
    <section className={`contas-secao contas-secao--${s.chave}`} aria-label={s.titulo}>
      <header className="contas-secao__topo">
        <h3><Icone nome={s.icone} tamanho={15} /> {s.titulo}</h3>
        <span className="texto-3 pequeno numero valor-privado">{reais(total)}</span>
      </header>
      {s.grupos.map((g) => (
        <div key={g.mes ?? s.chave}>
          {g.titulo && <h4 className="contas-secao__mes">{g.titulo}</h4>}
          <ul className="contas-lista">
            {g.contas.map((c) => <LinhaConta key={c.id} c={c} hoje={hoje} i={i++} acoes={acoesDe(c)} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function LinhaFatura({ f, hoje }: { f: VencimentoDeCartao; hoje: Dia }) {
  const vencida = f.situacao === 'FECHADA' && f.vencimento < hoje;
  const fecha = f.fechamento
    ? f.fechamento < hoje ? `Fechou ${diaEMes(f.fechamento)}` : `Fecha ${diaEMes(f.fechamento)}`
    : null;
  return (
    <li className="conta-pagar conta-pagar--fatura">
      <CategoriaIcone icone="cartao" cor="var(--cartao)" tamanho={40} />
      <div className="linha__texto">
        <span className="linha__titulo">{f.cartao} · fatura de {mesSemAno(f.mes)}</span>
        <span className="linha__sub">
          {fecha && <>{fecha} · </>}vence {diaEMes(f.vencimento)} ({emQuantosDias(hoje, f.vencimento)})
        </span>
      </div>
      {vencida ? <Selo tom="ruim" icone="alerta">Vencida</Selo> : f.situacao === 'FECHADA' ? <Selo tom="atencao">A pagar</Selo> : <Selo tom="marca">Em aberto</Selo>}
      <strong className="conta-pagar__valor numero valor-privado">{reais(f.valor)}</strong>
    </li>
  );
}

function Indicadores({ contas, faturas, hoje }: { contas: ContaAPagar[]; faturas: VencimentoDeCartao[]; hoje: Dia }) {
  const abertas = contas.filter((c) => c.situacao !== 'paga');
  const atrasadas = abertas.filter((c) => c.situacao === 'atrasada');
  const semana = abertas.filter((c) => c.situacao === 'aberta' && diasAte(hoje, c.vencimento) <= 6);
  const mes = hoje.slice(0, 7);
  const ateOFim = abertas.filter((c) => c.vencimento.slice(0, 7) <= mes);
  const faturasDoMes = faturas.filter((f) => f.vencimento.slice(0, 7) === mes && f.vencimento >= hoje);
  const soma = (xs: { valor: number }[]) => xs.reduce((s, x) => s + x.valor, 0);
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  return (
    <div className="grade grade--3">
      <Cartao destaque>
        <span className="kpi__rotulo"><Icone nome="calendario" tamanho={15} /> Até o fim do mês</span>
        <Valor centavos={soma(ateOFim) + soma(faturasDoMes)} className="kpi__valor" />
        <span className="texto-3 pequeno">
          {plural(ateOFim.length, 'conta', 'contas')}{faturasDoMes.length > 0 && ` + ${plural(faturasDoMes.length, 'fatura', 'faturas')} do cartão`}
        </span>
      </Cartao>
      <Cartao>
        <span className="kpi__rotulo"><Icone nome="relogio" tamanho={15} /> Próximos 7 dias</span>
        <Valor centavos={soma(semana)} className="kpi__valor" />
        <span className="texto-3 pequeno">{semana.length ? plural(semana.length, 'conta vencendo', 'contas vencendo') : 'nada vencendo'}</span>
      </Cartao>
      <Cartao className={atrasadas.length ? 'kpi--alerta' : ''}>
        <span className="kpi__rotulo"><Icone nome="alerta" tamanho={15} /> Atrasadas</span>
        <Valor centavos={soma(atrasadas)} className="kpi__valor" />
        <span className="texto-3 pequeno">{atrasadas.length ? plural(atrasadas.length, 'conta passou do dia', 'contas passaram do dia') : 'tudo em dia'}</span>
      </Cartao>
    </div>
  );
}

export function ContasAPagar() {
  const contas = useContasAPagar();
  const faturas = useFaturasAPagar();
  const hoje = useEstado().data?.hoje ?? '';
  const avisar = useAvisar();
  const local = useLocation();
  const navegar = useNavigate();
  const pedido = (local.state ?? null) as PedidoDeConta | null;
  const [editando, setEditando] = useState<ContaEmEdicao>(() => (pedido?.novaConta ? { nova: true, ...pedido.novaConta, repete: 'mensal' } : null));
  const [pagando, setPagando] = useState<ContaAPagar | null>(null);
  const [apagando, setApagando] = useState<ContaAPagar | null>(null);
  const reabrir = useEscrita((id: string) => api.post(`/contas-a-pagar/${id}/reabrir`));
  const apagar = useEscrita((id: string) => api.delete(`/contas-a-pagar/${id}`));
  if (contas.isLoading || !contas.data || !hoje) return <Carregando />;

  const secoes = agruparContas(contas.data, hoje);
  const listaFaturas = faturas.data ?? [];
  const acoesDe = (c: ContaAPagar): AcoesDaLinha => ({
    aoPagar: () => setPagando(c),
    aoEditar: () => setEditando(c),
    aoApagar: () => setApagando(c),
    aoReabrir: () =>
      reabrir.mutate(c.id, {
        onSuccess: () => avisar('info', `${c.descricao} voltou a ficar aberta.`),
        onError: (e) => avisar('erro', (e as Error).message),
      }),
  });
  const nova = <Botao variante="primario" pequeno icone="mais" onClick={() => setEditando({ nova: true })}>Nova conta</Botao>;

  return (
    <Pagina className="contas-a-pagar">
      <Indicadores contas={contas.data} faturas={listaFaturas} hoje={hoje} />

      <Cartao titulo="Contas" icone="recibo" acoes={nova}>
        {secoes.length === 0 ? (
          <Vazio
            icone="recibo"
            titulo="Nenhuma conta a pagar"
            texto="Cadastre aqui ou peça ao Assistente, por texto ou voz: “a conta de luz de R$ 150 vence dia 10”. Quando o débito cair no extrato, o Fluxo marca como paga sozinho — e avisa antes de vencer."
            acao={(
              <div className="contas-vazio__acoes">
                <Botao variante="primario" icone="mais" onClick={() => setEditando({ nova: true })}>Cadastrar conta</Botao>
                <Link to="/assistente" className="botao botao--fantasma"><Icone nome="assistente" tamanho={17} /><span>Pedir ao Assistente</span></Link>
              </div>
            )}
          />
        ) : (
          <div className="contas-secoes">
            {secoes.map((s) => <ListaDaSecao key={s.chave} s={s} hoje={hoje} acoesDe={acoesDe} />)}
          </div>
        )}
      </Cartao>

      {listaFaturas.length > 0 && (
        <Cartao titulo="Faturas do cartão" icone="cartao" acoes={<Link to="/cartao" className="link pequeno">Ver no Cartão</Link>}>
          <ul className="contas-lista">
            {listaFaturas.map((f) => <LinhaFatura key={`${f.contaId}:${f.mes}`} f={f} hoje={hoje} />)}
          </ul>
          <p className="texto-3 pequeno contas-faturas__nota">
            <Icone nome="info" tamanho={13} /> As faturas vêm do banco e se pagam pela tela do Cartão; aqui aparecem só para você ver tudo o que vence.
          </p>
        </Cartao>
      )}

      <FormularioConta
        conta={editando}
        hoje={hoje}
        aoFechar={() => {
          setEditando(null);
          // O pedido das Recorrências vale uma vez: recarregar a página não reabre o formulário.
          if (pedido) navegar(local.pathname, { replace: true, state: null });
        }}
      />
      <PagarConta conta={pagando} hoje={hoje} aoFechar={() => setPagando(null)} />
      <Modal aberto={apagando !== null} aoFechar={() => setApagando(null)} titulo="Apagar conta?">
        <p className="texto-2">
          <strong>{apagando?.descricao}</strong> sai da lista.
          {apagando && apagando.repete !== 'nao' && apagando.situacao !== 'paga' && ' Como ela se repete, as próximas também deixam de ser criadas.'}
          {' '}O extrato não muda em nada.
        </p>
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
                  avisar('sucesso', 'Conta apagada.');
                  setApagando(null);
                },
                onError: (e) => avisar('erro', (e as Error).message),
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
