import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApagarConversa, useConversas, useMudarConversa } from '../../api/assistente';
import type { ResumoConversa } from '../../api/tipos-assistente';
import { useAvisar } from '../../componentes/Avisos';
import { Botao, BotaoIcone, Esqueleto, Modal } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { agruparConversas } from './agrupar';
import { ItemConversa } from './ItemConversa';

const ATRASO_BUSCA_MS = 250;

function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

interface Props {
  conversaAtiva: string | undefined;
  aoNova: () => void;
  /** Escolheu uma conversa (no celular, fecha a gaveta). */
  aoAbrir: () => void;
  /** Só na gaveta (tela estreita): mostra o botão de fechar ao lado de "Nova conversa". */
  aoFechar?: () => void;
  /** Injetável nos testes. */
  agora?: Date;
}

export function ListaConversas({ conversaAtiva, aoNova, aoAbrir, aoFechar, agora }: Props) {
  const [busca, setBusca] = useState('');
  const campoBusca = useRef<HTMLInputElement>(null);
  const limparBusca = () => {
    setBusca('');
    campoBusca.current?.focus();
  };
  const buscaAtrasada = useAtrasado(busca, ATRASO_BUSCA_MS);
  const { data, isLoading, isError, error } = useConversas(buscaAtrasada);
  const mudar = useMudarConversa();
  const apagar = useApagarConversa();
  const avisar = useAvisar();
  const navegar = useNavigate();
  const [aApagar, setAApagar] = useState<ResumoConversa | null>(null);
  const grupos = useMemo(() => agruparConversas(data ?? [], agora), [data, agora]);

  const aoErro = (e: unknown) => avisar('erro', mensagemDe(e));
  const confirmarExclusao = () => {
    if (!aApagar) return;
    const alvo = aApagar;
    apagar.mutate(alvo.id, {
      onSuccess: () => {
        setAApagar(null);
        avisar('sucesso', 'Conversa excluída.');
        if (alvo.id === conversaAtiva) navegar('/assistente', { replace: true });
      },
      onError: aoErro,
    });
  };

  return (
    <div className="lista-conversas">
      <div className="lista-conversas__topo">
        <div className="lista-conversas__acoes">
          <Botao variante="primario" icone="nova-conversa" onClick={aoNova} className="lista-conversas__nova" title="Nova conversa (Alt + N)">
            Nova conversa
          </Botao>
          {aoFechar && <BotaoIcone icone="fechar" rotulo="Fechar conversas" onClick={aoFechar} />}
        </div>
        <div className="busca lista-conversas__busca">
          <Icone nome="busca" tamanho={15} />
          <input
            ref={campoBusca}
            className="entrada"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              // Esc limpa a busca (e não fecha a gaveta); vazia, o Esc segue para quem estiver em volta.
              if (e.key !== 'Escape' || !busca) return;
              e.stopPropagation();
              limparBusca();
            }}
            placeholder="Buscar conversas"
            aria-label="Buscar conversas"
          />
          {busca && (
            <button type="button" className="lista-conversas__limpar" onClick={limparBusca} aria-label="Limpar busca" title="Limpar busca">
              <Icone nome="fechar" tamanho={13} traco={2.2} />
            </button>
          )}
        </div>
      </div>
      <nav className="lista-conversas__rolagem" aria-label="Conversas">
        {isLoading && (
          <div className="lista-conversas__carregando" aria-label="Carregando conversas">
            {[70, 90, 60, 80].map((l) => <Esqueleto key={l} altura={30} largura={`${l}%`} raio={10} />)}
          </div>
        )}
        {isError && <p className="lista-conversas__vazio" role="alert">{mensagemDe(error)}</p>}
        {!isLoading && !isError && grupos.length === 0 && (
          <p className="lista-conversas__vazio">{buscaAtrasada.trim() ? 'Nenhuma conversa com esse texto.' : 'Suas conversas aparecem aqui.'}</p>
        )}
        {grupos.map((g) => (
          <section key={g.nome} className="lista-conversas__grupo" aria-label={g.nome}>
            <h3>{g.nome}</h3>
            <ul>
              {g.conversas.map((c) => (
                <ItemConversa
                  key={c.id}
                  conversa={c}
                  ativa={c.id === conversaAtiva}
                  aoAbrir={aoAbrir}
                  aoFixar={(fixada) => mudar.mutate({ conversaId: c.id, fixada }, { onError: aoErro })}
                  aoRenomear={(titulo) => mudar.mutate({ conversaId: c.id, titulo }, { onError: aoErro })}
                  aoExcluir={() => setAApagar(c)}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <Modal aberto={aApagar !== null} aoFechar={() => setAApagar(null)} titulo="Excluir conversa?">
        <p className="texto-2">
          “{aApagar?.titulo}” e os anexos dela serão apagados de vez. Isso não mexe em nenhum dado do seu extrato.
        </p>
        <div className="modal__acoes">
          <Botao variante="fantasma" onClick={() => setAApagar(null)}>Cancelar</Botao>
          <Botao variante="perigo" icone="lixo" carregando={apagar.isPending} onClick={confirmarExclusao}>Excluir</Botao>
        </div>
      </Modal>
    </div>
  );
}
