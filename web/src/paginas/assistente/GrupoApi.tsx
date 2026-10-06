import { type ReactNode, useId } from 'react';
import type { ContaIA, ProvedorInfo } from '../../api/tipos-assistente';
import { Botao } from '../../componentes/ui';
import { AjusteConta } from './AjusteConta';
import { MarcaProvedor } from './comum';
import type { AcoesContas } from './useAcoesContas';

interface Props {
  info: ProvedorInfo;
  /** Só as contas de API deste provedor. */
  contas: ContaIA[];
  acoes: AcoesContas;
  recemCriada: string | null;
  adicionando: boolean;
  aoAdicionar: () => void;
  /** O formulário, quando aberto neste grupo. */
  children?: ReactNode;
}

/** A API de um provedor (ex.: "API da Anthropic") e as contas ligadas a ela por chave. */
export function GrupoApi({ info, contas, acoes, recemCriada, adicionando, aoAdicionar, children }: Props) {
  const idTitulo = useId();
  return (
    <section className="grupo-cli grupo-cli--api" aria-labelledby={idTitulo}>
      <header className="grupo-cli__topo">
        <MarcaProvedor provedor={info.provedor} tamanho={32} />
        <div className="grupo-cli__titulo">
          <h4 id={idTitulo}>{info.api.nome}</h4>
          <span className="texto-3 pequeno">cobrado por uso</span>
        </div>
        <Botao pequeno variante="fantasma" icone="mais" onClick={aoAdicionar} disabled={adicionando} aria-label={`Adicionar conta da ${info.api.nome}`}>
          Adicionar conta
        </Botao>
      </header>
      <div className="grupo-cli__contas">
        {contas.map((conta) => (
          <AjusteConta key={conta.id} conta={conta} info={info} acoes={acoes} recemCriada={recemCriada === conta.id} />
        ))}
      </div>
      {children}
    </section>
  );
}
