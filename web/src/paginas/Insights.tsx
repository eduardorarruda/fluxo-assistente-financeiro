import { motion } from 'motion/react';
import { useEstado, useInsights } from '../api/consultas';
import type { Insights as Dados } from '../api/tipos';
import { Carregando, Cartao, CategoriaIcone, Pagina, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { GraficoRitmo } from '../graficos/Linhas';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { diaEMes, inteiro, pct, reais, SEMANA_CURTA } from '../util/formato';
import { useMes } from '../util/useMes';

/** Frases em português claro a partir dos números — o que mais mudou e o que isso quer dizer. */
function frases(d: Dados, nome: (id: string) => string): { icone: string; tom: 'bom' | 'ruim' | 'neutro'; texto: string }[] {
  const saida: { icone: string; tom: 'bom' | 'ruim' | 'neutro'; texto: string }[] = [];
  for (const v of d.variacoes.slice(0, 4)) {
    if (v.media3 === 0 && v.atual > 0) {
      saida.push({ icone: 'faisca', tom: 'neutro', texto: `${nome(v.categoriaId)} apareceu este mês: ${reais(v.atual)}, sem gasto nos três meses anteriores.` });
      continue;
    }
    const variacao = v.media3 ? v.delta / v.media3 : 0;
    if (Math.abs(variacao) < 0.15 || Math.abs(v.delta) < 5000) continue;
    saida.push(
      variacao > 0
        ? { icone: 'subir', tom: 'ruim', texto: `${nome(v.categoriaId)} está ${pct(variacao)} acima do seu normal (${reais(v.atual)} contra média de ${reais(v.media3)}).` }
        : { icone: 'descer', tom: 'bom', texto: `${nome(v.categoriaId)} caiu ${pct(-variacao)} em relação ao normal — ${reais(-v.delta)} a menos.` },
    );
  }
  const fim = d.ritmo.filter((p) => p.atual !== null).at(-1);
  if (fim && fim.anterior > 0 && fim.atual !== null) {
    const diff = (fim.atual - fim.anterior) / fim.anterior;
    if (Math.abs(diff) >= 0.08) {
      saida.unshift({
        icone: diff > 0 ? 'alerta' : 'check',
        tom: diff > 0 ? 'ruim' : 'bom',
        texto: `Até o dia ${fim.dia}, você gastou ${pct(Math.abs(diff))} ${diff > 0 ? 'a mais' : 'a menos'} que no mesmo ponto do mês passado.`,
      });
    }
  }
  const semana = d.porDiaDaSemana;
  const maiorDia = semana.indexOf(Math.max(...semana));
  if (semana[maiorDia]! > 0) {
    const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    saida.push({ icone: 'calendario', tom: 'neutro', texto: `O dia da semana em que o dinheiro mais sai é ${nomes[maiorDia]}.` });
  }
  return saida.slice(0, 5);
}

export function Insights() {
  const { mes } = useMes();
  const { data, isLoading } = useInsights(mes);
  const hoje = useEstado().data?.hoje ?? '';
  const categoria = useCategoriaPorId();
  if (isLoading || !data) return <Carregando />;
  if (data.quantidade === 0) {
    return (
      <Pagina>
        <Cartao><Vazio icone="lampada" titulo="Sem gastos neste mês" texto="Escolha outro mês lá em cima." /></Cartao>
      </Pagina>
    );
  }
  const maiorVariacao = Math.max(1, ...data.variacoes.map((v) => Math.abs(v.delta)));
  const maiorLoja = Math.max(1, ...data.estabelecimentos.map((e) => e.total));
  const maiorDia = Math.max(1, ...data.porDiaDaSemana);
  const lista = frases(data, (id) => categoria(id).nome);

  return (
    <Pagina>
      <div className="grade grade--3">
        <Cartao>
          <span className="kpi__rotulo"><Icone nome="recibo" tamanho={15} /> Compras no mês</span>
          <span className="kpi__valor numero">{inteiro(data.quantidade)}</span>
          <span className="texto-3 pequeno">lançamentos de gasto</span>
        </Cartao>
        <Cartao>
          <span className="kpi__rotulo"><Icone nome="sacola" tamanho={15} /> Valor médio por compra</span>
          <Valor centavos={data.ticketMedio} className="kpi__valor" />
          <span className="texto-3 pequeno">ticket médio</span>
        </Cartao>
        <Cartao>
          <span className="kpi__rotulo"><Icone nome="relogio" tamanho={15} /> Por dia</span>
          <Valor centavos={data.mediaDiaria} className="kpi__valor" />
          <span className="texto-3 pequeno">média diária no mês</span>
        </Cartao>
      </div>

      {lista.length > 0 && (
        <Cartao titulo="O que chama atenção" icone="lampada" destaque>
          <ul className="frases">
            {lista.map((f, i) => (
              <motion.li key={i} className={`frase frase--${f.tom}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
                <span className="frase__icone"><Icone nome={f.icone} tamanho={16} /></span>
                {f.texto}
              </motion.li>
            ))}
          </ul>
        </Cartao>
      )}

      <div className="grade grade--12-8">
        <Cartao titulo="Ritmo do mês" icone="subir" acoes={<span className="legenda"><i style={{ background: 'var(--saida)' }} />Este mês <i style={{ background: 'var(--texto-3)' }} />Mês anterior</span>}>
          <GraficoRitmo pontos={data.ritmo} />
        </Cartao>
        <Cartao titulo="Dia da semana" icone="calendario">
          <div className="semana">
            {data.porDiaDaSemana.map((v, i) => (
              <div key={i} className="semana__coluna" title={reais(v)}>
                <div className="semana__trilho">
                  <motion.div
                    className={`semana__barra ${v === maiorDia ? 'semana__barra--maior' : ''}`}
                    initial={{ height: 0 }}
                    animate={{ height: `${(v / maiorDia) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 100, damping: 16, delay: i * 0.05 }}
                  />
                </div>
                <span className="texto-3 pequeno">{SEMANA_CURTA[i]}</span>
              </div>
            ))}
          </div>
        </Cartao>
      </div>

      <div className="grade grade--2">
        <Cartao titulo="Comparado ao seu normal" icone="camadas" acoes={<span className="texto-3 pequeno">vs. média dos 3 meses anteriores</span>}>
          <div className="divergentes">
            {data.variacoes.slice(0, 10).map((v, i) => {
              const cat = categoria(v.categoriaId);
              const largura = (Math.abs(v.delta) / maiorVariacao) * 50;
              return (
                <div key={v.categoriaId} className="divergente">
                  <span className="divergente__nome"><Icone nome={cat.icone} tamanho={14} style={{ color: cat.cor }} /> {cat.nome}</span>
                  <div className="divergente__trilho">
                    <span className="divergente__eixo" />
                    <motion.span
                      className={`divergente__barra ${v.delta > 0 ? 'divergente__barra--mais' : 'divergente__barra--menos'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${largura}%` }}
                      transition={{ type: 'spring', stiffness: 90, damping: 18, delay: i * 0.04 }}
                    />
                  </div>
                  <span className={`numero valor-privado divergente__valor ${v.delta > 0 ? 'valor--negativo' : 'valor--positivo'}`}>
                    {v.delta > 0 ? '+' : '−'} {reais(Math.abs(v.delta))}
                  </span>
                </div>
              );
            })}
          </div>
        </Cartao>
        <Cartao titulo="Onde o dinheiro mais vai" icone="sacola">
          <div className="lojas">
            {data.estabelecimentos.map((e, i) => {
              const cat = categoria(e.categoriaId);
              return (
                <div key={e.nome} className="loja">
                  <CategoriaIcone categoria={cat} tamanho={34} />
                  <div className="loja__meio">
                    <div className="loja__topo">
                      <span className="linha__titulo">{e.nome}</span>
                      <strong className="numero valor-privado">{reais(e.total)}</strong>
                    </div>
                    <div className="loja__trilho">
                      <motion.span style={{ background: cat.cor }} initial={{ width: 0 }} animate={{ width: `${(e.total / maiorLoja) * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 18, delay: i * 0.05 }} />
                    </div>
                    <span className="texto-3 pequeno">{e.vezes} {e.vezes === 1 ? 'vez' : 'vezes'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Cartao>
      </div>

      <Cartao titulo="Maiores gastos do mês" icone="alerta">
        <div className="maiores">
          {data.maioresGastos.map((g, i) => {
            const cat = categoria(g.categoriaId);
            return (
              <motion.div key={g.id} className="maior" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <span className="maior__posicao">{i + 1}</span>
                <CategoriaIcone categoria={cat} tamanho={36} />
                <span className="linha__texto">
                  <span className="linha__titulo">{g.descricao}</span>
                  <span className="linha__sub">{diaEMes(g.data)} · {cat.nome}{g.tipoConta === 'CARTAO' ? ' · cartão' : ''}{g.data > hoje ? ' · parcela' : ''}</span>
                </span>
                <strong className="numero valor-privado">{reais(g.valor)}</strong>
              </motion.div>
            );
          })}
        </div>
      </Cartao>
    </Pagina>
  );
}
