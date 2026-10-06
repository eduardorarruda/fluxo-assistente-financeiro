import type { Provider } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CONFIG, type Config } from '../config';
import { GoogleControlador } from './google.controlador';
import { FETCH_GOOGLE, PASTA_GOOGLE, PORTA_GOOGLE, ServicoGoogle } from './servico-google';

/**
 * `<pasta de dados>/google/` — ao lado do banco, como a sessão. `PASTA_GOOGLE`
 * no ambiente troca o lugar (testes, servidor de teste numa pasta temporária).
 */
export function pastaDoGoogle(config: Pick<Config, 'caminhoBanco'>, env: NodeJS.ProcessEnv = process.env): string {
  if (env.PASTA_GOOGLE) return resolve(env.PASTA_GOOGLE);
  const base = config.caminhoBanco === ':memory:' ? join(tmpdir(), `fluxo-${process.pid}`) : dirname(resolve(config.caminhoBanco));
  return join(base, 'google');
}

export const CONTROLADORES_GOOGLE = [GoogleControlador];

export const PROVEDORES_GOOGLE: Provider[] = [
  ServicoGoogle,
  { provide: PASTA_GOOGLE, inject: [CONFIG], useFactory: (config: Config) => pastaDoGoogle(config) },
  { provide: PORTA_GOOGLE, inject: [CONFIG], useFactory: (config: Config) => config.porta },
  // O fetch do Node; os testes trocam por um falso (nenhum teste fala com o Google).
  { provide: FETCH_GOOGLE, useValue: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch },
];
