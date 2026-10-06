import { type ReactNode, useId } from 'react';
import type { ContaIA, ProvedorInfo } from '../../api/tipos-assistente';
import { Botao, Selo } from '../../componentes/ui';
import { AjusteConta } from './AjusteConta';
import { Comando, MarcaProvedor } from './comum';
import type { AcoesContas } from './useAcoesContas';

/** O CLI está instalado se qualquer conta dele achou o programa. */
function SituacaoInstalacao({ contas }: { contas: ContaIA[] }) {
  const instalada = contas.find((c) => c.instalado);
  if (!instalada) return <Selo tom="ruim" icone="alerta">Não instalado</Selo>;
  const versao = instalada.versao?.replace(/^v/i, '');
  return <Selo tom="bom" icone="check">{versao ? `Instalado · v${versao}` : 'Instalado'}</Selo>;
}

interface Props {
  info: ProvedorInfo;
  /** Só as contas de CLI deste provedor. */
  contas: ContaIA[];
  acoes: AcoesContas;
  recemCriada: string | null;
  /** O formulário de conta nova está aberto aqui. */
  adicionando: boolean;
  aoAdicionar: () => void;
  /** O formulário, quando aberto neste grupo. */
  children?: ReactNode;
}

/** Um CLI e as contas dele, com o botão de adicionar mais uma. */
export function GrupoCli({ info, contas, acoes, recemCriada, adicionando, aoAdicionar, children }: Props) {
  const idTitulo = useId();
  const instalado = contas.some((c) => c.instalado);

  return (
    <section className="grupo-cli" aria-labelledby={idTitulo}>
      <header className="grupo-cli__topo">
        <MarcaProvedor provedor={info.provedor} tamanho={32} />
        <div className="grupo-cli__titulo">
          <h4 id={idTitulo}>{info.nome}</h4>
          <SituacaoInstalacao contas={contas} />
        </div>
        <Botao pequeno variante="fantasma" icone="mais" onClick={aoAdicionar} disabled={adicionando} aria-label={`Adicionar conta do ${info.nome}`}>
          Adicionar conta
        </Botao>
      </header>
      {!instalado && <Comando rotulo="Para instalar" comando={info.comoInstalar} />}
      <div className="grupo-cli__contas">
        {contas.map((conta) => (
          <AjusteConta key={conta.id} conta={conta} info={info} acoes={acoes} recemCriada={recemCriada === conta.id} />
        ))}
      </div>
      {children}
    </section>
  );
}
