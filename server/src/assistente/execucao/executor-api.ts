import { Logger } from '@nestjs/common';
import { isStepCount, jsonSchema, streamText, tool, type JSONSchema7, type ModelMessage, type TextStreamPart, type ToolSet } from 'ai';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { identificarArquivo } from '../anexos/tipo-arquivo';
import { descreverParaLog, explicarErroDaApi, ocultarSegredos } from '../apis/erros-api';
import type { ModeloDeLinguagem } from '../apis/fabrica-de-modelos';
import { comoObjeto, cortar } from '../cli/comum';
import type { EventoAgente, ProvedorIA } from '../cli/tipos';
import type { Ferramentas } from '../ferramentas/ferramentas';
import type { FalhaCli } from './executor-cli';

/**
 * Uma rodada de uma conta por API: chama o modelo pelo AI SDK, executa as
 * ferramentas do Fluxo direto (sem a ponte MCP: o processo é este) e traduz o
 * que chega nos mesmos `EventoAgente` do executor de CLI — quem chama não
 * sabe a diferença. Não sabe de conversa nem de banco.
 */

export interface PedidoApi {
  provedor: ProvedorIA;
  modelo: ModeloDeLinguagem;
  /** O id do modelo, para as mensagens de erro ("o modelo X não existe"). */
  idDoModelo: string;
  /** Só para apagar das mensagens de erro: nunca vai para evento nem log. */
  chave: string;
  instrucoes: string;
  /** Mensagens anteriores da conversa, como turnos de verdade. */
  historico: readonly { papel: 'usuario' | 'assistente'; texto: string }[];
  /** O turno atual, já montado por `montarPrompt` (data, anexos, modo voz). */
  turno: string;
  /** Imagens anexadas (caminhos absolutos). */
  imagens: readonly string[];
  /** null = sem ferramentas (teste de conexão). */
  ferramentas: Ferramentas | null;
  conversaId: string | null;
  tempoMaximoMs: number;
  /** Tentativas extras em erro passageiro (429, 5xx). Padrão do AI SDK: 2. */
  tentativas?: number;
  sinal: AbortSignal;
  aoEvento: (evento: EventoAgente) => void;
}

export interface ResultadoApi {
  motivo: 'normal' | 'tempo' | 'cancelado';
  duracaoMs: number;
  falha: FalhaCli | null;
}

const PREFIXO_FLUXO = 'mcp__fluxo__';
const MAXIMO_DE_PASSOS = 25;
const MENSAGENS_NO_HISTORICO = 20;
const CARACTERES_POR_MENSAGEM = 4000;
const TAMANHO_MAXIMO_IMAGEM = 5 * 1024 * 1024;
const log = new Logger('Assistente');

export async function executarApi(p: PedidoApi): Promise<ResultadoApi> {
  const inicio = Date.now();
  const prazo = AbortSignal.timeout(p.tempoMaximoMs);
  const sinal = AbortSignal.any([p.sinal, prazo]);
  const fim = (falha: FalhaCli | null): ResultadoApi => {
    const duracaoMs = Date.now() - inicio;
    if (p.sinal.aborted) return { motivo: 'cancelado', duracaoMs, falha: null };
    if (prazo.aborted) return { motivo: 'tempo', duracaoMs, falha: { codigo: 'tempo', mensagem: `A resposta passou de ${Math.round(p.tempoMaximoMs / 60_000)} minutos e foi interrompida.` } };
    return { motivo: 'normal', duracaoMs, falha };
  };
  if (sinal.aborted) return fim(null);

  const deu = new Map<string, boolean>();
  const tradutor = novoTradutor(p, deu);
  let falha: FalhaCli | null = null;
  const anotar = (erro: unknown) => {
    if (sinal.aborted) return;
    log.warn(`A ${p.provedor} (API) falhou: ${descreverParaLog(erro, p.chave)}`);
    falha ??= explicarErroDaApi(erro, { provedor: p.provedor, modelo: p.idDoModelo, chave: p.chave });
  };
  try {
    const resultado = streamText({
      model: p.modelo,
      instructions: p.instrucoes,
      messages: montarMensagens(p.historico, p.turno, lerImagens(p.imagens, p.aoEvento)),
      tools: p.ferramentas ? montarFerramentas(p.ferramentas, p.conversaId ?? '', deu) : undefined,
      stopWhen: isStepCount(MAXIMO_DE_PASSOS),
      abortSignal: sinal,
      maxRetries: p.tentativas,
      // A OpenAI guarda as respostas por padrão; aqui vai o extrato da pessoa.
      providerOptions: { openai: { store: false } },
      // O padrão do AI SDK é console.error(erro) — que levaria o corpo do pedido para o log.
      onError: () => undefined,
    });
    for await (const parte of resultado.stream) {
      if (parte.type === 'error') anotar(parte.error);
      else tradutor(parte, inicio);
    }
  } catch (e) {
    anotar(e);
  }
  return fim(falha);
}

/** Traduz as partes do stream do AI SDK em eventos do assistente. */
function novoTradutor(p: PedidoApi, deu: Map<string, boolean>) {
  let houveTexto = false;
  let terminouEmQuebra = false;
  let ferramentaDesdeOTexto = false;
  return (parte: TextStreamPart<ToolSet>, inicio: number): void => {
    switch (parte.type) {
      case 'text-delta': {
        if (!parte.text) return;
        // Texto depois de uma ferramenta é outro parágrafo, não continuação da frase anterior.
        if (houveTexto && ferramentaDesdeOTexto && !terminouEmQuebra) p.aoEvento({ tipo: 'texto', delta: '\n\n' });
        p.aoEvento({ tipo: 'texto', delta: parte.text });
        houveTexto = true;
        ferramentaDesdeOTexto = false;
        terminouEmQuebra = parte.text.endsWith('\n');
        return;
      }
      case 'tool-input-start':
        ferramentaDesdeOTexto = true;
        p.aoEvento({ tipo: 'ferramenta', id: parte.id, nome: `${PREFIXO_FLUXO}${parte.toolName}`, entrada: {} });
        return;
      case 'tool-call':
        ferramentaDesdeOTexto = true;
        p.aoEvento({ tipo: 'ferramenta', id: parte.toolCallId, nome: `${PREFIXO_FLUXO}${parte.toolName}`, entrada: comoObjeto(parte.input) ?? {} });
        return;
      case 'tool-result':
        p.aoEvento({ tipo: 'ferramenta_fim', id: parte.toolCallId, ok: deu.get(parte.toolCallId) ?? true, resultado: comoTexto(parte.output) });
        return;
      case 'tool-error':
        p.aoEvento({ tipo: 'ferramenta_fim', id: parte.toolCallId, ok: false, resultado: ocultarSegredos(cortar(mensagem(parte.error), 600), p.chave) });
        return;
      case 'finish':
        p.aoEvento({ tipo: 'uso', uso: { tokensEntrada: parte.totalUsage.inputTokens ?? null, tokensSaida: parte.totalUsage.outputTokens ?? null, duracaoMs: Date.now() - inicio } });
        return;
      default:
    }
  };
}

/**
 * As ferramentas do Fluxo como ferramentas do AI SDK. `Ferramentas.executar`
 * valida a entrada e nunca lança: erro vira texto para o modelo corrigir.
 * Se deu certo ou não fica anotado pelo id da chamada, para o passo na tela.
 */
function montarFerramentas(ferramentas: Ferramentas, conversaId: string, deu: Map<string, boolean>): ToolSet {
  return Object.fromEntries(ferramentas.lista().map((d) => [d.nome, tool({
    description: d.descricao,
    inputSchema: jsonSchema<Record<string, unknown>>(d.inputSchema as JSONSchema7),
    execute: async (entrada: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
      const r = await ferramentas.executar(d.nome, entrada, { conversaId });
      deu.set(toolCallId, r.ok);
      return r.texto;
    },
  })]));
}

/**
 * O histórico como turnos de verdade (as APIs entendem melhor que um bloco de
 * texto): os mais recentes, cortados, sem vazios. Turnos seguidos do mesmo
 * papel se juntam e a conversa sempre começa pela pessoa — a Anthropic exige.
 */
export function montarMensagens(
  historico: PedidoApi['historico'], turno: string, imagens: readonly { dados: Buffer; mime: string }[],
): ModelMessage[] {
  const turnos = [
    ...historico.slice(-MENSAGENS_NO_HISTORICO)
      .map((m) => ({ papel: m.papel, texto: cortar(m.texto.trim(), CARACTERES_POR_MENSAGEM) }))
      .filter((m) => m.texto),
    { papel: 'usuario' as const, texto: turno },
  ];
  const juntos = turnos.reduce<{ papel: 'usuario' | 'assistente'; texto: string }[]>((acc, m) => {
    const ultimo = acc.at(-1);
    if (!ultimo && m.papel === 'assistente') return acc;
    return ultimo?.papel === m.papel ? [...acc.slice(0, -1), { papel: m.papel, texto: `${ultimo.texto}\n\n${m.texto}` }] : [...acc, m];
  }, []);
  return juntos.map((m, i): ModelMessage => {
    if (m.papel === 'assistente') return { role: 'assistant', content: m.texto };
    if (i < juntos.length - 1 || !imagens.length) return { role: 'user', content: m.texto };
    return { role: 'user', content: [{ type: 'text', text: m.texto }, ...imagens.map((img) => ({ type: 'file' as const, data: img.dados, mediaType: img.mime }))] };
  });
}

/** Lê as imagens anexadas; a que não dá para mandar vira aviso, não erro. */
function lerImagens(caminhos: readonly string[], aoEvento: PedidoApi['aoEvento']): { dados: Buffer; mime: string }[] {
  return caminhos.flatMap((caminho) => {
    const nome = basename(caminho);
    try {
      if (statSync(caminho).size > TAMANHO_MAXIMO_IMAGEM) {
        aoEvento({ tipo: 'aviso', mensagem: `A imagem ${nome} passa de 5 MB e não foi enviada ao modelo.` });
        return [];
      }
      const dados = readFileSync(caminho);
      const tipo = identificarArquivo(dados, nome);
      return tipo?.tipo === 'imagem' ? [{ dados, mime: tipo.mime }] : [];
    } catch (e) {
      aoEvento({ tipo: 'aviso', mensagem: `Não consegui ler a imagem ${nome} (${(e as NodeJS.ErrnoException).code ?? 'erro'}).` });
      return [];
    }
  });
}

function comoTexto(valor: unknown): string {
  return typeof valor === 'string' ? valor : (JSON.stringify(valor) ?? '');
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
