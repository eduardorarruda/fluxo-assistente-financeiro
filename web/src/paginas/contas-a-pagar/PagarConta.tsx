import { useState } from 'react';
import { api } from '../../api/cliente';
import { useCandidatosAPagamento, useEscrita } from '../../api/consultas';
import type { CandidatoAPagamento, ContaAPagar, Dia } from '../../api/tipos';
import { useAvisar } from '../../componentes/Avisos';
import { CampoData } from '../../componentes/CampoData';
import { Botao, Esqueleto, Modal, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { diaEMes, reais } from '../../util/formato';

const POR_FORA = 'por-fora';

function Opcao({ escolhida, aoEscolher, children }: { escolhida: boolean; aoEscolher: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={escolhida} className={`pagar__opcao ${escolhida ? 'pagar__opcao--escolhida' : ''}`} onClick={aoEscolher}>
      <span className="pagar__marca" aria-hidden>{escolhida && <Icone nome="check" tamanho={13} traco={2.4} />}</span>
      {children}
    </button>
  );
}

function Candidato({ m, conta }: { m: CandidatoAPagamento; conta: ContaAPagar }) {
  const diferenca = m.valor - conta.valor;
  return (
    <>
      <span className="pagar__textos">
        <span className="linha__titulo">{m.estabelecimento && m.estabelecimento !== m.descricao ? m.estabelecimento : m.descricao}</span>
        <span className="linha__sub">
          {diaEMes(m.data)} · {m.conta}
          {m.tipoConta === 'CARTAO' && ' · no cartão'}
        </span>
      </span>
      {m.forte && <Selo tom="bom" icone="faisca">Provável</Selo>}
      <span className="pagar__valor">
        <strong className="numero valor-privado">{reais(m.valor)}</strong>
        {diferenca !== 0 && <small className="texto-3 numero valor-privado">{diferenca > 0 ? '+' : '−'} {reais(Math.abs(diferenca))}</small>}
      </span>
    </>
  );
}

/**
 * Marcar como paga: escolher o débito do extrato que pagou a conta (os mais
 * prováveis primeiro) ou dizer que pagou por fora, com a data.
 */
export function PagarConta({ conta, hoje, aoFechar }: { conta: ContaAPagar | null; hoje: Dia; aoFechar: () => void }) {
  const avisar = useAvisar();
  const [escolha, setEscolha] = useState<string | null>(null);
  const [data, setData] = useState<Dia>(hoje);
  // A última conta aberta continua na tela enquanto o diálogo sai, sem piscar vazio.
  const [mostrada, setMostrada] = useState<ContaAPagar | null>(null);
  const [aberto, setAberto] = useState(false);
  // Cada abertura (ou outra conta) começa do zero.
  const abrindo = conta !== null && (!aberto || conta.id !== mostrada?.id);
  if ((conta !== null) !== aberto) setAberto(conta !== null);
  if (conta && conta !== mostrada) setMostrada(conta);
  if (abrindo) {
    setEscolha(null);
    setData(hoje);
  }
  const candidatos = useCandidatosAPagamento(mostrada?.id ?? null);
  const lista = candidatos.data ?? [];
  // Sem escolha ainda: o provável, se houver; senão "por fora".
  const atual = escolha ?? (candidatos.isLoading ? null : (lista.find((m) => m.forte)?.id ?? (lista.length ? null : POR_FORA)));
  const pagar = useEscrita((corpo: object) => api.post<ContaAPagar>(`/contas-a-pagar/${mostrada!.id}/paga`, corpo));

  const confirmar = () =>
    pagar.mutate(atual === POR_FORA ? { data } : { movimentoId: atual }, {
      onSuccess: () => {
        avisar('sucesso', `${mostrada!.descricao} marcada como paga.`);
        aoFechar();
      },
      onError: (e) => avisar('erro', (e as Error).message),
    });

  return (
    <Modal aberto={conta !== null} aoFechar={aoFechar} titulo="Marcar como paga">
      {mostrada && (
        <div className="pagar">
          <p className="texto-2 pagar__intro">
            Qual débito pagou <strong>{mostrada.descricao}</strong> (<span className="numero valor-privado">{reais(mostrada.valor)}</span>)?
            Ligar ao extrato deixa o histórico certinho.
          </p>
          <div className="pagar__lista" role="radiogroup" aria-label="Movimento que pagou a conta">
            {candidatos.isLoading && [0, 1, 2].map((i) => <Esqueleto key={i} altura={52} raio={12} />)}
            {!candidatos.isLoading && lista.length === 0 && (
              <p className="texto-3 pequeno pagar__nada">
                <Icone nome="busca" tamanho={14} /> Nenhum gasto parecido no extrato perto do vencimento.
              </p>
            )}
            {lista.map((m) => (
              <Opcao key={m.id} escolhida={atual === m.id} aoEscolher={() => setEscolha(m.id)}>
                <Candidato m={m} conta={mostrada} />
              </Opcao>
            ))}
            <Opcao escolhida={atual === POR_FORA} aoEscolher={() => setEscolha(POR_FORA)}>
              <span className="pagar__textos">
                <span className="linha__titulo">Paguei por fora do extrato</span>
                <span className="linha__sub">Dinheiro, outro banco ou o débito ainda não apareceu</span>
              </span>
            </Opcao>
          </div>
          {atual === POR_FORA && (
            <div className="campo pagar__data">
              <span>Pago em</span>
              <CampoData rotulo="Pago em" valor={data} hoje={hoje} aoMudar={setData} />
            </div>
          )}
          <div className="editor__rodape" style={{ position: 'static' }}>
            <span style={{ flex: 1 }} />
            <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
            <Botao variante="primario" icone="check" disabled={!atual} carregando={pagar.isPending} onClick={confirmar}>
              Marcar paga
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  );
}
