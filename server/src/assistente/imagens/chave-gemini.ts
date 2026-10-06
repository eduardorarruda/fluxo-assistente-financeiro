import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { finalDaChave, gravarChavePrivada, lerChavePrivada, removerChavePrivada } from '../chaves/arquivo-privado';

export const ARQUIVO_CHAVE_GEMINI = 'chave-gemini';

/**
 * Formato frouxo de propósito (o Google já mudou o formato das chaves): só
 * caracteres de chave, tamanho razoável. Não há chamada de validação: a chave
 * é conferida de verdade na primeira imagem.
 */
export const FORMATO_CHAVE_GEMINI = /^[A-Za-z0-9_.-]{20,200}$/;

/**
 * Guarda a chave paga do Gemini num arquivo próprio, fora do banco e fora da
 * pasta das conversas (que o modelo consegue ler): `<pastaAssistente>/chave-gemini`,
 * arquivo 0600 numa pasta 0700. A chave só sai daqui para o cabeçalho da
 * chamada ao Google — nunca para a API, o log, a linha de comando ou o
 * ambiente dos CLIs.
 */
export class CofreChaveGemini {
  private readonly log = new Logger('CofreChaveGemini');

  constructor(private readonly pasta: string) {}

  private get caminho(): string {
    return join(this.pasta, ARQUIVO_CHAVE_GEMINI);
  }

  ler(): string | null {
    const { chave, erro } = lerChavePrivada(this.caminho, FORMATO_CHAVE_GEMINI);
    if (erro) this.log.warn(`Não consegui ler o arquivo da chave do Gemini (${erro}).`);
    return chave;
  }

  configurada(): boolean {
    return this.ler() !== null;
  }

  /** "…AbCd": o bastante para a pessoa reconhecer qual chave está lá, sem revelar a chave. */
  final(): string | null {
    return finalDaChave(this.ler());
  }

  salvar(chave: string): void {
    const limpa = chave.trim();
    if (!FORMATO_CHAVE_GEMINI.test(limpa)) throw new Error('Formato de chave inválido.');
    gravarChavePrivada(this.pasta, ARQUIVO_CHAVE_GEMINI, limpa);
  }

  remover(): void {
    removerChavePrivada(this.caminho);
  }
}
