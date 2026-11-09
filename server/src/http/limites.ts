import { Throttle } from '@nestjs/throttler';

/**
 * Limites por minuto mais apertados que o geral (600/min) onde um loop faz estrago:
 * - ferramentas da ponte: um modelo em loop não martela o SQLite nem a chave paga;
 * - aprovar/recusar/desfazer: cliques humanos, nunca dezenas por minuto;
 * - entrada: código de uso único, ninguém precisa tentar muitas vezes.
 */
const MINUTO = 60_000;
export const LIMITE_FERRAMENTAS = Throttle({ default: { ttl: MINUTO, limit: 120 } });
export const LIMITE_DECISOES = Throttle({ default: { ttl: MINUTO, limit: 30 } });
export const LIMITE_ENTRADA = Throttle({ default: { ttl: MINUTO, limit: 20 } });
