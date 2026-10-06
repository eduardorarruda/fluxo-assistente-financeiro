import { Global, Module } from '@nestjs/common';
import { config as carregarEnv } from 'dotenv';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/** Raiz do projeto: server/src (ou server/dist) → ../.. */
export const RAIZ = resolve(__dirname, '..', '..');

const esquema = z.object({
  PORTA: z.coerce.number().int().min(1024).max(65535).default(8778),
  CAMINHO_BANCO: z.string().default(resolve(RAIZ, 'data', 'fluxo.db')),
  PLUGGY_CLIENT_ID: z.string().trim().optional(),
  PLUGGY_CLIENT_SECRET: z.string().trim().optional(),
  PLUGGY_INCLUIR_SANDBOX: z.enum(['0', '1']).default('0'),
  DESLIGAR_SEM_JANELA: z.enum(['0', '1']).default('0'),
  PASTA_WEB: z.string().default(resolve(RAIZ, 'web', 'dist')),
  /** Conversas do assistente: anexos e a pasta de trabalho de cada CLI. Padrão: ao lado do banco. */
  PASTA_ASSISTENTE: z.string().optional(),
  /** Modelo de vetorização baixado (≈120 MB). Padrão: ao lado do banco. */
  PASTA_MODELOS: z.string().optional(),
});

/** Ao lado do banco; com banco em memória (testes), numa pasta temporária. */
function pastaDeDados(caminhoBanco: string, nome: string): string {
  const base = caminhoBanco === ':memory:' ? join(tmpdir(), `fluxo-${process.pid}`) : dirname(resolve(caminhoBanco));
  return join(base, nome);
}

export interface Config {
  porta: number;
  caminhoBanco: string;
  pastaWeb: string;
  pastaAssistente: string;
  pastaModelos: string;
  pluggy: { clientId: string; clientSecret: string; incluirSandbox: boolean } | null;
  desligarSemJanela: boolean;
}

/**
 * Lê e valida o ambiente uma vez, na subida. Credencial da Pluggy pela
 * metade (só o id ou só o segredo) é erro na hora — melhor do que descobrir
 * no primeiro clique em "Conectar".
 */
export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = esquema.parse(env);
  const id = e.PLUGGY_CLIENT_ID || '';
  const segredo = e.PLUGGY_CLIENT_SECRET || '';
  if (Boolean(id) !== Boolean(segredo)) {
    throw new Error('Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET juntos no arquivo .env (falta um dos dois).');
  }
  return {
    porta: e.PORTA,
    caminhoBanco: e.CAMINHO_BANCO,
    pastaWeb: e.PASTA_WEB,
    pastaAssistente: e.PASTA_ASSISTENTE || pastaDeDados(e.CAMINHO_BANCO, 'assistente'),
    pastaModelos: e.PASTA_MODELOS || pastaDeDados(e.CAMINHO_BANCO, 'modelos'),
    pluggy: id ? { clientId: id, clientSecret: segredo, incluirSandbox: e.PLUGGY_INCLUIR_SANDBOX === '1' } : null,
    desligarSemJanela: e.DESLIGAR_SEM_JANELA === '1',
  };
}

export const CONFIG = Symbol('CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): Config => {
        carregarEnv({ path: resolve(RAIZ, '.env'), quiet: true });
        return lerConfig();
      },
    },
  ],
  exports: [CONFIG],
})
export class ConfigModule {}
