import { AnimatePresence, motion } from 'motion/react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import type { Conversa } from '../../../api/tipos-assistente';
import { Seletor } from '../../../componentes/Seletor';
import { Botao } from '../../../componentes/ui';
import { Icone } from '../../../icones/Icone';
import { PropostaNaVoz } from '../acoes/PropostaNaVoz';
import { useVozes } from './fala';
import { juntarFala, rotuloDaFase, type EstadoConversa } from './maquina-conversa';
import { useVozNatural } from '../../../api/voz-natural';
import { opcoesDaFala } from './fala-piper';
import { mudancaDaVoz, opcoesDeVozComNaturais, valorDaVoz } from './opcoes-voz';
import { type ModoOrbe, Orbe } from './Orbe';
import { usePreferenciasVoz } from './preferencias-voz';
import { type ResultadoEnvioVoz, useConversaPorVoz } from './useConversaPorVoz';

export interface PropsModoConversa {
  conversa: Conversa | undefined;
  /** "Claude pessoal · sonnet" — quem vai responder. */
  quemResponde: string | null;
  aoEnviar: (texto: string) => Promise<ResultadoEnvioVoz>;
  aoCancelar: (execucaoId: string) => void;
  aoFechar: () => void;
}

const FOCAVEIS = 'button:not(:disabled), [tabindex]:not([tabindex="-1"])';

function modoDoOrbe(e: EstadoConversa): ModoOrbe {
  if (e.fase === 'ouvindo') return e.mudo ? 'pausado' : 'ouvindo';
  if (e.fase === 'enviando') return 'pensando';
  return e.fase;
}

/** O que tocar na esfera faz agora (vira o nome acessível do botão). */
function acaoDoToque(e: EstadoConversa): string {
  if (e.fase === 'erro') return 'Tentar de novo';
  if (e.fase === 'pensando' || e.fase === 'falando' || e.fase === 'enviando') return 'Interromper e falar';
  if (e.fase === 'ouvindo' && e.mudo) return 'Ligar o microfone';
  if (e.fase === 'ouvindo' && (e.fala || e.parcial)) return 'Enviar agora';
  return 'Esfera do modo conversação';
}

function dicaDaFase(e: EstadoConversa): string {
  if (e.fase === 'falando' || e.fase === 'pensando') return 'Toque na esfera ou aperte Espaço para interromper';
  if (e.fase === 'ouvindo' && e.mudo) return 'Microfone pausado — toque na esfera para voltar a ouvir';
  if (e.fase === 'ouvindo' && (e.fala || e.parcial)) return 'Pare de falar para enviar, ou toque na esfera';
  if (e.fase === 'ouvindo') return 'Pode falar. Esc encerra';
  return '';
}

function Legendas({ estado }: { estado: EstadoConversa }) {
  const ouvindo = estado.fase === 'ouvindo';
  const pessoa = ouvindo ? estado.fala : estado.fase === 'enviando' || estado.fase === 'pensando' ? estado.pergunta : '';
  const parcial = ouvindo ? estado.parcial : '';
  const assistente = estado.legenda;
  return (
    <div className="modo-voz__legendas">
      <p className="modo-voz__legenda modo-voz__legenda--pessoa" aria-live="polite">
        {(pessoa || parcial) && (
          <>
            <span className="modo-voz__oculto">Você: </span>
            {pessoa}
            {parcial && <span className="modo-voz__provisorio">{pessoa ? ' ' : ''}{parcial}</span>}
          </>
        )}
      </p>
      <AnimatePresence mode="popLayout" initial={false}>
        {assistente && (
          <motion.p
            key={assistente}
            className="modo-voz__legenda modo-voz__legenda--assistente"
            aria-live="polite"
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: estado.fase === 'ouvindo' ? 0.55 : 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="modo-voz__oculto">Assistente: </span>
            {assistente}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function BotaoRedondo({ icone, rotulo, onClick, desabilitado, pressionado, perigo }: {
  icone: string; rotulo: string; onClick: () => void; desabilitado?: boolean; pressionado?: boolean; perigo?: boolean;
}) {
  return (
    <button
      type="button"
      className={`modo-voz__botao ${perigo ? 'modo-voz__botao--perigo' : ''} ${pressionado ? 'modo-voz__botao--ativo' : ''}`}
      onClick={onClick}
      disabled={desabilitado}
      aria-pressed={pressionado}
      aria-label={rotulo}
      title={rotulo}
    >
      <Icone nome={icone} tamanho={20} traco={2} />
    </button>
  );
}

/**
 * O modo conversação: cobre a conversa, com a esfera no meio, o estado embaixo
 * dela, as legendas e os controles. As mensagens vão pela API normal (com
 * `voz: true`), então ao fechar o chat já mostra tudo o que foi dito.
 */
export function ModoConversa({ conversa, quemResponde, aoEnviar, aoCancelar, aoFechar }: PropsModoConversa) {
  const voz = useConversaPorVoz({ conversa, aoEnviar, aoCancelar });
  const { estado } = voz;
  const [prefs, mudarPrefs] = usePreferenciasVoz();
  const { vozes, carregando } = useVozes();
  const natural = useVozNatural();
  const falaNatural = opcoesDaFala(prefs, natural.estado).motor === 'piper';
  const opcoesVoz = opcoesDeVozComNaturais(vozes, natural.estado?.vozes ?? []);
  const caixa = useRef<HTMLDivElement>(null);
  const orbe = useRef<HTMLButtonElement>(null);
  const respondendo = estado.fase === 'pensando' || estado.fase === 'falando' || estado.fase === 'enviando';
  const semVozes = prefs.falarRespostas && !falaNatural && !carregando && vozes.length === 0;

  // Foco entra na esfera e volta para quem abriu.
  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    orbe.current?.focus();
    return () => antes?.focus?.();
  }, []);

  useEffect(() => {
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        aoFechar();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aoFechar]);

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const alvo = e.target as HTMLElement;
    // Espaço na esfera (ou fora de qualquer controle) = tocar. Tratado aqui, e não pelo clique nativo do botão.
    if (e.key === ' ' && (alvo === orbe.current || !alvo.closest('button, [role="combobox"], input'))) {
      e.preventDefault();
      voz.tocar();
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey && !e.metaKey && !alvo.closest('[role="combobox"], input')) {
      e.preventDefault();
      voz.alternarMudo();
      return;
    }
    if (e.key !== 'Tab' || !caixa.current) return;
    const focaveis = Array.from(caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    const primeiro = focaveis[0];
    const ultimo = focaveis.at(-1);
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo?.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro?.focus();
    }
  };

  const rotulo = rotuloDaFase(estado);
  const dica = dicaDaFase(estado);
  const titulo = estado.fase === 'ouvindo' && (estado.fala || estado.parcial) ? juntarFala(estado.fala, estado.parcial) : null;

  return (
    <motion.div
      ref={caixa}
      className="modo-voz"
      role="dialog"
      aria-modal="true"
      aria-label="Conversa por voz"
      onKeyDown={aoTeclar}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="modo-voz__fundo" aria-hidden />
      <header className="modo-voz__topo">
        <span className="modo-voz__titulo"><Icone nome="onda" tamanho={16} traco={2} /> Conversa por voz</span>
        {quemResponde && <span className="modo-voz__quem" title="Quem responde nesta conversa">{quemResponde}</span>}
        <span
          className={`modo-voz__motor ${voz.local ? 'modo-voz__motor--local' : ''}`}
          title={voz.local ? 'A sua voz é transcrita neste computador; nada vai para fora.' : 'A sua voz vai para o Google para ser transcrita. Dá para mudar em Ajustes → Assistente de IA → Voz.'}
        >
          <Icone nome={voz.local ? 'escudo' : 'info'} tamanho={13} />
          {voz.local ? 'No computador' : 'Google (online)'}
        </span>
      </header>

      <motion.div className="modo-voz__centro" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
        <button
          ref={orbe}
          type="button"
          className="modo-voz__orbe"
          onClick={voz.tocar}
          onKeyUp={(e) => e.key === ' ' && e.preventDefault()}
          aria-label={acaoDoToque(estado)}
          title={titulo ?? undefined}
        >
          <Orbe modo={modoDoOrbe(estado)} nivel={voz.nivel} rotulo={rotulo} />
        </button>
        <div className="modo-voz__estado" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.strong key={rotulo} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {rotulo}
            </motion.strong>
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {estado.passo && (
              <motion.span key={estado.passo} className="modo-voz__passo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <span className="modo-voz__passo-ponto" aria-hidden />
                {estado.passo}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {dica && <p className="modo-voz__dica">{dica}</p>}
      </motion.div>

      <PropostaNaVoz conversaId={conversa?.id} />
      <Legendas estado={estado} />

      <div className="modo-voz__avisos">
        {estado.erro && (
          <div className="modo-voz__erro" role="alert">
            <Icone nome="alerta" tamanho={16} />
            <span>{estado.erro}</span>
            <Botao pequeno icone="sincronizar" onClick={voz.tentarDeNovo}>Tentar de novo</Botao>
          </div>
        )}
        {estado.aviso && (
          <p className="modo-voz__aviso" role="status">
            <Icone nome="alerta" tamanho={14} />
            <span>{estado.aviso}</span>
            <button type="button" onClick={voz.limparAviso} aria-label="Fechar aviso"><Icone nome="fechar" tamanho={12} traco={2.2} /></button>
          </p>
        )}
        {semVozes && (
          <p className="modo-voz__aviso modo-voz__aviso--neutro" role="status">
            <Icone nome="info" tamanho={14} />
            <span>Nenhuma voz para ler as respostas: elas aparecem só escritas. Baixe uma voz natural em Ajustes → Assistente de IA → Voz.</span>
          </p>
        )}
      </div>

      <footer className="modo-voz__controles">
        <BotaoRedondo
          icone={estado.mudo ? 'microfone-mudo' : 'microfone'}
          rotulo={estado.mudo ? 'Ligar o microfone (M)' : 'Pausar o microfone (M)'}
          pressionado={estado.mudo}
          onClick={voz.alternarMudo}
          desabilitado={estado.fase === 'erro'}
        />
        <BotaoRedondo icone="parar" rotulo="Parar a resposta" onClick={voz.interromper} desabilitado={!respondendo} />
        <Seletor
          variante="pilula"
          rotulo="Voz do assistente"
          className="modo-voz__seletor"
          prefixo={<Icone nome="alto-falante" tamanho={15} />}
          valor={valorDaVoz(prefs, natural.estado)}
          opcoes={opcoesVoz}
          aoMudar={(v) => mudarPrefs(mudancaDaVoz(v))}
          desabilitado={opcoesVoz.length <= 1 && vozes.length === 0}
          alinhar="fim"
          titulo={opcoesVoz.length > 1 || vozes.length ? 'Escolher a voz do assistente' : 'Nenhuma voz instalada'}
        />
        <BotaoRedondo icone="fechar" rotulo="Encerrar a conversa por voz (Esc)" onClick={aoFechar} perigo />
      </footer>
    </motion.div>
  );
}
