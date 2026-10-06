import type { ChangeEvent, CSSProperties } from 'react';
import { useVozNatural } from '../../api/voz-natural';
import { Seletor } from '../../componentes/Seletor';
import { Botao, Interruptor, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { AjusteVozNatural, useExemploDeVoz } from './AjusteVozNatural';
import { suportaFala, useVozes } from './voz/fala';
import { opcoesDaFala } from './voz/fala-piper';
import { opcoesDeVoz, VOZ_AUTOMATICA } from './voz/opcoes-voz';
import { LIMITES, usePreferenciasVoz } from './voz/preferencias-voz';
import { instalarLocal, type SituacaoLocal, suportaReconhecimento, useReconhecimentoLocal, usarLocal } from './voz/reconhecimento';

const decimal = (n: number, casas: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function textoDoLocal(s: SituacaoLocal): string {
  switch (s.estado) {
    case 'verificando':
      return 'Verificando se este Chrome reconhece português no computador…';
    case 'available':
      return 'Pacote de português pronto: a sua voz é transcrita aqui, sem sair do computador.';
    case 'downloadable':
      return 'Falta baixar o pacote de português (uma vez só). Depois disso, nada do que você fala sai do computador.';
    case 'downloading':
      return 'Baixando o pacote de português…';
    case 'unavailable':
      return 'Este Chrome não oferece reconhecimento de português no computador.';
    case 'sem-suporte':
      return 'Esta versão do navegador não reconhece fala no computador (precisa do Chrome 139 ou mais novo).';
  }
}

function SituacaoLocalVoz({ situacao, preferido }: { situacao: SituacaoLocal; preferido: boolean }) {
  const pronto = situacao.estado === 'available';
  const caiNoGoogle = preferido && !pronto && situacao.estado !== 'verificando';
  return (
    <div className="ajuste-voz__local">
      <p className={`pequeno ${pronto ? 'ajuste-voz__ok' : 'texto-3'}`}>
        {pronto && <Icone nome="check" tamanho={14} />} {textoDoLocal(situacao)}
      </p>
      {situacao.estado === 'downloading' && (
        <div className="ajuste-rag__barra ajuste-rag__barra--indeterminada" role="progressbar" aria-label="Baixando o pacote de português">
          <span />
        </div>
      )}
      {situacao.erro && <p className="ajuste-rag__erro" role="alert"><Icone nome="alerta" tamanho={15} /> {situacao.erro}</p>}
      {situacao.estado === 'downloadable' && (
        <div className="ajuste-rag__acoes">
          <Botao pequeno variante="primario" icone="baixar" carregando={situacao.instalando} onClick={() => void instalarLocal()}>
            Baixar pacote pt-BR
          </Botao>
        </div>
      )}
      {caiNoGoogle && <p className="pequeno texto-3">Enquanto o pacote não estiver pronto, o ditado e a conversa usam o reconhecimento do Google.</p>}
    </div>
  );
}

function OpcaoMotor<V extends string>({ grupo, valor, escolhido, titulo, descricao, icone, aoEscolher }: {
  grupo: string; valor: V; escolhido: boolean; titulo: string; descricao: string; icone: string; aoEscolher: (v: V) => void;
}) {
  return (
    <label className={`ajuste-voz__motor ${escolhido ? 'ajuste-voz__motor--escolhido' : ''}`}>
      <input type="radio" name={grupo} value={valor} checked={escolhido} onChange={() => aoEscolher(valor)} />
      <span className="ajuste-voz__motor-icone"><Icone nome={icone} tamanho={16} /></span>
      <span className="ajuste-voz__motor-textos">
        <strong>{titulo}</strong>
        <span>{descricao}</span>
      </span>
      <span className="ajuste-voz__motor-marca" aria-hidden />
    </label>
  );
}

interface PropsFaixa {
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  passo: number;
  legivel: string;
  aoMudar: (v: number) => void;
}

/** Controle deslizante com o valor escrito ao lado (e a parte preenchida na cor da marca). */
function Faixa({ rotulo, valor, min, max, passo, legivel, aoMudar }: PropsFaixa) {
  const fracao = (valor - min) / (max - min);
  return (
    <label className="campo ajuste-voz__faixa">
      <span>
        {rotulo} <output className="numero">{legivel}</output>
      </span>
      <input
        type="range"
        className="faixa"
        min={min}
        max={max}
        step={passo}
        value={valor}
        aria-valuetext={legivel}
        style={{ '--preenchido': `${(fracao * 100).toFixed(1)}%` } as CSSProperties}
        onChange={(e: ChangeEvent<HTMLInputElement>) => aoMudar(Number(e.target.value))}
      />
    </label>
  );
}

/** "Voz" nos Ajustes do assistente: reconhecimento (no computador ou Google), voz, velocidade e silêncio. */
export function AjusteVoz() {
  const [prefs, mudar] = usePreferenciasVoz();
  const situacao = useReconhecimentoLocal();
  const { vozes, carregando } = useVozes();
  const exemplo = useExemploDeVoz();
  const { estado: natural } = useVozNatural();
  const reconhece = suportaReconhecimento();
  const local = usarLocal(prefs, situacao.estado);
  const daFala = opcoesDaFala(prefs, natural);
  const semVozes = suportaFala() && daFala.motor !== 'piper' && !carregando && vozes.length === 0;
  const algumaNatural = natural?.instalada ?? false;

  return (
    <section className="ajuste-rag ajuste-voz" aria-labelledby="ajuste-voz-titulo">
      <div className="ajuste-rag__topo">
        <h3 id="ajuste-voz-titulo"><Icone nome="microfone" tamanho={15} /> Voz</h3>
        {!reconhece ? (
          <Selo tom="ruim" icone="alerta">Sem reconhecimento</Selo>
        ) : local ? (
          <Selo tom="bom" icone="escudo">No computador</Selo>
        ) : (
          <Selo tom="info" icone="info">Google (online)</Selo>
        )}
      </div>
      <p className="texto-3 pequeno">
        Dite na caixa de texto com o microfone (<kbd>Alt</kbd>+<kbd>M</kbd>) ou converse falando, com a resposta lida em voz alta (<kbd>Alt</kbd>+<kbd>V</kbd>).
        Estas preferências ficam só nesta janela.
      </p>

      {reconhece ? (
        <fieldset className="ajuste-voz__grupo">
          <legend>Reconhecimento da sua voz</legend>
          <div className="ajuste-voz__motores">
            <OpcaoMotor
              grupo="motor-reconhecimento"
              valor="local"
              escolhido={prefs.reconhecimento === 'local'}
              titulo="No computador (privado)"
              descricao="O Chrome transcreve aqui mesmo. Precisa do pacote de português."
              icone="escudo"
              aoEscolher={(v) => mudar({ reconhecimento: v })}
            />
            <OpcaoMotor
              grupo="motor-reconhecimento"
              valor="nuvem"
              escolhido={prefs.reconhecimento === 'nuvem'}
              titulo="Pelo Google (online)"
              descricao="O áudio vai para o Google para ser transcrito."
              icone="info"
              aoEscolher={(v) => mudar({ reconhecimento: v })}
            />
          </div>
          <SituacaoLocalVoz situacao={situacao} preferido={prefs.reconhecimento === 'local'} />
        </fieldset>
      ) : (
        <p className="ajuste-rag__erro" role="status"><Icone nome="alerta" tamanho={15} /> Este navegador não reconhece fala. O Fluxo abre no Google Chrome pelo atalho: use-o para ditar e conversar.</p>
      )}

      <fieldset className="ajuste-voz__grupo">
        <legend>Quem lê as respostas</legend>
        <div className="ajuste-voz__motores">
          <OpcaoMotor
            grupo="motor-fala"
            valor="piper"
            escolhido={prefs.motorFala === 'piper'}
            titulo="Voz natural (no computador)"
            descricao={algumaNatural ? 'Piper: fluida e expressiva, roda aqui mesmo.' : 'Piper: baixe uma voz abaixo. Até lá, lê a do navegador.'}
            icone="onda"
            aoEscolher={(v) => mudar({ motorFala: v })}
          />
          <OpcaoMotor
            grupo="motor-fala"
            valor="navegador"
            escolhido={prefs.motorFala === 'navegador'}
            titulo="Voz do navegador"
            descricao="A do sistema ou do Chrome. As vozes “Google” mandam o texto para o Google."
            icone="alto-falante"
            aoEscolher={(v) => mudar({ motorFala: v })}
          />
        </div>
      </fieldset>

      <AjusteVozNatural prefs={prefs} mudar={mudar} exemplo={exemplo} />

      <div className="ajuste-voz__grade">
        <div className="campo">
          <span>Voz do navegador {daFala.motor === 'piper' && <span className="texto-3">(reserva)</span>}</span>
          <Seletor
            rotulo="Voz do navegador"
            valor={prefs.voz ?? VOZ_AUTOMATICA}
            opcoes={opcoesDeVoz(vozes)}
            aoMudar={(v) => mudar({ voz: v || null })}
            desabilitado={vozes.length === 0}
            prefixo={<Icone nome="alto-falante" tamanho={15} />}
            vazio={carregando ? 'Carregando vozes…' : 'Nenhuma voz instalada'}
          />
        </div>
        <Faixa
          rotulo="Velocidade da fala"
          valor={prefs.velocidade}
          {...LIMITES.velocidade}
          legivel={`${decimal(prefs.velocidade, 2)}×`}
          aoMudar={(v) => mudar({ velocidade: v })}
        />
        <Faixa
          rotulo="Silêncio para enviar"
          valor={prefs.silencioMs / 1000}
          min={LIMITES.silencioMs.min / 1000}
          max={LIMITES.silencioMs.max / 1000}
          passo={LIMITES.silencioMs.passo / 1000}
          legivel={`${decimal(prefs.silencioMs / 1000, 1)} s`}
          aoMudar={(v) => mudar({ silencioMs: Math.round(v * 1000) })}
        />
      </div>

      {semVozes && (
        <p className="pequeno texto-3 ajuste-voz__sem-vozes">
          <Icone nome="info" tamanho={14} />
          <span>
            Nenhuma voz instalada no sistema. No Linux, o Chrome fala pelo <code>speech-dispatcher</code>: instale-o com uma voz em português (por exemplo,{' '}
            <code>espeak-ng</code> ou RHVoice) e reabra o Fluxo. Sem voz, as respostas do modo conversação aparecem só escritas.
          </span>
        </p>
      )}

      <div className="ajuste-voz__linha">
        <span>
          <strong>Falar as respostas no modo conversação</strong>
          <span className="pequeno texto-3">Desligado, a resposta aparece escrita e o microfone volta a ouvir logo depois.</span>
        </span>
        <Interruptor ligado={prefs.falarRespostas} aoMudar={(v) => mudar({ falarRespostas: v })} rotulo="Falar as respostas no modo conversação" />
      </div>

      <div className="ajuste-rag__acoes">
        <Botao
          pequeno
          icone={exemplo.tocando === 'exemplo' ? 'parar' : 'alto-falante'}
          onClick={() => exemplo.alternar('exemplo', daFala)}
          disabled={daFala.motor !== 'piper' && !suportaFala()}
        >
          {exemplo.tocando === 'exemplo' ? 'Parar exemplo' : 'Ouvir exemplo'}
        </Botao>
        <span className="pequeno texto-3 ajuste-voz__quem-fala">
          {daFala.motor === 'piper'
            ? `Com a voz natural ${natural?.vozes.find((v) => v.id === daFala.vozNatural)?.nome ?? ''}`.trim()
            : 'Com a voz do navegador'}
        </span>
      </div>
    </section>
  );
}
