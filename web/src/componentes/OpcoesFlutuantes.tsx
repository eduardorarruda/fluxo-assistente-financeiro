import type { ReactNode } from 'react';
import { Icone } from '../icones/Icone';

/**
 * As opções de uma lista flutuante (Seletor e CampoSugestoes): ícone, nome,
 * descrição, selo ("Novo"), atalho de teclado, marca da escolhida, separador
 * e — para "Mais modelos" — um submenu que abre ao lado.
 */

export interface OpcaoSeletor {
  valor: string;
  rotulo: string;
  descricao?: string;
  icone?: ReactNode;
  /** Título do grupo; opções seguidas com o mesmo grupo ficam juntas. */
  grupo?: string;
  desabilitada?: boolean;
  /** Por que está desabilitada (aparece ao passar o mouse e para leitores de tela). */
  dica?: string;
  /** Selo pequeno à direita ("Novo"). */
  selo?: string;
  /** Tecla (1–9) que escolhe a opção com a lista aberta. */
  atalho?: string;
  /** Linha separando esta opção das anteriores. */
  separadorAntes?: boolean;
  /** Opções que abrem num painel ao lado (a própria opção não é escolhida). */
  submenu?: OpcaoSeletor[];
}

interface Props {
  opcoes: readonly OpcaoSeletor[];
  base: string;
  valor: string;
  ativa: number;
  /** Índice da opção cujo submenu está aberto. */
  aberta?: number;
  aoApontar: (i: number) => void;
  aoEscolher: (i: number) => void;
}

export const idDaOpcao = (base: string, i: number) => `${base}-opcao-${i}`;

/** Esta opção (ou alguma do submenu dela) é o valor escolhido. */
export function contemValor(o: OpcaoSeletor, valor: string): boolean {
  return o.valor === valor || Boolean(o.submenu?.some((s) => contemValor(s, valor)));
}

export function OpcoesFlutuantes({ opcoes, base, valor, ativa, aberta, aoApontar, aoEscolher }: Props) {
  return (
    <>
      {opcoes.map((o, i) => {
        const escolhida = o.submenu ? false : o.valor === valor;
        const classes = [
          'flutuante__opcao',
          i === ativa && 'flutuante__opcao--ativa',
          escolhida && 'flutuante__opcao--escolhida',
          o.submenu && contemValor(o, valor) && 'flutuante__opcao--contem',
        ].filter(Boolean).join(' ');
        return (
          <div key={`${o.grupo ?? ''}|${o.valor}`} role="presentation">
            {o.separadorAntes && i > 0 && <div className="flutuante__separador" role="separator" />}
            {o.grupo && o.grupo !== opcoes[i - 1]?.grupo && <div className="flutuante__grupo" role="presentation">{o.grupo}</div>}
            <div
              id={idDaOpcao(base, i)}
              role="option"
              aria-selected={escolhida}
              aria-disabled={o.desabilitada || undefined}
              aria-haspopup={o.submenu ? 'listbox' : undefined}
              aria-expanded={o.submenu ? aberta === i : undefined}
              aria-description={o.dica}
              title={o.dica}
              className={classes}
              onPointerMove={() => !o.desabilitada && i !== ativa && aoApontar(i)}
              onClick={() => aoEscolher(i)}
            >
              {o.icone && <span className="flutuante__icone">{o.icone}</span>}
              <span className="flutuante__textos">
                <span className="flutuante__rotulo">{o.rotulo}</span>
                {o.descricao && <span className="flutuante__descricao">{o.descricao}</span>}
              </span>
              {o.selo && <span className="flutuante__selo">{o.selo}</span>}
              {o.desabilitada && o.dica && <Icone nome="info" tamanho={14} className="flutuante__info" />}
              {escolhida && <Icone nome="check" tamanho={15} className="flutuante__marca" />}
              {!escolhida && o.atalho && !o.submenu && <kbd className="flutuante__atalho">{o.atalho}</kbd>}
              {o.submenu && <Icone nome="chevron-dir" tamanho={15} className="flutuante__seta" />}
            </div>
          </div>
        );
      })}
    </>
  );
}
