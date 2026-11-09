import { BadRequestException, Injectable } from '@nestjs/common';

/** Por quanto tempo um pedido repetido devolve o mesmo resultado (um clique duplo, uma nova tentativa da rede). */
export const VALIDADE_DA_CHAVE_MS = 10 * 60_000;
/** Chaves guardadas no máximo (é uma pessoa só; isto só impede crescer sem fim). */
const MAXIMO_DE_CHAVES = 500;
const FORMATO_DA_CHAVE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Cabeçalho `Idempotency-Key`: o front gera uma chave por abertura do formulário.
 * O mesmo pedido chegando de novo (clique duplo, Enter repetido) devolve o que o
 * primeiro devolveu, sem criar outro. Sem chave, o comportamento é o de sempre.
 * Em memória: o serviço é síncrono (SQLite), então dois pedidos nunca se cruzam no meio.
 */
@Injectable()
export class Idempotencia {
  private readonly feitos = new Map<string, { resultado: unknown; expira: number }>();

  constructor(private readonly agora: () => number = Date.now) {}

  umaVez<T>(escopo: string, chave: string | string[] | undefined, fazer: () => T): T {
    if (chave === undefined) return fazer();
    if (Array.isArray(chave) || !FORMATO_DA_CHAVE.test(chave)) throw new BadRequestException('Chave de idempotência inválida.');
    const agora = this.agora();
    this.limpar(agora);
    const id = `${escopo}:${chave}`;
    const feito = this.feitos.get(id);
    if (feito) return feito.resultado as T;
    const resultado = fazer();
    this.feitos.set(id, { resultado, expira: agora + VALIDADE_DA_CHAVE_MS });
    return resultado;
  }

  private limpar(agora: number): void {
    for (const [id, f] of this.feitos) if (f.expira <= agora) this.feitos.delete(id);
    while (this.feitos.size >= MAXIMO_DE_CHAVES) this.feitos.delete(this.feitos.keys().next().value!);
  }
}
