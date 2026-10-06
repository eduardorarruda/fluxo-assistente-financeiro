import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useEstado, useRecorrencias } from '../api/consultas';
import type { Recorrencia } from '../api/tipos';
import { BotaoIcone, Carregando, Cartao, CategoriaIcone, Pagina, Selo, Vazio } from '../componentes/ui';
import { Valor } from '../componentes/Valor';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { diaEMes, diasAte, emQuantosDias, mesCurto, reais } from '../util/formato';
import type { PedidoDeConta } from './ContasAPagar';

function porDia(rs: Recorrencia[]): [string, Recorrencia[]][] {
  const mapa = new Map<string, Recorrencia[]>();
  for (const r of rs) mapa.set(r.proximaData, [...(mapa.get(r.proximaData) ?? []), r]);
  return [...mapa.entries()];
}

function Linha({ r, hoje, i }: { r: Recorrencia; hoje: string; i: number }) {
  const cat = useCategoriaPorId()(r.categoriaId);
  const navegar = useNavigate();
  // Abre o cadastro de conta a pagar já preenchido com a próxima cobrança.
  const virarConta = () => {
    const pedido: PedidoDeConta = { novaConta: { descricao: r.nome, valor: r.ultimoValor, vencimento: r.proximaData, categoriaId: r.categoriaId } };
    navegar('/contas-a-pagar', { state: pedido });
  };
  return (
    <motion.div className="recorrencia" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.035 }}>
      <CategoriaIcone categoria={cat} tamanho={42} />
      <div className="linha__texto">
        <span className="linha__titulo">{r.nome}</span>
        <span className="linha__sub">
          {cat.nome} · visto em {r.meses} meses {r.ativa ? `· próxima ${emQuantosDias(hoje, r.proximaData)} (${diaEMes(r.proximaData)})` : `· última em ${mesCurto(r.ultimaData.slice(0, 7))}`}
        </span>
      </div>
      {r.aumento && (
        <Selo tom="ruim" icone="subir">
          subiu de {reais(r.aumento.de)}
        </Selo>
      )}
      <div className="recorrencia__valores">
        <strong className="numero valor-privado">{reais(r.ativa ? r.ultimoValor : r.valorTipico)}<small className="texto-3">/mês</small></strong>
        <span className="texto-3 pequeno numero valor-privado">{reais(r.custoAnual)} por ano</span>
      </div>
      {r.ativa && <BotaoIcone icone="recibo" rotulo="Transformar em conta a pagar" className="recorrencia__virar" onClick={virarConta} />}
    </motion.div>
  );
}

export function Recorrencias() {
  const { data, isLoading } = useRecorrencias();
  const hoje = useEstado().data?.hoje ?? '';
  const [verInativas, setVerInativas] = useState(false);
  if (isLoading || !data) return <Carregando />;
  const ativas = data.itens.filter((r) => r.ativa);
  const inativas = data.itens.filter((r) => !r.ativa);
  const proximos30 = ativas.filter((r) => diasAte(hoje, r.proximaData) >= 0 && diasAte(hoje, r.proximaData) <= 30).sort((a, b) => a.proximaData.localeCompare(b.proximaData));

  return (
    <Pagina>
      <div className="grade grade--3">
        <Cartao destaque>
          <span className="kpi__rotulo"><Icone nome="repetir" tamanho={15} /> Custo fixo por mês</span>
          <Valor centavos={data.mensal} className="kpi__valor" />
          <span className="texto-3 pequeno">{ativas.length} cobranças que se repetem</span>
        </Cartao>
        <Cartao>
          <span className="kpi__rotulo"><Icone nome="calendario" tamanho={15} /> Em um ano</span>
          <Valor centavos={data.anual} className="kpi__valor" />
          <span className="texto-3 pequeno">se nada mudar</span>
        </Cartao>
        <Cartao>
          <span className="kpi__rotulo"><Icone nome="subir" tamanho={15} /> Ficaram mais caras</span>
          <span className="kpi__valor">{ativas.filter((r) => r.aumento).length}</span>
          <span className="texto-3 pequeno">{ativas.filter((r) => r.aumento).map((r) => r.nome).join(', ') || 'nenhuma'}</span>
        </Cartao>
      </div>

      {proximos30.length > 0 && (
        <Cartao titulo="Próximos 30 dias" icone="calendario" acoes={<span className="texto-3 pequeno numero valor-privado">{reais(proximos30.reduce((s, r) => s + r.ultimoValor, 0))} previstos</span>}>
          <div className="agenda">
            {porDia(proximos30).map(([dia, itens], i) => (
              <motion.div key={dia} className="agenda__dia" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05 }}>
                <div className="agenda__data">
                  <strong>{diaEMes(dia)}</strong>
                  <span className="texto-3">{emQuantosDias(hoje, dia)}</span>
                </div>
                <div className="agenda__marco" />
                {itens.map((r) => (
                  <div key={r.chave} className="agenda__item">
                    <span className="linha__titulo">{r.nome}</span>
                    <span className="numero valor-privado texto-2">{reais(r.ultimoValor)}</span>
                  </div>
                ))}
              </motion.div>
            ))}
          </div>
        </Cartao>
      )}

      <Cartao titulo="Assinaturas e contas que se repetem" icone="repetir">
        {ativas.length === 0 ? (
          <Vazio icone="repetir" titulo="Nada se repetindo ainda" texto="Depois de três meses de histórico, o Fluxo reconhece sozinho o que cobra todo mês." />
        ) : (
          <div className="recorrencias">
            {ativas.map((r, i) => <Linha key={r.chave} r={r} hoje={hoje} i={i} />)}
          </div>
        )}
      </Cartao>

      {inativas.length > 0 && (
        <Cartao
          titulo={`Pararam de cobrar (${inativas.length})`}
          icone="check"
          acoes={<button type="button" className="link" onClick={() => setVerInativas((v) => !v)}>{verInativas ? 'Esconder' : 'Mostrar'}</button>}
        >
          {verInativas ? (
            <div className="recorrencias recorrencias--inativas">
              {inativas.map((r, i) => <Linha key={r.chave} r={r} hoje={hoje} i={i} />)}
            </div>
          ) : (
            <p className="texto-3 pequeno">Assinaturas canceladas ou que não cobram há mais de 45 dias.</p>
          )}
        </Cartao>
      )}
    </Pagina>
  );
}
