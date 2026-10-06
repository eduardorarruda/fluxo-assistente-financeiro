/**
 * O contrato comum dos três CLIs. Cada adaptador sabe montar a linha de
 * comando do seu CLI e traduzir a saída dele (JSON por linha) para estes
 * eventos — o resto do assistente não sabe qual CLI está do outro lado.
 */

import type { ModeloIA } from './modelos';

export const PROVEDORES = ['claude', 'gemini', 'codex'] as const;
export type ProvedorIA = (typeof PROVEDORES)[number];

export interface Uso {
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;
  duracaoMs: number | null;
}

export type CodigoErro = 'autenticacao' | 'limite' | 'cli' | 'tempo' | 'desconhecido';

export type EventoAgente =
  | { tipo: 'sessao'; sessaoId: string; modelo: string | null }
  | { tipo: 'texto'; delta: string }
  /** Início de uma chamada de ferramenta, ou a mesma chamada com a entrada completa (mesmo id). */
  | { tipo: 'ferramenta'; id: string; nome: string; entrada: Record<string, unknown> }
  | { tipo: 'ferramenta_fim'; id: string; ok: boolean; resultado: string }
  | { tipo: 'uso'; uso: Partial<Uso> }
  | { tipo: 'erro'; mensagem: string; codigo: CodigoErro }
  | { tipo: 'aviso'; mensagem: string };

/** O servidor MCP do Fluxo, do jeito que cada CLI precisa para iniciá-lo. */
export interface ServidorMcp {
  /** Sem "_": o Gemini separa `mcp_<servidor>_<ferramenta>` no primeiro sublinhado. */
  nome: string;
  comando: string;
  args: string[];
  /** Variáveis sem segredo nenhum (podem ir para arquivo de configuração ou linha de comando). */
  env: Record<string, string>;
  /**
   * O token da ponte. Nunca vai para a linha de comando (ps mostra) nem para
   * arquivo que o agente consiga ler: cada adaptador o entrega pelo ambiente.
   * O nome não pode conter TOKEN/KEY/SECRET — o Gemini apaga essas variáveis.
   */
  segredo: { variavel: string; valor: string };
}

export interface ParametrosExecucao {
  /** Pasta da conversa: o CLI roda aqui (e guarda a sessão relativa a ela). Os anexos ficam nela. */
  pasta: string;
  /**
   * Pasta só desta execução, fora do alcance das ferramentas de leitura do CLI:
   * é onde ficam a configuração do MCP (que leva o token da ponte) e as instruções.
   * Apagada quando a execução termina.
   */
  pastaExecucao: string;
  /** Texto que vai pela entrada padrão. */
  prompt: string;
  /** Instruções de sistema do assistente. */
  instrucoes: string;
  modelo: string | null;
  /** Sessão anterior do mesmo CLI nesta conversa, para continuar de onde parou. */
  sessaoId: string | null;
  mcp: ServidorMcp;
  /** Imagens anexadas (caminhos absolutos dentro de `pasta`). */
  imagens: string[];
}

export interface ArquivoTemporario {
  caminho: string;
  conteudo: string;
}

export interface Comando {
  args: string[];
  /** O que vai pela entrada padrão (o prompt já preparado para este CLI). */
  entrada: string;
  /** Arquivos que precisam existir antes de iniciar (configuração do MCP, instruções). */
  arquivos: ArquivoTemporario[];
  /** Variáveis extras, além do ambiente limpo comum. */
  env: Record<string, string>;
}

/** Lê uma linha da saída e devolve os eventos que ela produz. Tem estado: um por execução. */
export type Interprete = (linha: string) => EventoAgente[];

export interface AdaptadorCli {
  provedor: ProvedorIA;
  nome: string;
  /** Nome do executável; o caminho configurado precisa terminar nele. */
  binario: string;
  comoInstalar: string;
  /** Comando de login, pronto para copiar (o que vem depois de `#` é dica, comentário no shell). */
  comoEntrar: string;
  /**
   * A variável que aponta a pasta de login do CLI. Com ela, a mesma
   * instalação atende contas diferentes (pessoal e trabalho, por exemplo).
   */
  variavelDeConta: string;
  /** Catálogo para o seletor (ver cli/modelos.ts). */
  modelos: readonly ModeloIA[];
  /** Variáveis do ambiente do usuário que o CLI precisa (login, pasta de configuração). */
  variaveisPermitidas: readonly string[];
  montar(p: ParametrosExecucao): Comando;
  novoInterprete(): Interprete;
  /** Traduz uma saída com erro (código e stderr) em mensagem para a pessoa, se reconhecer. */
  explicarFalha(codigo: number | null, stderr: string): { mensagem: string; codigo: CodigoErro } | null;
  /**
   * A sessão pedida em `--resume` não existe mais (o CLI apagou, ou é de outra
   * máquina). O executor então recomeça sem ela, mandando o histórico no prompt.
   */
  sessaoPerdida(codigo: number | null, stderr: string): boolean;
}
