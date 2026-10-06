import { type ReactNode, useId } from 'react';
import { Icone } from '../../icones/Icone';

export interface OpcaoCartao<T extends string> {
  valor: T;
  titulo: string;
  descricao: ReactNode;
  icone: ReactNode;
  /** Selo pequeno no canto ("Por uso"). */
  selo?: string;
  desabilitada?: boolean;
  /** Por que está desabilitada (aparece no lugar da descrição). */
  dica?: string;
}

interface Props<T extends string> {
  legenda: string;
  /** Número do passo, ao lado da legenda. */
  passo: number;
  opcoes: readonly OpcaoCartao<T>[];
  valor: T | null;
  aoMudar: (valor: T) => void;
  /** 'largo' = cartões com texto (2 por linha); 'compacto' = ícone e nome (3 por linha). */
  formato?: 'largo' | 'compacto';
  autoFocus?: boolean;
}

/**
 * Escolha única em cartões: por baixo, rádios de verdade (setas trocam, Tab entra
 * e sai do grupo, leitor de tela anuncia "1 de 2"), só que desenhados no visual do app.
 */
export function EscolhaCartoes<T extends string>({ legenda, passo, opcoes, valor, aoMudar, formato = 'largo', autoFocus }: Props<T>) {
  const nome = useId();
  const primeira = opcoes.findIndex((o) => !o.desabilitada);
  return (
    <fieldset className={`escolha-cartoes escolha-cartoes--${formato}`}>
      <legend className="escolha-cartoes__legenda">
        <span className="escolha-cartoes__passo" aria-hidden>{passo}</span>
        {legenda}
      </legend>
      <div className="escolha-cartoes__grade">
        {opcoes.map((o, i) => {
          const idDescricao = `${nome}-${o.valor}-descricao`;
          return (
            <label key={o.valor} className={`cartao-escolha ${o.desabilitada ? 'cartao-escolha--off' : ''}`} title={o.desabilitada ? o.dica : undefined}>
              <input
                type="radio"
                className="cartao-escolha__radio"
                name={nome}
                value={o.valor}
                checked={valor === o.valor}
                disabled={o.desabilitada}
                onChange={() => aoMudar(o.valor)}
                autoFocus={autoFocus && i === primeira && valor === null}
                aria-describedby={idDescricao}
              />
              <span className="cartao-escolha__icone">{o.icone}</span>
              <span className="cartao-escolha__textos">
                <span className="cartao-escolha__titulo">
                  {o.titulo}
                  {o.selo && <span className="cartao-escolha__selo">{o.selo}</span>}
                </span>
                <span id={idDescricao} className="cartao-escolha__descricao">{o.desabilitada && o.dica ? o.dica : o.descricao}</span>
              </span>
              <span className="cartao-escolha__marca" aria-hidden>
                <Icone nome="check" tamanho={13} traco={2.4} />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
