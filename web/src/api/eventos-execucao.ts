import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { FERRAMENTAS_DE_ACAO, releAcoes } from './acoes-assistente';
import { CHAVES, mudarConversaNoCache } from './assistente';
import type { Conversa, EventoExecucao, Mensagem, PassoFerramenta } from './tipos-assistente';

// ---------- leitor de quadros SSE (puro)

export interface QuadroSse {
  id: number | null;
  dados: string;
}

/**
 * Lê `text/event-stream` em pedaços arbitrários: um quadro pode vir partido em
 * dois pedaços, e um pedaço pode trazer vários quadros. Linhas que começam com
 * `:` são comentários (o servidor manda como batimento) e são ignoradas.
 */
export function criarLeitorSse(): { empurrar: (pedaco: string) => QuadroSse[] } {
  let resto = '';
  return {
    empurrar(pedaco) {
      let texto = resto + pedaco;
      // Um \r no fim pode ser metade de um \r\n: espera o próximo pedaço.
      const crPendente = texto.endsWith('\r');
      if (crPendente) texto = texto.slice(0, -1);
      texto = texto.replace(/\r\n?/g, '\n');
      const quadros: QuadroSse[] = [];
      let fim = texto.indexOf('\n\n');
      while (fim !== -1) {
        const quadro = interpretarBloco(texto.slice(0, fim));
        if (quadro) quadros.push(quadro);
        texto = texto.slice(fim + 2);
        fim = texto.indexOf('\n\n');
      }
      resto = crPendente ? `${texto}\r` : texto;
      return quadros;
    },
  };
}

function interpretarBloco(bloco: string): QuadroSse | null {
  const dados: string[] = [];
  let id: number | null = null;
  for (const linha of bloco.split('\n')) {
    if (linha === '' || linha.startsWith(':')) continue;
    const doisPontos = linha.indexOf(':');
    const campo = doisPontos === -1 ? linha : linha.slice(0, doisPontos);
    let valor = doisPontos === -1 ? '' : linha.slice(doisPontos + 1);
    if (valor.startsWith(' ')) valor = valor.slice(1);
    if (campo === 'data') dados.push(valor);
    else if (campo === 'id' && /^\d+$/.test(valor)) id = Number(valor);
  }
  return dados.length ? { id, dados: dados.join('\n') } : null;
}

/** JSON do quadro → evento conhecido; qualquer outra coisa é ignorada. */
export function lerEvento(dados: string): EventoExecucao | null {
  let valor: unknown;
  try {
    valor = JSON.parse(dados);
  } catch {
    return null;
  }
  if (!valor || typeof valor !== 'object') return null;
  const e = valor as Record<string, unknown>;
  if (e.tipo === 'texto' && typeof e.delta === 'string') return { tipo: 'texto', delta: e.delta };
  if (e.tipo === 'passo' && e.passo && typeof e.passo === 'object') return { tipo: 'passo', passo: e.passo as PassoFerramenta };
  if (e.tipo === 'fim' && e.mensagem && typeof e.mensagem === 'object') return { tipo: 'fim', mensagem: e.mensagem as Mensagem };
  return null;
}

// ---------- aplicar eventos à conversa (puro, imutável)

function indiceGerando(mensagens: Mensagem[]): number {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    if (m && m.papel === 'assistente' && m.situacao === 'gerando') return i;
  }
  return -1;
}

function mudarGerando(c: Conversa, mudar: (m: Mensagem) => Mensagem): Conversa {
  const i = indiceGerando(c.mensagens);
  if (i === -1) return c;
  return { ...c, mensagens: c.mensagens.map((m, j) => (j === i ? mudar(m) : m)) };
}

function encaixarPasso(passos: PassoFerramenta[], passo: PassoFerramenta): PassoFerramenta[] {
  return passos.some((p) => p.id === passo.id) ? passos.map((p) => (p.id === passo.id ? passo : p)) : [...passos, passo];
}

/** Zera o que já veio da mensagem em geração: o servidor vai repetir tudo desde o começo. */
export const recomecarGeracao = (c: Conversa): Conversa => mudarGerando(c, (m) => ({ ...m, texto: '', passos: [] }));

export function aplicarEvento(c: Conversa, evento: EventoExecucao): Conversa {
  if (evento.tipo === 'texto') return mudarGerando(c, (m) => ({ ...m, texto: m.texto + evento.delta }));
  if (evento.tipo === 'passo') return mudarGerando(c, (m) => ({ ...m, passos: encaixarPasso(m.passos, evento.passo) }));
  const final = evento.mensagem;
  const alvo = c.mensagens.some((m) => m.id === final.id) ? c.mensagens.findIndex((m) => m.id === final.id) : indiceGerando(c.mensagens);
  const mensagens = alvo === -1 ? [...c.mensagens, final] : c.mensagens.map((m, j) => (j === alvo ? final : m));
  return { ...c, mensagens, execucaoAtiva: null, gerando: false };
}

// ---------- assinatura com reconexão

export type FimAssinatura = 'fim' | 'abortado' | 'perdido';

export interface OpcoesAssinatura {
  execucaoId: string;
  sinal: AbortSignal;
  /** `recomecar` = o primeiro evento é o início da execução: o que estava na tela deve ser trocado. */
  aoEvento: (evento: EventoExecucao, recomecar: boolean) => void;
  esperar?: (ms: number, sinal: AbortSignal) => Promise<void>;
  maxTentativas?: number;
}

const ESPERA_BASE_MS = 500;
const ESPERA_MAX_MS = 8000;
const TENTATIVAS_PADRAO = 8;

function esperarPadrao(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    const t = setTimeout(resolver, ms);
    sinal.addEventListener('abort', () => {
      clearTimeout(t);
      resolver();
    }, { once: true });
  });
}

/** Status que não melhoram tentando de novo: a execução acabou ou a sessão caiu. */
const DEFINITIVOS = new Set([400, 401, 403, 404, 410]);

/**
 * Assina os eventos de uma execução. Se a conexão cai antes do `fim`, volta com
 * `desde=<último id>` (espera crescente). Termina com 'fim', 'abortado' (saiu da
 * tela) ou 'perdido' (a execução não existe mais — quem chama recarrega a conversa).
 */
export async function assinarExecucao(op: OpcoesAssinatura): Promise<FimAssinatura> {
  const { execucaoId, sinal, aoEvento, esperar = esperarPadrao, maxTentativas = TENTATIVAS_PADRAO } = op;
  let ultimo = 0;
  let primeiro = true;
  let falhas = 0;
  while (!sinal.aborted) {
    try {
      const resposta = await fetch(`/api/assistente/execucoes/${encodeURIComponent(execucaoId)}/eventos?desde=${ultimo}`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream' },
        signal: sinal,
      });
      if (DEFINITIVOS.has(resposta.status)) return 'perdido';
      if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status}`);
      const leitor = resposta.body.getReader();
      const decodificador = new TextDecoder();
      const sse = criarLeitorSse();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        for (const quadro of sse.empurrar(decodificador.decode(value, { stream: true }))) {
          // Uma leitura já resolvida pode chegar depois do abort: não vaza para a conversa seguinte.
          if (sinal.aborted) return 'abortado';
          if (quadro.id !== null) {
            if (quadro.id <= ultimo) continue;
            ultimo = quadro.id;
          }
          const evento = lerEvento(quadro.dados);
          if (!evento) continue;
          falhas = 0;
          aoEvento(evento, primeiro && (quadro.id === null || quadro.id <= 1));
          primeiro = false;
          if (evento.tipo === 'fim') return 'fim';
        }
      }
    } catch {
      if (sinal.aborted) return 'abortado';
    }
    falhas += 1;
    if (falhas > maxTentativas) return 'perdido';
    await esperar(Math.min(ESPERA_MAX_MS, ESPERA_BASE_MS * 2 ** (falhas - 1)), sinal);
  }
  return 'abortado';
}

/** Assina a execução ativa da conversa e aplica cada evento no cache; para ao sair ou trocar de conversa. */
export function useEventosExecucao(conversaId: string | undefined, execucaoId: string | null | undefined): void {
  const cliente = useQueryClient();
  useEffect(() => {
    if (!conversaId || !execucaoId) return;
    const controle = new AbortController();
    const aoEvento = (evento: EventoExecucao, recomecar: boolean) => {
      mudarConversaNoCache(cliente, conversaId, (c) => aplicarEvento(recomecar ? recomecarGeracao(c) : c, evento));
      // Ferramenta de ação terminou: o cartão (proposta ou "feito") aparece já, e as telas releem o que mudou.
      if (evento.tipo === 'passo' && evento.passo.situacao !== 'rodando' && FERRAMENTAS_DE_ACAO.has(evento.passo.nome)) {
        releAcoes(cliente, conversaId, evento.passo.situacao === 'ok');
      }
    };
    void assinarExecucao({ execucaoId, sinal: controle.signal, aoEvento }).then((fim) => {
      if (fim === 'abortado') return;
      void cliente.invalidateQueries({ queryKey: CHAVES.listas });
      void cliente.invalidateQueries({ queryKey: CHAVES.conversa(conversaId) });
      releAcoes(cliente, conversaId, false);
    });
    return () => controle.abort();
  }, [cliente, conversaId, execucaoId]);
}
