import { createContext, useCallback, useContext, useState } from 'react';
import type { Anexo } from '../../../api/tipos-assistente';
import { Modal } from '../../../componentes/ui';
import { Icone } from '../../../icones/Icone';

/**
 * Imagens na resposta: só `anexo:<uuid>` — um anexo desta conversa, servido
 * pelo próprio Fluxo. Qualquer outra origem (http, data:, caminho) continua
 * bloqueada no Markdown: uma imagem remota vazaria dados num simples GET.
 */
export const PADRAO_ANEXO = /^anexo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const urlDoAnexo = (id: string) => `/api/assistente/anexos/${encodeURIComponent(id)}/arquivo`;

/** O id do anexo, se a fonte da imagem for `anexo:<uuid>`; senão null. */
export function anexoDaFonte(fonte: string | undefined): string | null {
  return PADRAO_ANEXO.exec(fonte?.trim() ?? '')?.[1]?.toLowerCase() ?? null;
}

/** Os anexos da mensagem, para a legenda saber de onde veio a imagem. */
export const ContextoAnexos = createContext<ReadonlyMap<string, Anexo>>(new Map());

function legenda(anexo: Anexo | undefined): string {
  if (anexo?.origem === 'gerada') return 'Gerada pelo Nano Banana';
  if (anexo?.origem === 'pessoa') return 'Imagem que você enviou';
  return 'Imagem desta conversa';
}

function BotaoBaixar({ id }: { id: string }) {
  return (
    <a className="acao-mini imagem-ia__baixar" href={urlDoAnexo(id)} download aria-label="Baixar imagem" title="Baixar imagem">
      <Icone nome="baixar" tamanho={15} />
      <span>Baixar</span>
    </a>
  );
}

/** A imagem com moldura; clicar abre grande, e dá para baixar. */
export function ImagemDaResposta({ id, alt }: { id: string; alt: string }) {
  const anexo = useContext(ContextoAnexos).get(id);
  const [aberta, setAberta] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const fechar = useCallback(() => setAberta(false), []);
  const descricao = alt.trim() || anexo?.nome || 'Imagem';
  if (falhou) return <span className="md__sem-imagem">[imagem indisponível: {descricao}]</span>;
  return (
    <span className="imagem-ia">
      <button type="button" className="imagem-ia__abrir" onClick={() => setAberta(true)} aria-label={`Ampliar: ${descricao}`}>
        <img src={urlDoAnexo(id)} alt={descricao} loading="lazy" decoding="async" onError={() => setFalhou(true)} />
      </button>
      <span className="imagem-ia__rodape">
        <span className="imagem-ia__origem"><Icone nome="faisca" tamanho={13} />{legenda(anexo)}</span>
        <BotaoBaixar id={id} />
      </span>
      <Modal aberto={aberta} aoFechar={fechar} titulo={descricao}>
        <div className="imagem-ia__grande">
          <img src={urlDoAnexo(id)} alt={descricao} />
          <BotaoBaixar id={id} />
        </div>
      </Modal>
    </span>
  );
}
