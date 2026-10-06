import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAVE_GOOGLE, iniciarConexaoGoogle, useEstadoGoogle, type EstadoGoogle } from '../../api/google';
import { useAvisar } from '../../componentes/Avisos';

const NOME_DA_JANELA = 'fluxo-google';
const FORMATO_DA_JANELA = 'popup=yes,width=520,height=720';
/** O pedido de conexão vale 10 minutos no servidor; depois disso, para de esperar. */
const ESPERA_MAXIMA_MS = 10 * 60 * 1000;
const CONFERIR_JANELA_MS = 800;

interface MensagemDoRetorno {
  tipo: 'fluxo-google';
  resultado: 'ok' | 'erro';
}

const ehMensagemDoRetorno = (d: unknown): d is MensagemDoRetorno =>
  typeof d === 'object' && d !== null && (d as MensagemDoRetorno).tipo === 'fluxo-google';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

/**
 * "Conectar com o Google": abre o consentimento numa janelinha e espera a
 * volta. A página de retorno avisa por BroadcastChannel e por
 * `opener.postMessage` (só aceito da própria origem); como o Google pode
 * cortar o `opener` e o canal pode faltar, enquanto espera a tela também
 * consulta o estado a cada 1,5 s.
 */
export function useConexaoGoogle() {
  const [aguardando, setAguardando] = useState(false);
  const { data: estado } = useEstadoGoogle(aguardando);
  const [linkManual, setLinkManual] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const janela = useRef<Window | null>(null);
  const inicio = useRef(0);
  const cliente = useQueryClient();
  const avisar = useAvisar();

  const terminar = useCallback((resultado: 'ok' | 'erro' | 'cancelado') => {
    setAguardando(false);
    setLinkManual(null);
    janela.current = null;
    void cliente.invalidateQueries({ queryKey: CHAVE_GOOGLE });
    if (resultado === 'ok') avisar('sucesso', 'Google Agenda conectado. Criando a agenda "Fluxo" com os seus vencimentos…');
    if (resultado === 'erro') avisar('erro', 'A conexão com o Google não foi concluída. O motivo aparece na janela do Google.');
  }, [cliente, avisar]);

  // A página de retorno avisou (canal ou postMessage).
  useEffect(() => {
    if (!aguardando) return;
    const receber = (dado: unknown) => ehMensagemDoRetorno(dado) && terminar(dado.resultado);
    const aoMensagem = (e: MessageEvent) => e.origin === window.location.origin && receber(e.data);
    window.addEventListener('message', aoMensagem);
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(NOME_DA_JANELA);
      canal.onmessage = (e) => receber(e.data);
    } catch {
      canal = null; // navegador sem BroadcastChannel: a consulta ao estado cobre
    }
    return () => {
      window.removeEventListener('message', aoMensagem);
      canal?.close();
    };
  }, [aguardando, terminar]);

  // A consulta ao estado viu a conexão (o caminho que sempre funciona).
  useEffect(() => {
    if (aguardando && estado?.conectado) terminar('ok');
  }, [aguardando, estado?.conectado, terminar]);

  // Fechou a janelinha sem terminar, ou passou do prazo: para de esperar.
  useEffect(() => {
    if (!aguardando) return;
    const t = setInterval(() => {
      const fechada = janela.current?.closed === true;
      if (fechada || Date.now() - inicio.current > ESPERA_MAXIMA_MS) {
        // Uma última olhada: a janela pode ter fechado sozinha depois do sucesso.
        void cliente.refetchQueries({ queryKey: CHAVE_GOOGLE })
          .catch(() => undefined)
          .then(() => terminar(cliente.getQueryData<EstadoGoogle>(CHAVE_GOOGLE)?.conectado ? 'ok' : 'cancelado'));
        clearInterval(t);
      }
    }, CONFERIR_JANELA_MS);
    return () => clearInterval(t);
  }, [aguardando, cliente, terminar]);

  /** Abre a janela já no clique (senão o bloqueador de pop-up barra) e só depois pede a URL ao servidor. */
  const conectar = useCallback(async () => {
    const aberta = window.open('about:blank', NOME_DA_JANELA, FORMATO_DA_JANELA);
    setAbrindo(true);
    try {
      const { url } = await iniciarConexaoGoogle();
      inicio.current = Date.now();
      if (aberta && !aberta.closed) {
        aberta.location.href = url;
        janela.current = aberta;
        setLinkManual(null);
      } else {
        janela.current = null;
        setLinkManual(url); // pop-up bloqueado: a pessoa abre pelo link
      }
      setAguardando(true);
    } catch (e) {
      aberta?.close();
      avisar('erro', mensagemDe(e));
    } finally {
      setAbrindo(false);
    }
  }, [avisar]);

  const cancelar = useCallback(() => {
    janela.current?.close();
    terminar('cancelado');
  }, [terminar]);

  return { aguardando, abrindo, linkManual, conectar, cancelar };
}
