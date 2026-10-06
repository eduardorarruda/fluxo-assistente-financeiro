import { useState } from 'react';
import { useDesconectarGoogle, useRemoverCredenciaisGoogle, useSincronizarGoogle, type EstadoGoogle } from '../../api/google';
import { useAvisar } from '../../componentes/Avisos';
import { Botao, Interruptor, Modal } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { haQuantoTempo } from '../../util/formato';
import { CredenciaisGoogle } from './CredenciaisGoogle';
import { useConexaoGoogle } from './useConexaoGoogle';

const GOOGLE_AGENDA = 'https://calendar.google.com/calendar/r';
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

function Erro({ texto }: { texto: string }) {
  return <p className="painel-google__erro" role="alert"><Icone nome="alerta" tamanho={15} /> <span>{texto}</span></p>;
}

/** Credenciais salvas: mostra o começo do ID; trocar/remover só desconectado. */
function CredenciaisSalvas({ estado }: { estado: EstadoGoogle }) {
  const [trocando, setTrocando] = useState(false);
  const remover = useRemoverCredenciaisGoogle();
  const avisar = useAvisar();
  if (trocando) return <CredenciaisGoogle aoCancelar={() => setTrocando(false)} />;
  return (
    <div className="painel-google__credenciais">
      <span className="painel-google__cliente">
        <Icone nome="cadeado" tamanho={15} /> Credenciais salvas <code className="numero">{estado.clienteId}</code>
      </span>
      <div className="ajuste-rag__acoes">
        <Botao pequeno variante="fantasma" icone="editar" onClick={() => setTrocando(true)}>Trocar</Botao>
        <Botao
          pequeno
          variante="fantasma"
          icone="lixo"
          carregando={remover.isPending}
          onClick={() => remover.mutate(undefined, { onSuccess: () => avisar('info', 'Credenciais do Google removidas.'), onError: (e) => avisar('erro', e.message) })}
        >
          Remover
        </Botao>
      </div>
    </div>
  );
}

function Desconectar({ estado }: { estado: EstadoGoogle }) {
  const [aberto, setAberto] = useState(false);
  const [apagarAgenda, setApagarAgenda] = useState(false);
  const desconectar = useDesconectarGoogle();
  const avisar = useAvisar();
  const confirmar = () =>
    desconectar.mutate(apagarAgenda, {
      onSuccess: (r) => {
        setAberto(false);
        avisar(r.aviso ? 'erro' : 'info', r.aviso ?? (apagarAgenda ? 'Desconectado. A agenda "Fluxo" foi apagada do Google.' : 'Desconectado. A agenda "Fluxo" continua no Google, parada.'));
      },
      onError: (e) => avisar('erro', mensagemDe(e)),
    });
  return (
    <>
      <Botao pequeno variante="fantasma" icone="plug" onClick={() => setAberto(true)}>Desconectar</Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Desconectar o Google Agenda?">
        <p className="texto-2">
          O Fluxo para de atualizar a agenda e devolve a autorização ao Google{estado.email ? <> da conta <strong>{estado.email}</strong></> : null}. As
          credenciais continuam salvas, para reconectar com um clique.
        </p>
        <div className="ajuste">
          <div>
            <strong>Apagar também a agenda “Fluxo”</strong>
            <p className="texto-3 pequeno">Some do Google com todos os {estado.eventos} eventos. Sem marcar, ela fica lá como está.</p>
          </div>
          <Interruptor ligado={apagarAgenda} aoMudar={setApagarAgenda} rotulo="Apagar também a agenda Fluxo" />
        </div>
        <div className="modal__acoes">
          <Botao onClick={() => setAberto(false)}>Cancelar</Botao>
          <Botao variante="perigo" icone="plug" carregando={desconectar.isPending} onClick={confirmar}>Desconectar</Botao>
        </div>
      </Modal>
    </>
  );
}

function Conectado({ estado }: { estado: EstadoGoogle }) {
  const sincronizar = useSincronizarGoogle();
  const avisar = useAvisar();
  const ocupado = sincronizar.isPending || estado.sincronizando;
  return (
    <>
      <div className="conta-google">
        <span className="conta-google__avatar" aria-hidden>{(estado.email ?? 'G').charAt(0).toUpperCase()}</span>
        <div className="conta-google__texto">
          <strong>{estado.email ?? 'Conta Google conectada'}</strong>
          <span className="texto-3 pequeno">
            Agenda “Fluxo” · {estado.eventos} {estado.eventos === 1 ? 'evento' : 'eventos'} ·{' '}
            {ocupado ? 'sincronizando…' : `sincronizada ${haQuantoTempo(estado.ultimaSincronizacao)}`}
          </span>
        </div>
      </div>
      {estado.erro && <Erro texto={estado.erro} />}
      <div className="painel-google__acoes">
        <Botao
          pequeno
          variante="primario"
          icone="sincronizar"
          carregando={ocupado}
          onClick={() => sincronizar.mutate(undefined, {
            onSuccess: (e) => (e.erro ? avisar('erro', e.erro) : avisar('sucesso', 'Agenda “Fluxo” em dia.')),
            onError: (e) => avisar('erro', mensagemDe(e)),
          })}
        >
          Sincronizar agora
        </Botao>
        <a className="botao botao--secundario botao--pequeno" href={GOOGLE_AGENDA} target="_blank" rel="noreferrer noopener">
          <Icone nome="calendario" tamanho={15} /> <span>Abrir o Google Agenda</span>
          <span className="oculto-leitor"> (abre em outra janela)</span>
        </a>
        <Desconectar estado={estado} />
      </div>
    </>
  );
}

type Conexao = ReturnType<typeof useConexaoGoogle>;

function Desconectado({ estado, conexao }: { estado: EstadoGoogle; conexao: Conexao }) {
  const { aguardando, abrindo, linkManual, conectar, cancelar } = conexao;
  return (
    <>
      <CredenciaisSalvas estado={estado} />
      {estado.erro && !aguardando && <Erro texto={estado.erro} />}
      {aguardando ? (
        <div className="espera-google" role="status">
          <Icone nome="sincronizar" tamanho={18} className="girando" />
          <div>
            <strong>Termine na janela do Google</strong>
            <p className="texto-3 pequeno">
              Escolha a conta e permita o acesso. Se aparecer “o Google não verificou este app”, clique em <em>Avançado</em> →{' '}
              <em>Acessar Fluxo</em>. Esta tela atualiza sozinha.
            </p>
            {linkManual && (
              <p className="pequeno">
                A janela não abriu (bloqueador de pop-up?).{' '}
                <a href={linkManual} target="_blank" rel="noreferrer noopener" className="guia-google__link">Abrir a página do Google ↗</a>
              </p>
            )}
          </div>
          <Botao pequeno variante="fantasma" onClick={cancelar}>Cancelar</Botao>
        </div>
      ) : (
        <div className="painel-google__acoes">
          <Botao variante="primario" icone="calendario" carregando={abrindo} onClick={() => void conectar()}>
            {estado.precisaReconectar ? 'Conectar de novo' : 'Conectar com o Google'}
          </Botao>
          <p className="texto-3 pequeno painel-google__dica">
            Abre uma janela do Google: você escolhe a conta e permite o acesso. Em seguida a agenda “Fluxo” aparece no seu Google Agenda.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * O lado "conta": credenciais → conectar → conectado. A espera pela volta do
 * Google mora aqui (e não no "Desconectado"), para o aviso de sucesso não se
 * perder quando o painel troca para "Conectado".
 */
export function ConexaoGoogle({ estado }: { estado: EstadoGoogle }) {
  const conexao = useConexaoGoogle();
  return (
    <div className="painel-google">
      <h3 className="painel-google__titulo">Conexão</h3>
      {!estado.configurado ? (
        <>
          {estado.erro && <Erro texto={estado.erro} />}
          <CredenciaisGoogle />
        </>
      ) : estado.conectado ? (
        <Conectado estado={estado} />
      ) : (
        <Desconectado estado={estado} conexao={conexao} />
      )}
    </div>
  );
}
