import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { CliResolvido } from '../cli/resolvedor';
import type { ProvedorIA } from '../cli/tipos';
import type { AnexoNoPrompt } from './prompt';

/** O que o `Execucoes` recebe e as exceções que ele lança — separado para o arquivo dele caber na cabeça. */

export const RESOLVEDOR_CLI = Symbol('RESOLVEDOR_CLI');
export const COMANDO_PONTE = Symbol('COMANDO_PONTE');

/** Acha o CLI de uma conta (caminho configurado ou detectado, pasta de login) — ou diz por que não dá. */
export type ResolvedorCli = (contaId: string) => Promise<CliResolvido | { erro: string }>;

/** Como iniciar a ponte MCP (node + o arquivo compilado). */
export interface ComandoPonte {
  comando: string;
  args: string[];
}

/** 409: a conversa já está gerando uma resposta. */
export class ConflitoDeExecucao extends ConflictException {}
/** 429: respostas demais ao mesmo tempo. */
export class LimiteDeExecucoes extends HttpException {
  constructor(mensagem: string) {
    super(mensagem, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export interface PedidoResposta {
  conversaId: string;
  mensagemId: string;
  contaId: string;
  provedor: ProvedorIA;
  modelo: string | null;
  texto: string;
  anexos: (AnexoNoPrompt & { caminho?: string })[];
  /** Mensagens anteriores, para quando o CLI não tem (ou perdeu) a sessão. */
  historico: { papel: 'usuario' | 'assistente'; texto: string }[];
  /** Modo conversação: a resposta vai ser falada (curta, sem tabela nem gráfico). */
  voz?: boolean;
}
