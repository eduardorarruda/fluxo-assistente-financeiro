import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { finalDaChave, gravarChavePrivada, lerChavePrivada, removerChavePrivada } from '../chaves/arquivo-privado';

export const PASTA_CHAVES = 'chaves';

/**
 * Chave de API (Anthropic, Gemini, OpenAI): ASCII visível, sem espaço, de 20 a
 * 300 caracteres. Frouxo de propósito — os provedores mudam o formato; a
 * chave é conferida de verdade no "Testar" ou na primeira resposta.
 */
export const FORMATO_CHAVE_API = /^[\x21-\x7E]{20,300}$/;

/** O id da conta vira nome de arquivo: só o que um uuid ou um id padrão usa. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * As chaves das contas por API, uma por arquivo: `<pastaAssistente>/chaves/<contaId>`
 * (0600, pasta 0700). Nunca no banco nem no JSON da configuração, nunca de
 * volta pela API (só os 4 últimos caracteres), nunca no log.
 */
export class ChavesDeApi {
  private readonly log = new Logger('ChavesDeApi');

  constructor(private readonly pastaAssistente: string) {}

  private get pasta(): string {
    return join(this.pastaAssistente, PASTA_CHAVES);
  }

  private caminho(contaId: string): string | null {
    return ID_SEGURO.test(contaId) ? join(this.pasta, contaId) : null;
  }

  ler(contaId: string): string | null {
    const caminho = this.caminho(contaId);
    if (!caminho) return null;
    const { chave, erro } = lerChavePrivada(caminho, FORMATO_CHAVE_API);
    if (erro) this.log.warn(`Não consegui ler a chave de uma conta por API (${erro}).`);
    return chave;
  }

  existe(contaId: string): boolean {
    return this.ler(contaId) !== null;
  }

  final(contaId: string): string | null {
    return finalDaChave(this.ler(contaId));
  }

  salvar(contaId: string, chave: string): void {
    const caminho = this.caminho(contaId);
    if (!caminho) throw new Error('Conta inválida para guardar chave.');
    const limpa = chave.trim();
    if (!FORMATO_CHAVE_API.test(limpa)) throw new Error('Formato de chave inválido.');
    gravarChavePrivada(this.pasta, contaId, limpa);
  }

  remover(contaId: string): void {
    const caminho = this.caminho(contaId);
    if (caminho) removerChavePrivada(caminho);
  }
}
