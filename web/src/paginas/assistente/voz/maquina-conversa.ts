/**
 * O modo conversação como máquina de estados pura (sem efeitos): quem a usa
 * (useConversaPorVoz) liga e desliga o microfone, envia, assina e fala conforme
 * a fase. Assim a ordem ouvindo → enviando → pensando → falando → ouvindo fica
 * testável sem navegador.
 */

export type FaseConversa = 'preparando' | 'ouvindo' | 'enviando' | 'pensando' | 'falando' | 'erro';

export interface EstadoConversa {
  fase: FaseConversa;
  /** Microfone pausado pela pessoa (em "ouvindo", vira "Pausado"). */
  mudo: boolean;
  /** O que a pessoa já disse neste turno (resultados finais). */
  fala: string;
  /** O que ela está dizendo agora (ainda pode mudar). */
  parcial: string;
  /** A pergunta que foi enviada (fica na legenda enquanto o assistente pensa). */
  pergunta: string;
  /** A frase que a voz está lendo (ou a última dita, até a pessoa voltar a falar). */
  legenda: string;
  /** O passo de ferramenta em andamento ("Consultando resumo do mês"). */
  passo: string | null;
  execucaoId: string | null;
  respostaId: string | null;
  /** A resposta terminou de chegar (pode ainda estar sendo lida). */
  respostaAcabou: boolean;
  /** Problema que impede de continuar (microfone): mostra "Tentar de novo". */
  erro: string | null;
  /** Problema passageiro (envio, resposta com erro): aparece e a conversa segue. */
  aviso: string | null;
}

export type EventoConversa =
  | { tipo: 'pronto' }
  | { tipo: 'parcial'; texto: string }
  | { tipo: 'final'; texto: string }
  | { tipo: 'enviar' }
  | { tipo: 'enviado'; execucaoId: string; respostaId: string }
  | { tipo: 'acompanhar'; execucaoId: string; respostaId: string }
  | { tipo: 'falhaNoEnvio'; mensagem: string }
  | { tipo: 'passo'; rotulo: string | null }
  | { tipo: 'falando'; frase: string }
  | { tipo: 'legenda'; frase: string }
  | { tipo: 'calou' }
  | { tipo: 'fimDaResposta'; aviso: string | null; aindaFalando: boolean }
  | { tipo: 'interromper' }
  | { tipo: 'mudo'; mudo: boolean }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'tentarDeNovo' }
  | { tipo: 'limparAviso' }
  /** Aviso que não muda a fase (a voz natural falhou e a do navegador assumiu). */
  | { tipo: 'avisar'; mensagem: string };

export const ESTADO_INICIAL: EstadoConversa = {
  fase: 'preparando',
  mudo: false,
  fala: '',
  parcial: '',
  pergunta: '',
  legenda: '',
  passo: null,
  execucaoId: null,
  respostaId: null,
  respostaAcabou: false,
  erro: null,
  aviso: null,
};

/** Junta pedaços ditados com um espaço só, sem espaço antes de pontuação. */
export function juntarFala(antes: string, depois: string): string {
  const a = antes.trim();
  const b = depois.trim();
  if (!a) return b;
  if (!b) return a;
  return /^[,.;:!?…]/.test(b) ? `${a}${b}` : `${a} ${b}`;
}

/** Fim da resposta: volta a ouvir. A última frase fica na legenda até a pessoa falar. */
const voltarAOuvir = (e: EstadoConversa, aviso: string | null = e.aviso): EstadoConversa => ({
  ...e,
  fase: 'ouvindo',
  fala: '',
  parcial: '',
  passo: null,
  execucaoId: null,
  respostaId: null,
  respostaAcabou: false,
  aviso,
});

const respondendo = (fase: FaseConversa) => fase === 'pensando' || fase === 'falando';

export function reduzirConversa(e: EstadoConversa, ev: EventoConversa): EstadoConversa {
  switch (ev.tipo) {
    case 'pronto':
      return e.fase === 'preparando' ? { ...e, fase: 'ouvindo' } : e;
    case 'parcial':
      if (e.fase !== 'ouvindo' || e.mudo) return e;
      return { ...e, parcial: ev.texto, legenda: ev.texto ? '' : e.legenda };
    case 'final':
      return e.fase === 'ouvindo' && !e.mudo ? { ...e, fala: juntarFala(e.fala, ev.texto), parcial: '', legenda: '', aviso: null } : e;
    case 'enviar': {
      const pergunta = juntarFala(e.fala, e.parcial);
      if (e.fase !== 'ouvindo' || !pergunta) return e;
      return { ...e, fase: 'enviando', pergunta, fala: '', parcial: '', legenda: '', aviso: null };
    }
    case 'enviado':
      if (e.fase !== 'enviando') return e;
      return { ...e, fase: 'pensando', execucaoId: ev.execucaoId, respostaId: ev.respostaId, respostaAcabou: false, passo: null };
    case 'acompanhar':
      // Já havia uma resposta em andamento quando o modo abriu: ela é lida antes de ouvir.
      if (e.fase !== 'preparando' && e.fase !== 'ouvindo') return e;
      return { ...e, fase: 'pensando', execucaoId: ev.execucaoId, respostaId: ev.respostaId, respostaAcabou: false, passo: null, fala: '', parcial: '' };
    case 'falhaNoEnvio':
      // Não devolve a pergunta para "fala": o silêncio a reenviaria sozinho, em laço, se o erro persistir.
      return e.fase === 'enviando' ? voltarAOuvir(e, ev.mensagem) : e;
    case 'passo':
      return respondendo(e.fase) ? { ...e, passo: ev.rotulo } : e;
    case 'falando':
      return respondendo(e.fase) ? { ...e, fase: 'falando', legenda: ev.frase } : e;
    case 'legenda':
      // Sem voz (desligada nos ajustes): a resposta aparece escrita, e a fase continua "pensando".
      return respondendo(e.fase) ? { ...e, legenda: ev.frase } : e;
    case 'calou':
      if (e.fase !== 'falando') return e;
      return e.respostaAcabou ? voltarAOuvir(e) : { ...e, fase: 'pensando' };
    case 'fimDaResposta':
      if (!respondendo(e.fase)) return e;
      if (ev.aindaFalando) return { ...e, fase: 'falando', respostaAcabou: true, passo: null, aviso: ev.aviso };
      return voltarAOuvir(e, ev.aviso);
    case 'interromper':
      return respondendo(e.fase) || e.fase === 'enviando' ? { ...voltarAOuvir(e, null), legenda: '' } : e;
    case 'mudo':
      return { ...e, mudo: ev.mudo, parcial: ev.mudo ? '' : e.parcial };
    case 'erro':
      return { ...e, fase: 'erro', erro: ev.mensagem, parcial: '', legenda: '', passo: null };
    case 'tentarDeNovo':
      return e.fase === 'erro' ? { ...ESTADO_INICIAL, mudo: false } : e;
    case 'limparAviso':
      return e.aviso ? { ...e, aviso: null } : e;
    case 'avisar':
      return { ...e, aviso: ev.mensagem };
  }
}

/** O microfone deve estar escutando agora? (Nunca enquanto a voz fala: ela ouviria a si mesma.) */
export const deveOuvir = (e: EstadoConversa) => e.fase === 'ouvindo' && !e.mudo;

export function rotuloDaFase(e: EstadoConversa): string {
  switch (e.fase) {
    case 'preparando':
      return 'Preparando o microfone…';
    case 'ouvindo':
      return e.mudo ? 'Pausado' : 'Ouvindo…';
    case 'enviando':
      return 'Enviando…';
    case 'pensando':
      return 'Pensando…';
    case 'falando':
      return 'Falando…';
    case 'erro':
      return 'Microfone indisponível';
  }
}
