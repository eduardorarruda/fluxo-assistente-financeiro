import { useState } from 'react';
import { BotaoIcone } from '../../componentes/ui';
import { CampoRenomear } from './CampoRenomear';
import { type PropsSeletor, SeletorConta } from './SeletorConta';

interface Props {
  titulo: string;
  podeRenomear: boolean;
  aoRenomear: (titulo: string) => void;
  seletor: PropsSeletor | null;
  listaAberta: boolean;
  aoAlternarLista: () => void;
}

export function Cabecalho({ titulo, podeRenomear, aoRenomear, seletor, listaAberta, aoAlternarLista }: Props) {
  const [editando, setEditando] = useState(false);
  return (
    <header className="chat__topo">
      <BotaoIcone icone="recolher" rotulo={listaAberta ? 'Esconder conversas' : 'Mostrar conversas'} onClick={aoAlternarLista} aria-expanded={listaAberta} />
      <div className="chat__titulo">
        {editando ? (
          <CampoRenomear
            inicial={titulo}
            aoSalvar={(t) => {
              setEditando(false);
              aoRenomear(t);
            }}
            aoCancelar={() => setEditando(false)}
          />
        ) : podeRenomear ? (
          <h2>
            <button type="button" className="chat__titulo-botao" onClick={() => setEditando(true)} title="Renomear conversa">
              {titulo}
            </button>
          </h2>
        ) : (
          <h2>{titulo}</h2>
        )}
      </div>
      {seletor && <SeletorConta {...seletor} />}
    </header>
  );
}
