import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * A ponte MCP do Fluxo. Os CLIs (Claude, Gemini, Codex) a iniciam como
 * servidor MCP por stdio; ela não sabe nada de finanças — só repassa cada
 * chamada para a API local do Fluxo com o token desta execução, que vale
 * apenas para as ferramentas do assistente e morre quando a resposta termina.
 * Quem decide o que cada ferramenta pode fazer é o servidor (ações grandes só
 * viram proposta; aprovar é da pessoa, pela tela ou pelo "sim" dela).
 *
 * Roda como processo à parte: `node dist/assistente/mcp/ponte.js`, com
 * FLUXO_PONTE_URL e FLUXO_PONTE_ACESSO no ambiente.
 */

export interface ConfigPonte {
  url: string;
  acesso: string;
  buscar?: typeof fetch;
  tempoMs?: number;
}

interface FerramentaRemota {
  nome: string;
  descricao: string;
  inputSchema: { type: 'object'; [chave: string]: unknown };
  /** 'leitura' | 'escrita' | 'destrutiva'; ausente (Fluxo antigo) = leitura. */
  efeito?: string;
}

/**
 * Anotações MCP de cada ferramenta. Só leitura: o Codex libera sem pedir e
 * nenhum CLI trata como algo que muda o mundo. Escrita: `readOnlyHint: false`
 * (os três CLIs liberam mesmo assim, pela configuração do servidor "fluxo" —
 * ver cli/*.ts); `destructiveHint` só quando muda ou apaga o que já existe.
 */
export function anotacoes(efeito: string | undefined) {
  const leitura = efeito === undefined || efeito === 'leitura';
  return { readOnlyHint: leitura, destructiveHint: efeito === 'destrutiva', idempotentHint: leitura, openWorldHint: false };
}

const TEMPO_PADRAO_MS = 60_000;
/** Gerar imagem espera o Gemini (até 90 s por tentativa, com uma segunda tentativa no endpoint clássico). */
const TEMPO_IMAGEM_MS = 190_000;
const tempoDa = (c: ConfigPonte, nome: string) => c.tempoMs ?? (nome === 'gerar_imagem' ? TEMPO_IMAGEM_MS : TEMPO_PADRAO_MS);
const CAMINHO = '/api/assistente/ferramentas';

/** Só a API local do próprio Fluxo: o token nunca sai desta máquina. */
export function urlPermitida(bruta: string): boolean {
  try {
    const url = new URL(bruta);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === CAMINHO;
  } catch {
    return false;
  }
}

export function criarPonte(c: ConfigPonte): Server {
  const servidor = new Server(
    { name: 'fluxo', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Dados financeiros reais da pessoa (contas, cartão, metas, anexos). Ler é livre; mudar algo só quando a pessoa pede: ' +
        'ações pequenas rodam na hora (com Desfazer), as grandes viram proposta que ela aprova.',
    },
  );
  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await listar(c)).map((f) => ({
      name: f.nome,
      description: f.descricao,
      inputSchema: f.inputSchema,
      annotations: anotacoes(f.efeito),
    })),
  }));
  servidor.setRequestHandler(CallToolRequestSchema, async (pedido) => {
    const r = await chamar(c, pedido.params.name, pedido.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: r.texto }], isError: !r.ok };
  });
  return servidor;
}

function cabecalhos(c: ConfigPonte): Record<string, string> {
  return { 'x-fluxo-ponte': c.acesso, 'X-Fluxo': '1', 'Content-Type': 'application/json' };
}

async function listar(c: ConfigPonte): Promise<FerramentaRemota[]> {
  const buscar = c.buscar ?? fetch;
  const resposta = await buscar(c.url, { headers: cabecalhos(c), signal: AbortSignal.timeout(c.tempoMs ?? TEMPO_PADRAO_MS) });
  if (!resposta.ok) throw new Error(`O Fluxo recusou a lista de ferramentas (${resposta.status}).`);
  return (await resposta.json()) as FerramentaRemota[];
}

async function chamar(c: ConfigPonte, nome: string, entrada: unknown): Promise<{ ok: boolean; texto: string }> {
  const buscar = c.buscar ?? fetch;
  try {
    const resposta = await buscar(`${c.url}/${encodeURIComponent(nome)}`, {
      method: 'POST',
      headers: cabecalhos(c),
      body: JSON.stringify({ entrada }),
      signal: AbortSignal.timeout(tempoDa(c, nome)),
    });
    if (!resposta.ok) return { ok: false, texto: `O Fluxo recusou a chamada (${resposta.status}).` };
    const corpo = (await resposta.json()) as { ok?: unknown; texto?: unknown };
    return { ok: corpo.ok === true, texto: typeof corpo.texto === 'string' ? corpo.texto : '' };
  } catch (e) {
    return { ok: false, texto: `Não consegui falar com o Fluxo: ${(e as Error).message}` };
  }
}

async function principal(): Promise<void> {
  const url = process.env.FLUXO_PONTE_URL ?? '';
  const acesso = process.env.FLUXO_PONTE_ACESSO ?? '';
  if (!urlPermitida(url) || !acesso) {
    process.stderr.write('Ponte do Fluxo: FLUXO_PONTE_URL/FLUXO_PONTE_ACESSO ausentes ou inválidos.\n');
    process.exit(2);
  }
  await criarPonte({ url, acesso }).connect(new StdioServerTransport());
}

if (require.main === module) void principal();
