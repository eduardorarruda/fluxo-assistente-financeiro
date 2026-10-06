import type {
  Anexo, ConfigAssistente, ContaIA, Conversa, EstadoRag, Mensagem, PassoFerramenta, ProvedorInfo, ResumoConversa,
} from '../../api/tipos-assistente';

/** Construtores das respostas do /api/assistente, no formato exato do contrato (docs/ASSISTENTE.md, v2 com contas). */

/** Catálogos fixos das APIs (o servidor manda em `ProvedorInfo.api`). */
export const MODELOS_API = {
  claude: [
    { id: 'claude-sonnet-4-5', nome: 'Sonnet 4.5', descricao: 'Equilibrado', principal: true },
    { id: 'claude-opus-4-1', nome: 'Opus 4.1', descricao: 'O mais capaz', principal: true },
    { id: 'claude-haiku-4-5', nome: 'Haiku 4.5', descricao: 'Rápido e barato' },
  ],
  gemini: [{ id: 'gemini-2.5-pro', nome: '2.5 Pro', descricao: 'Estável', principal: true }],
  codex: [{ id: 'gpt-5', nome: 'GPT-5', descricao: 'O principal', principal: true }],
};

export const PROVEDORES: ProvedorInfo[] = [
  {
    provedor: 'claude', nome: 'Claude Code', variavelDeConta: 'CLAUDE_CONFIG_DIR', modelosSugeridos: ['sonnet', 'opus'],
    modelos: [{ id: 'sonnet', nome: 'sonnet', descricao: 'Equilibrado', principal: true }, { id: 'opus', nome: 'opus', descricao: 'O mais capaz', principal: true }],
    comoInstalar: 'npm i -g @anthropic-ai/claude-code',
    api: { nome: 'API da Anthropic', ondeCriarChave: 'https://console.anthropic.com/settings/keys', modelos: MODELOS_API.claude },
  },
  {
    provedor: 'gemini', nome: 'Gemini CLI', variavelDeConta: 'GEMINI_CLI_HOME', modelosSugeridos: ['gemini-2.5-pro'],
    modelos: [{ id: 'gemini-2.5-pro', nome: '2.5 Pro', descricao: 'Estável', principal: true }], comoInstalar: 'npm i -g @google/gemini-cli',
    api: { nome: 'API do Gemini', ondeCriarChave: 'https://aistudio.google.com/apikey', modelos: MODELOS_API.gemini },
  },
  {
    provedor: 'codex', nome: 'Codex CLI', variavelDeConta: 'CODEX_HOME', modelosSugeridos: [], modelos: [], comoInstalar: 'npm i -g @openai/codex',
    api: { nome: 'API da OpenAI', ondeCriarChave: 'https://platform.openai.com/api-keys', modelos: MODELOS_API.codex },
  },
];

export function conta(p: Partial<ContaIA> = {}): ContaIA {
  return {
    id: 'claude', tipo: 'cli', provedor: 'claude', nome: 'Claude pessoal', ativo: true, caminho: null, modelo: null, pastaLogin: null,
    caminhoDetectado: '/usr/bin/claude', instalado: true, versao: '2.1.0', comoEntrar: 'claude /login', chaveFinal: null, ...p,
  };
}

/** Conta de API pronta: sem caminho, pasta, versão nem comando; `instalado` = a chave existe. */
export function contaApi(p: Partial<ContaIA> = {}): ContaIA {
  return {
    id: 'api-1', tipo: 'api', provedor: 'claude', nome: 'Claude (API)', ativo: true, caminho: null, modelo: null, pastaLogin: null,
    caminhoDetectado: null, instalado: true, versao: null, comoEntrar: '', chaveFinal: '…AbCd', ...p,
  };
}

/** Chave falsa com o formato aceito (nunca use uma de verdade nos testes). */
export const CHAVE_FALSA = 'sk-ant-teste-0000000000000000000000';

export function rag(p: Partial<EstadoRag> = {}): EstadoRag {
  return {
    ativo: false, preparando: false, progresso: null, etapa: null, erro: null, modelo: 'Xenova/multilingual-e5-small',
    movimentosIndexados: 0, movimentosTotal: 3400, trechosDeAnexos: 0, ...p,
  };
}

/** Claude pronto (padrão), Gemini instalado mas desligado, Codex ligado mas não instalado. */
export function config(p: Partial<ConfigAssistente> = {}): ConfigAssistente {
  return {
    contaPadrao: 'claude',
    contas: [
      conta(),
      conta({ id: 'gemini', provedor: 'gemini', nome: 'Gemini pessoal', ativo: false, versao: '0.9.0', caminhoDetectado: '/usr/bin/gemini', comoEntrar: 'gemini' }),
      conta({ id: 'codex', provedor: 'codex', nome: 'Codex pessoal', instalado: false, versao: null, caminhoDetectado: null, comoEntrar: 'codex login' }),
    ],
    provedores: PROVEDORES,
    pastaSugerida: '/home/ana/.config/fluxo/contas',
    rag: rag(),
    ...p,
  };
}

export function resumo(p: Partial<ResumoConversa> = {}): ResumoConversa {
  return {
    id: 'c1', titulo: 'Gastos de setembro', contaId: 'claude', contaNome: 'Claude pessoal', provedor: 'claude', modelo: null, fixada: false, gerando: false, previa: '',
    criadaEm: '2026-09-30T12:00:00.000Z', atualizadaEm: '2026-09-30T12:00:00.000Z', ...p,
  };
}

export function passo(p: Partial<PassoFerramenta> = {}): PassoFerramenta {
  return { id: 'p1', nome: 'resumo_do_mes', rotulo: 'Resumo de set/2026', entrada: { mes: '2026-09' }, situacao: 'ok', resultado: '{"despesas": 4210.55}', ...p };
}

export function anexo(p: Partial<Anexo> = {}): Anexo {
  return { id: 'a1', nome: 'fatura.pdf', mime: 'application/pdf', tamanho: 204_800, tipo: 'pdf', situacao: 'pronto', erro: null, origem: 'pessoa', criadoEm: '2026-09-30T12:00:00.000Z', ...p };
}

export function mensagem(p: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 'm1', papel: 'assistente', texto: 'Olá', passos: [], anexos: [], situacao: 'ok', erro: null, contaId: 'claude', contaNome: null, provedor: 'claude', modelo: null,
    uso: null, criadaEm: '2026-09-30T12:00:00.000Z', ...p,
  };
}

export function conversa(p: Partial<Conversa> = {}): Conversa {
  return { ...resumo(), mensagens: [], execucaoAtiva: null, ...p };
}

/** Um corpo de resposta SSE que entrega os pedaços dados, um por leitura, e fecha. */
export function corpoSse(pedacos: string[]): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controle) {
      const p = pedacos[i++];
      if (p === undefined) controle.close();
      else controle.enqueue(codificador.encode(p));
    },
  });
}

export const quadro = (id: number, evento: unknown) => `id: ${id}\ndata: ${JSON.stringify(evento)}\n\n`;

export interface Chamada {
  metodo: string;
  url: string;
  corpo: unknown;
}

type Resposta = unknown | ((c: Chamada) => unknown);

/**
 * Fetch falso que responde por "MÉTODO /caminho" (sem a query). Uma resposta pode
 * ser um valor (vira JSON 200), uma função da chamada ou um `Response` pronto.
 * Rota desconhecida responde 404 com `{ erro }`, como o servidor.
 */
export function servidorFalso(rotas: Record<string, Resposta>): { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const caminho = String(url);
    const chamada: Chamada = {
      metodo: init?.method ?? 'GET',
      url: caminho,
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    chamadas.push(chamada);
    const chave = `${chamada.metodo} ${caminho.split('?')[0]}`;
    if (!(chave in rotas)) return new Response(JSON.stringify({ erro: `Sem rota falsa para ${chave}` }), { status: 404 });
    const r = rotas[chave];
    const valor = typeof r === 'function' ? (r as (c: Chamada) => unknown)(chamada) : r;
    if (valor instanceof Response) return valor;
    if (valor === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(valor), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { chamadas };
}
