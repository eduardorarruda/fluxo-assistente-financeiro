import type { ProvedorIA, Uso } from './cli/tipos';

/**
 * As formas que a API do assistente devolve — o contrato descrito em
 * docs/ASSISTENTE.md, espelhado em web/src/api/tipos-assistente.ts.
 */

export type { ProvedorIA, Uso };

export type SituacaoMensagem = 'gerando' | 'ok' | 'erro' | 'cancelada' | 'interrompida';
export type SituacaoAnexo = 'pendente' | 'indexando' | 'pronto' | 'sem_texto' | 'erro';
export type TipoAnexo = 'imagem' | 'pdf' | 'texto';
/** 'pessoa' = anexado por ela; 'gerada' = imagem criada pelo assistente (Nano Banana). */
export type OrigemAnexo = 'pessoa' | 'gerada';

export interface PassoFerramenta {
  id: string;
  nome: string;
  rotulo: string;
  entrada: Record<string, unknown>;
  situacao: 'rodando' | 'ok' | 'erro';
  resultado: string | null;
}

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

export interface Mensagem {
  id: string;
  papel: 'usuario' | 'assistente';
  texto: string;
  passos: PassoFerramenta[];
  anexos: Anexo[];
  situacao: SituacaoMensagem;
  erro: string | null;
  /** Quem respondeu (só nas do assistente). */
  contaId: string | null;
  contaNome: string | null;
  provedor: ProvedorIA | null;
  modelo: string | null;
  uso: Uso | null;
  criadaEm: string;
}

export interface ResumoConversa {
  id: string;
  titulo: string;
  /** A conta (login de um CLI) que responde nesta conversa. */
  contaId: string;
  contaNome: string | null;
  provedor: ProvedorIA;
  modelo: string | null;
  fixada: boolean;
  gerando: boolean;
  previa: string;
  criadaEm: string;
  atualizadaEm: string;
}

export interface Conversa extends ResumoConversa {
  mensagens: Mensagem[];
  execucaoAtiva: string | null;
}

export type EventoExecucao =
  | { tipo: 'texto'; delta: string }
  | { tipo: 'passo'; passo: PassoFerramenta }
  | { tipo: 'fim'; mensagem: Mensagem };

/**
 * 'cli' = o CLI da pessoa, com o login (plano) dela; 'api' = chave de API do
 * provedor, paga por uso (claude → Anthropic, gemini → Gemini API, codex → OpenAI).
 */
export type TipoConta = 'cli' | 'api';
export const TIPOS_CONTA = ['cli', 'api'] as const satisfies readonly TipoConta[];

/**
 * Uma conta = um login de um CLI ou uma chave de API. Várias do mesmo CLI se
 * distinguem pela pasta de login (a variável `variavelDeConta` do adaptador).
 * As três padrão têm id igual ao provedor e usam o login padrão do CLI.
 * Conta por API nunca tem `caminho` nem `pastaLogin` (sempre null), e a chave
 * não fica aqui: mora num arquivo 0600 (ver apis/chaves-de-api.ts).
 */
export interface ContaSalva {
  id: string;
  provedor: ProvedorIA;
  nome: string;
  ativo: boolean;
  tipo: TipoConta;
  caminho: string | null;
  modelo: string | null;
  pastaLogin: string | null;
}

export interface ConfigAssistenteSalva {
  contaPadrao: string | null;
  contas: ContaSalva[];
}

/** Imagens com Nano Banana. A chave nunca sai do servidor: só se ela existe e os 4 últimos caracteres. */
export interface ConfigImagens {
  configurada: boolean;
  /** "…AbCd" ou null. */
  final: string | null;
  modelo: 'gemini-3.1-flash-lite-image' | 'gemini-3.1-flash-image' | 'gemini-3-pro-image';
  limiteDiario: number;
  geradasHoje: number;
}
