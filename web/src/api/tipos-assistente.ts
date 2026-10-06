/**
 * Tipos do Assistente — espelho exato do contrato em docs/ASSISTENTE.md.
 * Mudou lá, muda aqui (o servidor é a fonte da verdade).
 */

export type ProvedorIA = 'claude' | 'gemini' | 'codex';

/** O que vale para todas as contas de um CLI. */
export interface ModeloIA {
  id: string;
  nome: string;
  descricao: string;
  selo?: string;
  principal?: boolean;
}

/** A API paga por uso do mesmo provedor (Anthropic, Gemini, OpenAI): o outro jeito de conectar uma conta. */
export interface InfoApi {
  /** "API da Anthropic" | "API do Gemini" | "API da OpenAI" */
  nome: string;
  /** Página do provedor onde a pessoa cria a chave. */
  ondeCriarChave: string;
  /** Catálogo fixo (o seletor usa a lista ao vivo da conta quando ela chega). */
  modelos: ModeloIA[];
}

export interface ProvedorInfo {
  provedor: ProvedorIA;
  nome: string;
  /** Variável pela qual o Fluxo passa a pasta de login ao CLI ("CLAUDE_CONFIG_DIR"…). */
  variavelDeConta: string;
  modelosSugeridos: string[];
  /** Catálogo do seletor: principais com atalho; os outros em "Mais modelos". */
  modelos: ModeloIA[];
  comoInstalar: string;
  api: InfoApi;
}

/** 'cli' = login de um CLI, usa o plano da pessoa; 'api' = chave de API, cobrada por uso. */
export type TipoConta = 'cli' | 'api';

/**
 * Uma conta do assistente. CLI: várias do mesmo CLI se diferenciam pela pasta de login.
 * API: `caminho`, `pastaLogin`, `caminhoDetectado` e `versao` vêm null, `comoEntrar` vazio,
 * e `instalado` diz se a chave existe. A chave nunca volta: só `chaveFinal` ("…AbCd").
 */
export interface ContaIA {
  id: string;
  tipo: TipoConta;
  provedor: ProvedorIA;
  nome: string;
  ativo: boolean;
  caminho: string | null;
  modelo: string | null;
  pastaLogin: string | null;
  caminhoDetectado: string | null;
  instalado: boolean;
  versao: string | null;
  comoEntrar: string;
  chaveFinal: string | null;
}

/** Os modelos de uma conta: ao vivo do provedor (contas de API) ou o catálogo fixo (`aoVivo: false`). */
export interface ModelosDaConta {
  modelos: ModeloIA[];
  aoVivo: boolean;
}

export interface EstadoRag {
  ativo: boolean;
  preparando: boolean;
  progresso: number | null;
  etapa: string | null;
  erro: string | null;
  modelo: string;
  movimentosIndexados: number;
  movimentosTotal: number;
  trechosDeAnexos: number;
}

export interface ConfigAssistente {
  contaPadrao: string | null;
  contas: ContaIA[];
  provedores: ProvedorInfo[];
  pastaSugerida: string;
  rag: EstadoRag;
}

export interface ResumoConversa {
  id: string;
  titulo: string;
  contaId: string;
  contaNome: string | null;
  /** Derivado da conta, para o ícone. */
  provedor: ProvedorIA;
  modelo: string | null;
  fixada: boolean;
  gerando: boolean;
  previa: string;
  criadaEm: string;
  atualizadaEm: string;
}

export type TipoAnexo = 'imagem' | 'pdf' | 'texto';
export type SituacaoAnexo = 'pendente' | 'indexando' | 'pronto' | 'sem_texto' | 'erro';
/** 'pessoa' = anexado por ela; 'gerada' = imagem criada pelo assistente (Nano Banana). */
export type OrigemAnexo = 'pessoa' | 'gerada';

export interface Anexo {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  tipo: TipoAnexo;
  situacao: SituacaoAnexo;
  erro: string | null;
  origem: OrigemAnexo;
  criadoEm: string;
}

export interface PassoFerramenta {
  id: string;
  nome: string;
  rotulo: string;
  entrada: Record<string, unknown>;
  situacao: 'rodando' | 'ok' | 'erro';
  resultado: string | null;
}

export interface Uso {
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;
  duracaoMs: number | null;
}

export type SituacaoMensagem = 'gerando' | 'ok' | 'erro' | 'cancelada' | 'interrompida';

export interface Mensagem {
  id: string;
  papel: 'usuario' | 'assistente';
  texto: string;
  passos: PassoFerramenta[];
  anexos: Anexo[];
  situacao: SituacaoMensagem;
  erro: string | null;
  contaId: string | null;
  contaNome: string | null;
  provedor: ProvedorIA | null;
  modelo: string | null;
  uso: Uso | null;
  criadaEm: string;
}

export interface Conversa extends ResumoConversa {
  mensagens: Mensagem[];
  execucaoAtiva: string | null;
}

export type EventoExecucao =
  | { tipo: 'texto'; delta: string }
  | { tipo: 'passo'; passo: PassoFerramenta }
  | { tipo: 'fim'; mensagem: Mensagem };

export interface MudancaConfig {
  contaPadrao: string;
}

/** Conta de CLI: o corpo antigo, sem `tipo`, continua valendo. */
export interface NovaContaCli {
  tipo?: 'cli';
  provedor: ProvedorIA;
  nome: string;
  pastaLogin?: string | null;
  caminho?: string | null;
  modelo?: string | null;
}

/** Conta de API: a chave só vai (aparada, 20–300 caracteres ASCII visíveis, sem espaço); nunca volta. */
export interface NovaContaApi {
  tipo: 'api';
  provedor: ProvedorIA;
  nome: string;
  chave: string;
  modelo?: string | null;
}

export type NovaConta = NovaContaCli | NovaContaApi;

/** `caminho`/`pastaLogin` só para CLI; `chave` (trocar a chave) só para API. */
export interface MudancaConta {
  nome?: string;
  ativo?: boolean;
  caminho?: string | null;
  modelo?: string | null;
  pastaLogin?: string | null;
  chave?: string;
}

export interface ResultadoTeste {
  ok: boolean;
  versao: string | null;
  mensagem: string;
  duracaoMs: number;
}

export interface NovaConversa {
  contaId?: string;
  modelo?: string | null;
}

export interface MudancaConversa {
  titulo?: string;
  fixada?: boolean;
  contaId?: string;
  modelo?: string | null;
}

export interface NovaMensagem {
  texto: string;
  anexos: string[];
  contaId?: string;
  modelo?: string | null;
  /** Veio do modo conversação: a resposta vai ser lida em voz alta (curta, sem tabelas nem gráficos). */
  voz?: boolean;
}

export interface RespostaEnvio {
  execucaoId: string;
  usuario: Mensagem;
  assistente: Mensagem;
}

export interface RespostaRepetir {
  execucaoId: string;
  assistente: Mensagem;
}

// ---------- imagens (Nano Banana)

export type ModeloImagem = 'gemini-3.1-flash-lite-image' | 'gemini-3.1-flash-image' | 'gemini-3-pro-image';

/** A chave nunca vem do servidor: só se existe e os 4 últimos caracteres ("…AbCd"). */
export interface ConfigImagens {
  configurada: boolean;
  final: string | null;
  modelo: ModeloImagem;
  limiteDiario: number;
  geradasHoje: number;
}

export interface MudancaImagens {
  chave?: string;
  modelo?: ModeloImagem;
  limiteDiario?: number;
}
