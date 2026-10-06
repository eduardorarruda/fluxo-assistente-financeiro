import { useEffect, useMemo, useState } from 'react';
import { ErroApi } from '../../api/cliente';
import { baixarVozNatural, removerVozNatural, useVozNatural, type EstadoVozNatural, type VozNatural } from '../../api/voz-natural';
import { Botao, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { FRASE_DE_EXEMPLO, type OpcoesFala } from './voz/fala';
import { criarMotorPiper, vozNaturalEfetiva } from './voz/fala-piper';
import type { PreferenciasVoz } from './voz/preferencias-voz';

/**
 * "Voz natural (Piper, no seu computador)" nos Ajustes de voz: um cartão por
 * voz do catálogo, com gênero, qualidade, tamanho e licença; baixar (com
 * progresso), ouvir, usar e remover. Tudo roda no servidor do Fluxo, nesta
 * máquina: depois de baixada, a voz não usa a internet.
 */

const porcento = (p: number) => `${Math.round(p * 100)}%`;
const mensagemDe = (e: unknown) => (e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.');

/** O exemplo dos Ajustes: um motor só para ele, que cala ao sair da tela. `tocando` diz qual botão está ativo. */
export function useExemploDeVoz() {
  const motor = useMemo(() => criarMotorPiper(), []);
  const [tocando, setTocando] = useState<string | null>(null);
  useEffect(() => {
    const tirar = motor.aoEsvaziar(() => setTocando(null));
    return () => {
      tirar();
      motor.parar();
    };
  }, [motor]);
  return {
    tocando,
    alternar(chave: string, opcoes: OpcoesFala) {
      motor.parar();
      if (tocando === chave) return setTocando(null);
      setTocando(chave);
      motor.preparar?.(opcoes);
      motor.falar(FRASE_DE_EXEMPLO, opcoes);
    },
  };
}

export type ExemploDeVoz = ReturnType<typeof useExemploDeVoz>;

function Progresso({ estado }: { estado: EstadoVozNatural }) {
  const instalando = estado.etapa === 'instalando' || estado.progresso === null;
  const rotulo = instalando ? 'Instalando a voz…' : `Baixando… ${porcento(estado.progresso ?? 0)}`;
  return (
    <div className="ajuste-rag__progresso voz-natural__progresso">
      <span className="pequeno texto-3">{rotulo}</span>
      <div
        className={`ajuste-rag__barra ${instalando ? 'ajuste-rag__barra--indeterminada' : ''}`}
        role="progressbar"
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={instalando ? undefined : Math.round((estado.progresso ?? 0) * 100)}
      >
        <span style={instalando ? undefined : { transform: `scaleX(${estado.progresso ?? 0})` }} />
      </div>
    </div>
  );
}

interface PropsCartao {
  voz: VozNatural;
  estado: EstadoVozNatural;
  emUso: boolean;
  padrao: boolean;
  velocidade: number;
  exemplo: ExemploDeVoz;
  ocupado: boolean;
  aoUsar: () => void;
  aoBaixar: () => void;
  aoRemover: () => void;
}

function CartaoVoz({ voz, estado, emUso, padrao, velocidade, exemplo, ocupado, aoUsar, aoBaixar, aoRemover }: PropsCartao) {
  const baixandoEsta = estado.vozBaixando === voz.id;
  const ouvindo = exemplo.tocando === `natural:${voz.id}`;
  const classes = ['voz-natural__cartao', `voz-natural__cartao--${voz.genero}`, emUso ? 'voz-natural__cartao--em-uso' : '', voz.instalada ? '' : 'voz-natural__cartao--ausente'];
  return (
    <li className={classes.filter(Boolean).join(' ')} aria-label={`Voz ${voz.nome}`}>
      <div className="voz-natural__cabeca">
        <span className="voz-natural__avatar" aria-hidden>
          {voz.nome.slice(0, 1)}
        </span>
        <span className="voz-natural__nome">
          <strong>{voz.nome}</strong>
          <span className="pequeno texto-3">
            {voz.genero === 'feminina' ? 'Feminina' : 'Masculina'} · qualidade {voz.qualidade}
          </span>
        </span>
        {emUso ? (
          <Selo tom="marca" icone="check">Em uso</Selo>
        ) : padrao ? (
          <Selo tom="neutro">Recomendada</Selo>
        ) : null}
      </div>
      <p className="voz-natural__descricao">{voz.descricao}</p>
      <p className="voz-natural__licenca" title={`Licença: ${voz.licenca}. Crédito: ${voz.credito}.`}>
        <Icone nome={voz.naoComercial ? 'cadeado' : 'nota'} tamanho={13} />
        <span>
          {voz.licenca} · {voz.credito}
        </span>
      </p>

      {baixandoEsta ? (
        <Progresso estado={estado} />
      ) : voz.instalada ? (
        <div className="voz-natural__acoes">
          {!emUso && (
            <Botao pequeno variante="primario" icone="check" onClick={aoUsar}>
              Usar esta voz
            </Botao>
          )}
          <Botao
            pequeno
            icone={ouvindo ? 'parar' : 'play'}
            onClick={() => exemplo.alternar(`natural:${voz.id}`, { voz: null, velocidade, motor: 'piper', vozNatural: voz.id })}
          >
            {ouvindo ? 'Parar' : 'Ouvir'}
          </Botao>
          <Botao pequeno variante="fantasma" icone="lixo" onClick={aoRemover} disabled={ocupado} aria-label={`Remover a voz ${voz.nome}`} title={`Libera ${voz.tamanhoMb} MB`}>
            Remover
          </Botao>
        </div>
      ) : (
        <div className="voz-natural__acoes">
          <Botao pequeno variante={padrao ? 'primario' : 'secundario'} icone="baixar" onClick={aoBaixar} disabled={estado.baixando || ocupado}>
            Baixar (~{voz.tamanhoMb} MB)
          </Botao>
        </div>
      )}
    </li>
  );
}

export function AjusteVozNatural({ prefs, mudar, exemplo }: { prefs: PreferenciasVoz; mudar: (m: Partial<PreferenciasVoz>) => void; exemplo: ExemploDeVoz }) {
  const { estado, carregando, erro: erroLeitura } = useVozNatural();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!estado) {
    return (
      <fieldset className="ajuste-voz__grupo voz-natural">
        <legend>Voz natural (Piper, no seu computador)</legend>
        <p className="pequeno texto-3">{carregando ? 'Carregando as vozes…' : (erroLeitura ?? 'Carregando as vozes…')}</p>
      </fieldset>
    );
  }

  const efetiva = prefs.motorFala === 'piper' ? vozNaturalEfetiva(prefs, estado) : null;
  const agir = async (acao: () => Promise<void>) => {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <fieldset className="ajuste-voz__grupo voz-natural">
      <legend>Voz natural (Piper, no seu computador)</legend>
      <p className="pequeno texto-3 voz-natural__intro">
        <Icone nome="escudo" tamanho={14} />
        <span>
          Vozes neurais que leem as respostas com entonação de gente. Rodam aqui mesmo: depois de baixadas, nada do que o assistente fala sai do computador.
        </span>
      </p>
      <ul className="voz-natural__cartoes">
        {estado.vozes.map((v) => (
          <CartaoVoz
            key={v.id}
            voz={v}
            estado={estado}
            emUso={efetiva === v.id}
            padrao={v.id === estado.vozPadrao}
            velocidade={prefs.velocidade}
            exemplo={exemplo}
            ocupado={ocupado}
            aoUsar={() => mudar({ motorFala: 'piper', vozNatural: v.id })}
            aoBaixar={() => void agir(() => baixarVozNatural(v.id))}
            aoRemover={() => void agir(() => removerVozNatural(v.id))}
          />
        ))}
      </ul>
      {(erro ?? estado.erro) && (
        <p className="ajuste-rag__erro" role="alert">
          <Icone nome="alerta" tamanho={15} /> {erro ?? estado.erro}
        </p>
      )}
      <p className="pequeno texto-3">
        As vozes com licença não comercial (CC BY-NC-ND) podem ser usadas à vontade aqui, para uso pessoal. Os pacotes vêm do GitHub do sherpa-onnx e são conferidos
        (tamanho e SHA-256) antes de instalar.
      </p>
    </fieldset>
  );
}
