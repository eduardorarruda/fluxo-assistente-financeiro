import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Conversa, Mensagem } from '../../../api/tipos-assistente';
import { useVozNatural } from '../../../api/voz-natural';
import type { MotorDeFala } from './fala';
import { criarMotorPiper, opcoesDaFala } from './fala-piper';
import { deveOuvir, ESTADO_INICIAL, type EstadoConversa, reduzirConversa } from './maquina-conversa';
import { useNivelMicrofone } from './nivel-microfone';
import { usePreferenciasVoz } from './preferencias-voz';
import { mensagemDeErro } from './reconhecimento';
import { criarDivisorDeFrases, type DivisorDeFrases } from './texto-fala';
import { useEscuta } from './useEscuta';

/**
 * O laço do modo conversação: ouve → (silêncio) envia com `voz: true` → acompanha
 * a resposta (que o SSE da conversa vai gravando no cache) → lê frase a frase
 * enquanto ela chega → volta a ouvir. A ordem das fases é a da máquina pura
 * (maquina-conversa.ts); aqui ficam só os efeitos.
 */

export type ResultadoEnvioVoz = { execucaoId: string; respostaId: string } | { erro: string };

export interface OpcoesConversaPorVoz {
  conversa: Conversa | undefined;
  aoEnviar: (texto: string) => Promise<ResultadoEnvioVoz>;
  aoCancelar: (execucaoId: string) => void;
  /** Para testes; no app, a voz natural (Piper) com a do navegador de reserva. */
  motor?: MotorDeFala;
}

/** Com algo provisório ainda não confirmado, espera um pouco mais antes de enviar. */
const ESPERA_EXTRA_PARCIAL_MS = 1500;
const FRASE_DE_ERRO = 'Não consegui responder agora. O motivo aparece na tela.';

interface Leitura {
  id: string;
  lido: number;
  acabou: boolean;
  divisor: DivisorDeFrases;
}

function avisoDoFim(m: Mensagem): string | null {
  if (m.situacao === 'erro') return m.erro ?? 'O assistente não conseguiu responder.';
  if (m.situacao === 'interrompida') return 'A resposta foi interrompida antes do fim.';
  return null;
}

const passoRodando = (m: Mensagem) => [...m.passos].reverse().find((p) => p.situacao === 'rodando')?.rotulo ?? null;

export function useConversaPorVoz({ conversa, aoEnviar, aoCancelar, motor: motorDado }: OpcoesConversaPorVoz) {
  const [prefs] = usePreferenciasVoz();
  const [estado, despachar] = useReducer(reduzirConversa, ESTADO_INICIAL);
  const motor = useMemo(() => motorDado ?? criarMotorPiper(), [motorDado]);
  const natural = useVozNatural();
  const microfone = useNivelMicrofone(estado.fase !== 'erro');
  const escuta = useEscuta({
    aoParcial: (texto) => despachar({ tipo: 'parcial', texto }),
    aoFinal: (texto) => despachar({ tipo: 'final', texto }),
    aoErro: (e) => despachar({ tipo: 'erro', mensagem: e.mensagem }),
  });

  const ref = useRef({ estado, prefs, escuta, conversa, aoEnviar, aoCancelar, natural: natural.estado });
  ref.current = { estado, prefs, escuta, conversa, aoEnviar, aoCancelar, natural: natural.estado };

  // ---------- preparar: abrir o microfone (pede a permissão) antes de ouvir
  useEffect(() => {
    if (estado.fase !== 'preparando') return;
    if (!escuta.suportado) return despachar({ tipo: 'erro', mensagem: mensagemDeErro('sem-suporte') });
    if (!microfone.pronto) return;
    if (microfone.erro === 'permissao') return despachar({ tipo: 'erro', mensagem: mensagemDeErro('not-allowed') });
    if (microfone.erro === 'sem-microfone') return despachar({ tipo: 'erro', mensagem: mensagemDeErro('audio-capture') });
    despachar({ tipo: 'pronto' });
  }, [estado.fase, escuta.suportado, microfone.pronto, microfone.erro]);

  const montado = useRef(false);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Abriu com uma resposta ainda chegando: ela é lida antes de ouvir. Olha uma vez só,
  // mas só quando a conversa já carregou (abrir logo depois de trocar de conversa).
  const conferiuAndamento = useRef(false);
  useEffect(() => {
    if (conferiuAndamento.current || !conversa) return;
    conferiuAndamento.current = true;
    const gerando = conversa.execucaoAtiva ? conversa.mensagens.findLast((m) => m.papel === 'assistente' && m.situacao === 'gerando') : undefined;
    if (conversa.execucaoAtiva && gerando) despachar({ tipo: 'acompanhar', execucaoId: conversa.execucaoAtiva, respostaId: gerando.id });
  }, [conversa]);

  // ---------- ouvir só quando é a vez da pessoa (nunca enquanto a voz fala)
  const querOuvir = deveOuvir(estado);
  useEffect(() => {
    if (querOuvir) ref.current.escuta.iniciar();
    else ref.current.escuta.abortar();
  }, [querOuvir]);

  // ---------- silêncio depois da fala → envia
  useEffect(() => {
    if (!deveOuvir(estado) || (!estado.fala && !estado.parcial)) return;
    const espera = prefs.silencioMs + (estado.parcial ? ESPERA_EXTRA_PARCIAL_MS : 0);
    const t = setTimeout(() => despachar({ tipo: 'enviar' }), espera);
    return () => clearTimeout(t);
    // Só o que o prazo lê: outra ação qualquer (fechar um aviso) não recomeça a contagem.
  }, [estado.fase, estado.mudo, estado.fala, estado.parcial, prefs.silencioMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- enviar (com voz: true)
  // Um envio por pergunta: o efeito pode rodar de novo (StrictMode monta duas vezes)
  // e cada envio começa uma resposta de verdade no CLI ou na API.
  const emVoo = useRef<string | null>(null);
  useEffect(() => {
    if (estado.fase !== 'enviando' || emVoo.current === estado.pergunta) return;
    const pergunta = estado.pergunta;
    emVoo.current = pergunta;
    void ref.current.aoEnviar(pergunta).then((r) => {
      if (emVoo.current === pergunta) emVoo.current = null;
      const aindaEsta = montado.current && ref.current.estado.fase === 'enviando' && ref.current.estado.pergunta === pergunta;
      if ('erro' in r) return aindaEsta && despachar({ tipo: 'falhaNoEnvio', mensagem: r.erro });
      // Interrompeu (ou fechou) enquanto enviava: a resposta que começou é cancelada (o que veio fica no chat).
      if (!aindaEsta) return ref.current.aoCancelar(r.execucaoId);
      despachar({ tipo: 'enviado', ...r });
    });
  }, [estado.fase, estado.pergunta]);

  // ---------- voz: cada frase que começa vira legenda; fila vazia, "calou"
  useEffect(() => {
    const tirarComecar = motor.aoComecar((frase) => despachar({ tipo: 'falando', frase }));
    const tirarEsvaziar = motor.aoEsvaziar(() => despachar({ tipo: 'calou' }));
    const tirarAvisar = motor.aoAvisar?.((mensagem) => despachar({ tipo: 'avisar', mensagem }));
    return () => {
      tirarComecar();
      tirarEsvaziar();
      tirarAvisar?.();
      motor.parar();
    };
  }, [motor]);

  // A voz natural carrega o modelo enquanto a pessoa fala a primeira pergunta (a primeira frase sai sem a espera).
  const vozNaturalQueFala = prefs.falarRespostas ? opcoesDaFala(prefs, natural.estado).vozNatural : null;
  const preparou = useRef<string | null>(null);
  useEffect(() => {
    if (!vozNaturalQueFala || preparou.current === vozNaturalQueFala) return;
    preparou.current = vozNaturalQueFala;
    motor.preparar?.(opcoesDaFala(ref.current.prefs, ref.current.natural));
  }, [motor, vozNaturalQueFala]);

  const dizer = useCallback(
    (frase: string) => {
      const { prefs: p, natural: n } = ref.current;
      if (p.falarRespostas) motor.falar(frase, opcoesDaFala(p, n));
      else despachar({ tipo: 'legenda', frase });
    },
    [motor],
  );

  // ---------- acompanhar a resposta (o SSE da conversa grava no cache; aqui só se lê)
  const leitura = useRef<Leitura | null>(null);
  useEffect(() => {
    const id = estado.respostaId;
    if (!id) {
      leitura.current = null;
      return;
    }
    if (leitura.current?.id !== id) leitura.current = { id, lido: 0, acabou: false, divisor: criarDivisorDeFrases() };
    const l = leitura.current;
    const m = conversa?.mensagens.find((x) => x.id === id);
    if (!m || l.acabou) return;
    // Texto menor que o já lido = a execução recomeçou a transmissão: espera passar do ponto.
    if (m.texto.length > l.lido) {
      const novo = m.texto.slice(l.lido);
      l.lido = m.texto.length;
      l.divisor.empurrar(novo).forEach(dizer);
    }
    const passo = passoRodando(m);
    if (passo !== ref.current.estado.passo) despachar({ tipo: 'passo', rotulo: passo });
    if (m.situacao === 'gerando') return;
    l.acabou = true;
    l.divisor.terminar().forEach(dizer);
    const aviso = avisoDoFim(m);
    if (m.situacao === 'erro') dizer(FRASE_DE_ERRO);
    despachar({ tipo: 'fimDaResposta', aviso, aindaFalando: ref.current.prefs.falarRespostas && motor.ocupado() });
  }, [conversa, estado.respostaId, dizer, motor]);

  // ---------- ações
  const interromper = useCallback(() => {
    motor.parar();
    const { estado: e, conversa: c } = ref.current;
    const gerando = c?.mensagens.some((m) => m.id === e.respostaId && m.situacao === 'gerando');
    if (e.execucaoId && gerando) ref.current.aoCancelar(e.execucaoId);
    despachar({ tipo: 'interromper' });
  }, [motor]);

  const alternarMudo = useCallback(() => despachar({ tipo: 'mudo', mudo: !ref.current.estado.mudo }), []);
  const tentarDeNovo = useCallback(() => despachar({ tipo: 'tentarDeNovo' }), []);
  const limparAviso = useCallback(() => despachar({ tipo: 'limparAviso' }), []);

  /** Toque na esfera (ou Espaço): interrompe, envia já, ou retoma — conforme o momento. */
  const tocar = useCallback(() => {
    const e = ref.current.estado;
    if (e.fase === 'erro') return tentarDeNovo();
    if (e.fase === 'pensando' || e.fase === 'falando' || e.fase === 'enviando') return interromper();
    if (e.fase !== 'ouvindo') return;
    if (e.mudo) return alternarMudo();
    if (e.fala || e.parcial) despachar({ tipo: 'enviar' });
  }, [interromper, alternarMudo, tentarDeNovo]);

  const nivel = useCallback(() => {
    const fase = ref.current.estado.fase;
    if (fase === 'falando') return motor.nivel();
    return fase === 'ouvindo' ? microfone.nivel() : 0;
  }, [motor, microfone]);

  return { estado, local: escuta.local, nivel, tocar, interromper, alternarMudo, tentarDeNovo, limparAviso };
}

export type ControleConversaPorVoz = ReturnType<typeof useConversaPorVoz>;
export type { EstadoConversa };
