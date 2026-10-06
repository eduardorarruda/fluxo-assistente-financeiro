import { AnimatePresence, motion } from 'motion/react';
import { type KeyboardEvent as TeclaReact, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router';
import { useConfigAssistente } from '../../api/assistente';
import { Botao, Carregando, Vazio } from '../../componentes/ui';
import { useTelaEstreita } from './comum';
import { ListaConversas } from './ListaConversas';
import { PainelConversa } from './PainelConversa';

const CHAVE_LISTA = 'fluxo:assistente-lista';

function lerListaAberta(): boolean {
  try {
    return localStorage.getItem(CHAVE_LISTA) !== 'fechada';
  } catch {
    return true;
  }
}

function salvarListaAberta(aberta: boolean): void {
  try {
    localStorage.setItem(CHAVE_LISTA, aberta ? 'aberta' : 'fechada');
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

/** Alt+N abre uma conversa nova — vale até dentro da caixa de texto. */
function useAtalhoNova(aoNova: () => void) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyN') return;
      e.preventDefault();
      aoNova();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aoNova]);
}

const FOCAVEIS = 'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Gaveta de conversas (tela estreita): o foco entra nela ao abrir, o Tab não escapa para
 * a tela de trás (coberta pelo véu) e, ao fechar com Esc ou no véu, volta para quem a abriu.
 * Se o foco já foi para outro lugar (a caixa de texto de uma conversa aberta), fica lá.
 */
function useFocoDaGaveta(aberta: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const gaveta = ref.current;
    if (!aberta || !gaveta) return;
    const quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    gaveta.querySelector<HTMLElement>(FOCAVEIS)?.focus();
    return () => {
      const atual = document.activeElement;
      if (!atual || atual === document.body || gaveta.contains(atual)) quemAbriu?.focus();
    };
  }, [aberta]);
  const aoTeclar = (e: TeclaReact<HTMLElement>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const focaveis = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    const primeiro = focaveis[0];
    const ultimo = focaveis.at(-1);
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo?.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro?.focus();
    }
  };
  return { ref, aoTeclar };
}

/**
 * A tela de conversa. A lista fica à esquerda (vira gaveta em tela estreita); o
 * painel no meio continua montado quando uma conversa nova ganha id, para não
 * perder o texto nem os anexos que estão subindo.
 */
export function Assistente() {
  const { conversaId } = useParams();
  const navegar = useNavigate();
  const config = useConfigAssistente();
  const estreita = useTelaEstreita();
  const [listaAberta, setListaAberta] = useState(lerListaAberta);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const focoGaveta = useFocoDaGaveta(estreita && gavetaAberta);
  const [geracao, setGeracao] = useState(0);
  const [criada, setCriada] = useState<string | null>(null);

  // Saiu da conversa recém-criada para /assistente (pelo menu, por exemplo): o painel recomeça do zero.
  // Comparar com a rota anterior (e não só olhar o estado) evita confundir isso com o instante em que
  // a conversa acabou de ser criada e a navegação ainda não chegou.
  const anterior = useRef(conversaId);
  useEffect(() => {
    if (anterior.current && !conversaId && anterior.current === criada) {
      setCriada(null);
      setGeracao((g) => g + 1);
    }
    anterior.current = conversaId;
  }, [conversaId, criada]);

  const novaConversa = useCallback(() => {
    setGeracao((g) => g + 1);
    setCriada(null);
    setGavetaAberta(false);
    navegar('/assistente');
  }, [navegar]);
  useAtalhoNova(novaConversa);

  const aoCriada = useCallback(
    (id: string) => {
      setCriada(id);
      navegar(`/assistente/${encodeURIComponent(id)}`, { replace: true });
    },
    [navegar],
  );

  useEffect(() => {
    if (!gavetaAberta) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setGavetaAberta(false);
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [gavetaAberta]);

  const alternarLista = () => {
    if (estreita) return setGavetaAberta((a) => !a);
    const nova = !listaAberta;
    setListaAberta(nova);
    salvarListaAberta(nova);
  };

  if (config.isLoading) return <Carregando linhas={2} />;
  if (!config.data) {
    return (
      <Vazio
        icone="alerta"
        titulo="O assistente não respondeu"
        texto={config.error instanceof Error ? config.error.message : 'Tente de novo em instantes.'}
        acao={<Botao icone="sincronizar" onClick={() => void config.refetch()}>Tentar de novo</Botao>}
      />
    );
  }

  const chavePainel = conversaId && conversaId !== criada ? conversaId : `nova-${geracao}`;
  const fecharGaveta = () => setGavetaAberta(false);
  const lista = (
    <ListaConversas conversaAtiva={conversaId} aoNova={novaConversa} aoAbrir={fecharGaveta} aoFechar={estreita ? fecharGaveta : undefined} />
  );
  const mostrarLista = estreita ? gavetaAberta : listaAberta;

  return (
    <div className={`assistente ${!estreita && listaAberta ? 'assistente--com-lista' : ''}`}>
      {!estreita && listaAberta && <aside className="assistente__lista" aria-label="Conversas">{lista}</aside>}
      {/* No corpo do documento: a transição de tela usa transform, que prenderia o position: fixed. */}
      {createPortal(
        <AnimatePresence>
          {estreita && gavetaAberta && (
            <>
              <motion.div className="veu assistente__veu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={fecharGaveta} />
              <motion.aside
                ref={focoGaveta.ref}
                className="assistente__lista assistente__lista--gaveta"
                role="dialog"
                aria-modal="true"
                aria-label="Conversas"
                onKeyDown={focoGaveta.aoTeclar}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 360, damping: 36 }}
              >
                {lista}
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
      <PainelConversa
        key={chavePainel}
        conversaId={conversaId}
        config={config.data}
        aoCriada={aoCriada}
        aoNova={novaConversa}
        listaAberta={mostrarLista}
        aoAlternarLista={alternarLista}
      />
    </div>
  );
}
