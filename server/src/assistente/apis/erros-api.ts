import { cortar } from '../cli/comum';
import type { ProvedorIA } from '../cli/tipos';
import type { FalhaCli } from '../execucao/executor-cli';
import { PROVEDORES_API } from './provedores-api';

/**
 * Erros das APIs viram mensagem para a pessoa. Os erros do AI SDK carregam o
 * corpo do pedido (`requestBodyValues`: o extrato, as mensagens) e os
 * cabeçalhos da resposta: nada disso sai daqui. Só o status e a mensagem do
 * provedor, cortada e sem nada com cara de chave — a OpenAI, por exemplo,
 * repete parte da chave recusada na mensagem.
 */

const LIMITE_MENSAGEM = 300;
const PROFUNDIDADE_MAXIMA = 5;

/** Formatos de chave conhecidos (OpenAI, Anthropic, Google), para apagar mesmo que não seja a chave inteira. */
const PARECE_CHAVE = /\b(?:sk-[A-Za-z0-9_*.-]{6,}|AIza[A-Za-z0-9_-]{10,})/g;
const CREDITOS = /credit balance|insufficient_quota|exceeded your current quota|billing/i;

export interface ContextoDoErro {
  provedor: ProvedorIA;
  modelo: string;
  /** Só para apagar das mensagens. */
  chave: string;
}

interface ErroComStatus {
  statusCode: number;
  message: string;
}

export function explicarErroDaApi(erro: unknown, ctx: ContextoDoErro): FalhaCli {
  const nome = PROVEDORES_API[ctx.provedor].nome;
  const http = comStatus(erro);
  if (!http) {
    const rede = motivoDeRede(erro);
    if (rede) return { codigo: 'desconhecido', mensagem: `Não consegui falar com a ${nome}: ${ocultarSegredos(rede, ctx.chave)}.` };
    return { codigo: 'desconhecido', mensagem: `A ${nome} falhou: ${limpar(mensagemDe(erro), ctx.chave) || 'erro desconhecido'}` };
  }
  const { statusCode: status, message } = http;
  if (status === 401 || status === 403) {
    return { codigo: 'autenticacao', mensagem: 'A chave da API foi recusada (inválida, revogada ou sem permissão). Troque a chave nos Ajustes.' };
  }
  if (status === 429 || CREDITOS.test(message)) {
    return {
      codigo: 'limite',
      mensagem: `A API recusou por limite de uso ou falta de créditos. Espere um pouco ou confira o saldo e os limites da sua conta (${PROVEDORES_API[ctx.provedor].ondeCriarChave.replace(/^https:\/\//, '').split('/')[0]}).`,
    };
  }
  if (status === 404) return { codigo: 'desconhecido', mensagem: `O modelo “${ctx.modelo}” não existe nesta API (ou a sua chave não tem acesso).` };
  if (status >= 500) return { codigo: 'desconhecido', mensagem: `A ${nome} está com problema agora (código ${status}). Tente de novo em instantes.` };
  const detalhe = limpar(message, ctx.chave);
  return { codigo: 'desconhecido', mensagem: `A ${nome} recusou o pedido (código ${status})${detalhe ? `: ${detalhe}` : '.'}` };
}

/** O que vai para o log: status e mensagem limpa. Nunca o objeto do erro (que leva o corpo do pedido). */
export function descreverParaLog(erro: unknown, chave: string): string {
  const http = comStatus(erro);
  if (http) return `HTTP ${http.statusCode}: ${limpar(http.message, chave)}`;
  return limpar(motivoDeRede(erro) ?? mensagemDe(erro), chave) || 'erro desconhecido';
}

export function ocultarSegredos(texto: string, chave: string): string {
  const semChave = chave ? texto.split(chave).join('[chave]') : texto;
  return semChave.replace(PARECE_CHAVE, '[chave]');
}

function limpar(texto: string, chave: string): string {
  return cortar(ocultarSegredos(texto.replace(/\s+/g, ' ').trim(), chave), LIMITE_MENSAGEM);
}

/** Procura, no erro e nas causas (RetryError → último erro), quem tem status HTTP. */
function comStatus(erro: unknown): ErroComStatus | null {
  for (const e of cadeia(erro)) {
    const status = (e as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return { statusCode: status, message: mensagemDe(e) };
  }
  return null;
}

/** Falha de rede (fetch failed): o código do sistema (ENOTFOUND, ECONNREFUSED…) ou a mensagem da causa. */
function motivoDeRede(erro: unknown): string | null {
  for (const e of cadeia(erro)) {
    const codigo = (e as { code?: unknown }).code;
    if (typeof codigo === 'string' && /^E[A-Z_]+$|^UND_ERR/.test(codigo)) return codigo;
  }
  const raiz = cadeia(erro).find((e) => e instanceof TypeError && /fetch failed|network/i.test(e.message));
  return raiz ? mensagemDe((raiz as Error).cause ?? raiz) : null;
}

function cadeia(erro: unknown): object[] {
  const lista: object[] = [];
  let atual: unknown = erro;
  while (atual && typeof atual === 'object' && lista.length < PROFUNDIDADE_MAXIMA && !lista.includes(atual)) {
    lista.push(atual);
    const ultimo = (atual as { lastError?: unknown }).lastError;
    atual = ultimo ?? (atual as { cause?: unknown }).cause;
  }
  return lista;
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return typeof erro === 'string' ? erro : '';
}
