import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { acoesPorMensagem, useAcoesDaConversa } from '../../api/acoes-assistente';
import type { Mensagem } from '../../api/tipos-assistente';
import { Icone } from '../../icones/Icone';
import { MensagemAssistente, MensagemUsuario } from './Mensagem';

/** Distância do fim (px) que ainda conta como "estar no fim". */
const FOLGA_FIM = 80;

interface Props {
  conversaId: string;
  mensagens: Mensagem[];
  aoRepetir: (mensagemId: string) => void;
  repetindo: boolean;
}

/** Algo que muda sempre que o conteúdo cresce: mensagem nova, texto que chega, passo novo. */
function assinatura(mensagens: Mensagem[]): string {
  const ultima = mensagens.at(-1);
  return `${mensagens.length}:${ultima?.id ?? ''}:${ultima?.texto.length ?? 0}:${ultima?.passos.length ?? 0}:${ultima?.situacao ?? ''}`;
}

/**
 * Lista que rola sozinha enquanto a resposta chega — mas só se a pessoa está no
 * fim. Se ela subiu para ler, a tela fica parada e aparece "Ir para o fim".
 */
export function ListaMensagens({ conversaId, mensagens, aoRepetir, repetindo }: Props) {
  const rolagem = useRef<HTMLDivElement>(null);
  const noFimRef = useRef(true);
  const [noFim, setNoFim] = useState(true);
  const ultimaUsuario = mensagens.findLast((m) => m.papel === 'usuario')?.id;
  const ultima = mensagens.at(-1);
  const { data: acoes } = useAcoesDaConversa(conversaId);
  const cartoes = useMemo(() => acoesPorMensagem(acoes), [acoes]);

  const irParaOFim = useCallback((suave: boolean) => {
    const el = rolagem.current;
    if (!el) return;
    if (suave && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
    noFimRef.current = true;
    setNoFim(true);
  }, []);

  // Abriu outra conversa: começa do fim.
  useLayoutEffect(() => irParaOFim(false), [conversaId, irParaOFim]);
  // A pessoa mandou mensagem: acompanha, mesmo que estivesse lendo lá em cima.
  useLayoutEffect(() => {
    if (ultimaUsuario) irParaOFim(false);
  }, [ultimaUsuario, irParaOFim]);
  const sinal = assinatura(mensagens);
  useLayoutEffect(() => {
    if (noFimRef.current) irParaOFim(false);
  }, [sinal, irParaOFim]);

  // Conteúdo que muda de altura sem mudar a assinatura (abrir passos, imagens): segura no fim.
  useEffect(() => {
    const el = rolagem.current;
    const filho = el?.firstElementChild;
    if (!el || !filho || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => noFimRef.current && (el.scrollTop = el.scrollHeight));
    obs.observe(filho);
    return () => obs.disconnect();
  }, []);

  const aoRolar = () => {
    const el = rolagem.current;
    if (!el) return;
    const fim = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLGA_FIM;
    noFimRef.current = fim;
    setNoFim(fim);
  };

  return (
    <div className="chat__lista">
      <div className="chat__rolagem" ref={rolagem} onScroll={aoRolar}>
        <div className="chat__mensagens" role="log" aria-label="Mensagens da conversa">
          {mensagens.map((m) =>
            m.papel === 'usuario' ? (
              <MensagemUsuario key={m.id} mensagem={m} />
            ) : (
              <MensagemAssistente
                key={m.id}
                mensagem={m}
                acoes={cartoes.get(m.id)}
                aoRepetir={m.id === ultima?.id ? () => aoRepetir(m.id) : undefined}
                repetindo={m.id === ultima?.id && repetindo}
              />
            ),
          )}
        </div>
      </div>
      <AnimatePresence>
        {!noFim && (
          <motion.button
            type="button"
            className="chat__ir-fim"
            onClick={() => irParaOFim(true)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <Icone nome="seta-baixo" tamanho={15} />
            Ir para o fim
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
