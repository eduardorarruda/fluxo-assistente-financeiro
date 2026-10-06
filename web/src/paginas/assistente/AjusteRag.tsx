import { useAcaoRag } from '../../api/assistente';
import type { EstadoRag } from '../../api/tipos-assistente';
import { useAvisar } from '../../componentes/Avisos';
import { Botao, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { inteiro, pct } from '../../util/formato';

function Situacao({ rag }: { rag: EstadoRag }) {
  if (rag.preparando) return <Selo tom="info" icone="sincronizar">Preparando</Selo>;
  if (rag.erro) return <Selo tom="ruim" icone="alerta">Com problema</Selo>;
  if (rag.ativo) return <Selo tom="bom" icone="check">Ativa</Selo>;
  return <Selo>Só por palavra</Selo>;
}

function Progresso({ rag }: { rag: EstadoRag }) {
  const fracao = rag.progresso;
  return (
    <div className="ajuste-rag__progresso">
      <div
        className={`ajuste-rag__barra ${fracao === null ? 'ajuste-rag__barra--indeterminada' : ''}`}
        role="progressbar"
        aria-label="Preparando a busca inteligente"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fracao === null ? undefined : Math.round(fracao * 100)}
      >
        <span style={fracao === null ? undefined : { transform: `scaleX(${Math.min(1, Math.max(0, fracao))})` }} />
      </div>
      <span className="texto-3 pequeno numero">
        {rag.etapa ?? 'Preparando…'}
        {fracao !== null && ` · ${pct(fracao)}`}
      </span>
    </div>
  );
}

/** "Busca inteligente": baixa o modelo de vetores uma vez e indexa movimentos e anexos. */
export function AjusteRag({ rag }: { rag: EstadoRag }) {
  const acao = useAcaoRag();
  const avisar = useAvisar();
  const executar = (tipo: 'ativar' | 'reindexar') =>
    acao.mutate(tipo, {
      onSuccess: () => avisar('info', tipo === 'ativar' ? 'Baixando o modelo. Pode continuar usando o Fluxo.' : 'Reindexando em segundo plano.'),
      onError: (e) => avisar('erro', e.message),
    });
  return (
    <section className="ajuste-rag" aria-labelledby="ajuste-rag-titulo">
      <div className="ajuste-rag__topo">
        <h3 id="ajuste-rag-titulo"><Icone nome="busca" tamanho={15} /> Busca inteligente (RAG)</h3>
        <Situacao rag={rag} />
      </div>
      <p className="texto-3 pequeno">
        Sem ela, o assistente acha movimentos pela palavra exata (“IFD*IFOOD”). Com ela, também pelo sentido (“comida fora de casa”). Tudo roda neste
        computador: o modelo ({rag.modelo}) é baixado uma vez e nada do seu extrato sai daqui.
      </p>
      {rag.preparando && <Progresso rag={rag} />}
      {rag.erro && <p className="ajuste-rag__erro" role="alert"><Icone nome="alerta" tamanho={15} /> {rag.erro}</p>}
      {(rag.ativo || rag.movimentosIndexados > 0) && (
        <p className="pequeno texto-2 numero">
          {inteiro(rag.movimentosIndexados)} de {inteiro(rag.movimentosTotal)} movimentos indexados · {inteiro(rag.trechosDeAnexos)} trechos de anexos
        </p>
      )}
      <div className="ajuste-rag__acoes">
        {rag.ativo ? (
          <Botao pequeno icone="sincronizar" onClick={() => executar('reindexar')} carregando={acao.isPending} disabled={rag.preparando}>
            Reindexar
          </Botao>
        ) : (
          <Botao pequeno variante="primario" icone="faisca" onClick={() => executar('ativar')} carregando={acao.isPending} disabled={rag.preparando}>
            Ativar (baixa ~120 MB uma vez)
          </Botao>
        )}
      </div>
    </section>
  );
}
