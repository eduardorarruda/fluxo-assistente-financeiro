import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useCaixinhas, useMetas } from '../api/consultas';
import { Botao, Carregando, Cartao, Pagina, Selo, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { GraficoArea } from '../graficos/GraficoArea';
import { Faisca } from '../graficos/Linhas';
import { Pote } from '../graficos/Pote';
import { Icone } from '../icones/Icone';
import { dataCurta, mesCurto, mesCurtoSemAno, pct, reais } from '../util/formato';

function rotuloRendimento(indexador: string | null, percentual: number | null): string | null {
  if (!indexador) return null;
  return percentual !== null ? `${Math.round(percentual * 100)}% do ${indexador}` : indexador;
}

export function Caixinhas() {
  const { data, isLoading } = useCaixinhas();
  const metas = useMetas().data ?? [];
  const navegar = useNavigate();
  if (isLoading || !data) return <Carregando />;

  const meses = data.caixinhas[0]?.serie.map((p) => p.mes) ?? [];
  const serieTotal = meses.map((mes, i) => ({
    rotulo: mesCurtoSemAno(mes),
    valor: data.caixinhas.reduce((s, c) => s + (c.serie[i]?.valor ?? 0), 0),
  }));
  const temHistorico = serieTotal.filter((p) => p.valor > 0).length >= 2;
  const maior = Math.max(1, ...data.caixinhas.map((c) => c.valor));

  return (
    <Pagina>
      <div className="grade grade--12-8">
        <Cartao destaque className="caixinhas-hero">
          <span className="kpi__rotulo"><Icone nome="caixinha" tamanho={15} /> Guardado nas caixinhas</span>
          <Valor centavos={data.total} className="patrimonio__valor" duracao={1.5} />
          <div className="caixinhas-hero__numeros">
            <span>
              <small className="texto-3">Rendimento estimado neste mês</small>
              <strong className="numero valor-privado valor--positivo">+ {reais(data.rendimentoEstimadoMes)}</strong>
            </span>
            <span>
              <small className="texto-3">Em investimentos</small>
              <strong className="numero valor-privado">{reais(data.investimentos)}</strong>
            </span>
          </div>
          {temHistorico && <GraficoArea pontos={serieTotal} cor="var(--guardado)" altura={170} dica={(p) => <strong className="numero">{p.rotulo}: {reais(p.valor)}</strong>} />}
        </Cartao>
        <Cartao titulo="Como ler" icone="info">
          <ul className="como-ler">
            <li><Icone nome="caixinha" tamanho={16} /> <span>O Open Finance não manda o nome de cada caixinha: cada depósito chega como um CDB da Nu Financeira. O Fluxo junta esses CDBs aqui, separados pela taxa.</span></li>
            <li><Icone nome="broto" tamanho={16} /> <span>O rendimento do mês é uma estimativa pelo CDI; o valor exato aparece na próxima sincronização.</span></li>
            <li><Icone nome="meta" tamanho={16} /> <span>Ligue uma meta a uma caixinha e o progresso anda sozinho, com a previsão de quando você chega lá.</span></li>
          </ul>
          <Botao variante="secundario" icone="meta" onClick={() => navegar('/metas')}>Ver metas</Botao>
        </Cartao>
      </div>

      {data.caixinhas.length === 0 ? (
        <Cartao>
          <Vazio icone="caixinha" titulo="Nenhuma caixinha encontrada" texto="Se você tem caixinhas no Nubank e elas não aparecem, sincronize a conexão — o banco pode ainda não ter enviado os saldos." />
        </Cartao>
      ) : (
        <div className="grade grade--3">
          {data.caixinhas.map((c, i) => {
            const metasDela = metas.filter((m) => m.caixinhaId === c.id);
            const alvo = metasDela[0]?.alvo;
            const nivel = alvo ? c.valor / alvo : c.valor / maior;
            const rend = rotuloRendimento(c.indexador, c.percentualIndexador);
            return (
              <Cartao key={c.id} className="caixinha" transition={{ delay: i * 0.06 }}>
                <div className="caixinha__topo">
                  <Pote nivel={nivel} tamanho={84} />
                  <div className="caixinha__info">
                    <h3>{c.nome}</h3>
                    <Valor centavos={c.valor} className="caixinha__valor" />
                    {rend && <Selo tom="ouro" icone="broto">{rend}</Selo>}
                  </div>
                </div>
                <div className="caixinha__faisca">
                  <Faisca valores={c.serie.map((p) => p.valor)} cor="var(--guardado)" largura={260} altura={44} />
                  <span className="texto-3 pequeno">{c.serie.filter((p) => p.valor !== null).length > 1 ? `desde ${mesCurto(c.serie.find((p) => p.valor !== null)!.mes)}` : 'histórico começa hoje'}</span>
                </div>
                {metasDela.map((m) => (
                  <motion.button type="button" key={m.id} className="caixinha__meta" onClick={() => navegar('/metas')} whileHover={{ x: 3 }}>
                    <Icone nome={m.icone} tamanho={15} style={{ color: m.cor }} />
                    <span>{m.nome}</span>
                    <strong>{pct(m.progresso.percentual)}</strong>
                  </motion.button>
                ))}
              </Cartao>
            );
          })}
        </div>
      )}

      {data.listaInvestimentos.length > 0 && (
        <Cartao titulo="Investimentos" icone="broto">
          <div className="tabela">
            <div className="tabela__cabeca">
              <span>Nome</span><span>Tipo</span><span>Aplicado</span><span>Rendimento</span><span>Vencimento</span><span>Saldo</span>
            </div>
            {data.listaInvestimentos.map((inv) => (
              <div key={inv.id} className={`tabela__linha ${inv.duplicado ? 'tabela__linha--apagada' : ''}`}>
                <span className="linha__titulo">
                  {inv.nome} {inv.duplicado && <Selo tom="info" icone="info">já contada como caixinha</Selo>}
                </span>
                <span className="texto-3">{inv.subtipo ?? inv.tipo}{inv.indexador ? ` · ${inv.taxa ?? ''}% ${inv.indexador}` : ''}</span>
                <span className="numero valor-privado">{inv.valorAplicado !== null ? reais(inv.valorAplicado) : '—'}</span>
                <span className={`numero valor-privado ${inv.rendimento && inv.rendimento > 0 ? 'valor--positivo' : ''}`}>{inv.rendimento !== null ? reais(inv.rendimento) : '—'}</span>
                <span className="texto-3">{inv.vencimento ? dataCurta(inv.vencimento) : '—'}</span>
                <strong className="numero valor-privado">{reais(inv.saldo)}</strong>
              </div>
            ))}
          </div>
        </Cartao>
      )}
    </Pagina>
  );
}
