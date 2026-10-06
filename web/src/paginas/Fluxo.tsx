import { motion } from 'motion/react';
import { useFluxo } from '../api/consultas';
import type { FluxoCaixa } from '../api/tipos';
import { Carregando, Cartao, Pagina, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { Sankey } from '../graficos/Sankey';
import { Icone } from '../icones/Icone';
import { capitalizar, nomeDoMes, reais } from '../util/formato';
import { useMes } from '../util/useMes';

function Caixa({ c }: { c: FluxoCaixa }) {
  const entradas = [
    { nome: 'Receitas', valor: c.entradas.receitas, cor: 'var(--entrada)' },
    { nome: 'Resgates de caixinha', valor: c.entradas.resgates, cor: 'var(--guardado)' },
    { nome: 'Vindo de outras contas suas', valor: c.entradas.transferencias, cor: '#94A3B8' },
  ];
  const saidas = [
    { nome: 'Gastos no débito, Pix e boleto', valor: c.saidas.despesas, cor: 'var(--saida)' },
    { nome: 'Fatura do cartão', valor: c.saidas.faturas, cor: 'var(--cartao)' },
    { nome: 'Guardado em caixinhas', valor: c.saidas.guardado, cor: 'var(--guardado)' },
    { nome: 'Para outras contas suas', valor: c.saidas.transferencias, cor: '#94A3B8' },
  ];
  const totalE = entradas.reduce((s, e) => s + e.valor, 0);
  const totalS = saidas.reduce((s, e) => s + e.valor, 0);
  const maior = Math.max(totalE, totalS, 1);

  const Coluna = ({ titulo, itens, total, icone }: { titulo: string; itens: typeof entradas; total: number; icone: string }) => (
    <div className="caixa__coluna">
      <div className="caixa__cabeca">
        <span className="kpi__rotulo"><Icone nome={icone} tamanho={15} /> {titulo}</span>
        <strong className="numero valor-privado">{reais(total)}</strong>
      </div>
      <div className="caixa__pilha" style={{ width: `${(total / maior) * 100}%` }}>
        {itens.filter((i) => i.valor > 0).map((i, n) => (
          <motion.div
            key={i.nome}
            className="caixa__fatia"
            style={{ background: i.cor }}
            initial={{ flexGrow: 0 }}
            animate={{ flexGrow: i.valor }}
            transition={{ type: 'spring', stiffness: 70, damping: 18, delay: 0.2 + n * 0.08 }}
            title={`${i.nome}: ${reais(i.valor)}`}
          />
        ))}
      </div>
      <ul className="caixa__legenda">
        {itens.filter((i) => i.valor > 0).map((i) => (
          <li key={i.nome}>
            <i style={{ background: i.cor }} />
            <span>{i.nome}</span>
            <strong className="numero valor-privado">{reais(i.valor)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Cartao titulo="Na conta, pelo caixa" icone="banco">
      <p className="texto-3 pequeno explicacao">
        Aqui o cartão aparece do jeito que ele sai da conta: numa tacada só, no dia em que a fatura é paga. Guardar
        na caixinha e mandar dinheiro para outra conta sua estão separados — o dinheiro continua seu.
      </p>
      <div className="caixa">
        <Coluna titulo="Entrou na conta" itens={entradas} total={totalE} icone="entrada" />
        <Coluna titulo="Saiu da conta" itens={saidas} total={totalS} icone="saida" />
      </div>
      <div className="caixa__variacao">
        <span>Variação do saldo no mês</span>
        <Valor centavos={c.variacao} sinal="cor" className="caixa__variacao-valor" />
      </div>
    </Cartao>
  );
}

export function Fluxo() {
  const { mes } = useMes();
  const { data, isLoading } = useFluxo(mes);
  if (isLoading || !data) return <Carregando linhas={2} />;
  const r = data.resumo;
  // Campo novo do servidor; o tipo compartilhado (api/tipos.ts) ainda não o declara.
  const resgateForaDoMes = data.sankey.resgateForaDoMes;
  return (
    <Pagina>
      <Cartao
        titulo={<>De onde veio e para onde foi · <span className="texto-3">{capitalizar(nomeDoMes(mes))}</span></>}
        icone="fluxo"
        acoes={
          <div className="fluxo__totais">
            <span><i style={{ background: 'var(--entrada)' }} />Entrou <strong className="numero valor-privado">{reais(r.receitas)}</strong></span>
            <span><i style={{ background: 'var(--saida)' }} />Gastou <strong className="numero valor-privado">{reais(r.despesas)}</strong></span>
            <span><i style={{ background: 'var(--guardado)' }} />Guardou <strong className="numero valor-privado">{reais(r.guardado)}</strong></span>
          </div>
        }
      >
        {data.sankey.nos.length === 0 ? (
          <Vazio icone="fluxo" titulo="Nada se moveu neste mês" texto="Quando houver entradas e gastos, o caminho do dinheiro aparece aqui." />
        ) : (
          <Sankey nos={data.sankey.nos} ligacoes={data.sankey.ligacoes} total={data.sankey.total} altura={Math.max(420, data.sankey.nos.length * 44)} />
        )}
        <p className="texto-3 pequeno explicacao">
          Pelo mês da compra: o que você passou no cartão conta no mês em que comprou, e cada parcela no mês dela.
          Pagar a fatura não aparece como gasto, porque as compras já estão contadas. Resgate de caixinha só entra
          até cobrir o que faltou para os gastos do mês.
        </p>
        {resgateForaDoMes > 0 && (
          <p className="texto-3 pequeno explicacao">
            Outros <strong className="numero valor-privado">{reais(resgateForaDoMes)}</strong> resgatados das caixinhas não
            entraram no gasto deste mês: esse dinheiro pagou compras de meses anteriores (como a fatura) ou ficou na conta.
          </p>
        )}
      </Cartao>
      <Caixa c={data.caixa} />
    </Pagina>
  );
}
