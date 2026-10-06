// Primeiro de tudo: o fuso, antes que qualquer módulo crie uma data.
import './fuso';
import 'reflect-metadata';

// Tudo que o Fluxo cria (banco, sessão, log) nasce legível só pelo dono.
process.umask(0o077);

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG, RAIZ, type Config } from './config';
import { Vigia } from './http/vigia';

/**
 * Content-Security-Policy: tudo vem do próprio Fluxo, com duas exceções — o
 * widget da Pluggy (iframe de connect.pluggy.ai) e os logos dos bancos.
 */
const CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  // blob: é a miniatura da imagem anexada, antes de enviar (lida do próprio arquivo, no navegador).
  imgSrc: ["'self'", 'data:', 'blob:', 'https://*.pluggy.ai', 'https://cdn.pluggy.ai'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  frameSrc: ['https://connect.pluggy.ai'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  // O Fluxo é http://127.0.0.1 por natureza; "subir para https" quebraria os próprios arquivos.
  upgradeInsecureRequests: null,
};

async function iniciar(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  const config = app.get<Config>(CONFIG);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: CSP },
      crossOriginEmbedderPolicy: false,
      // O login do Meu Pluggy (OAuth) abre uma janela a partir do widget e conversa com
      // ela por window.opener. Com "same-origin" o Chrome corta esse laço na hora e o
      // widget mostra "erro inesperado". "allow-popups" mantém o laço só com as janelas
      // que o próprio Fluxo abre.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      // Sem nenhum referrer, o widget não sabe de que origem foi aberto; basta a origem.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.useBodyParser('json', { limit: '256kb' });
  app.enableShutdownHooks();

  // Só 127.0.0.1: nenhum outro computador da rede alcança o Fluxo.
  avisarSeEnvAberto();
  await app.listen(config.porta, '127.0.0.1');
  new Logger('Fluxo').log(`Pronto em http://127.0.0.1:${config.porta}`);

  app.get(Vigia).iniciar(() => void app.close().then(() => process.exit(0)));
}

/** O .env guarda o segredo da Pluggy: se outros usuários podem lê-lo, avisa. */
function avisarSeEnvAberto(): void {
  const caminho = resolve(RAIZ, '.env');
  if (existsSync(caminho) && (statSync(caminho).mode & 0o077) !== 0) {
    new Logger('Fluxo').warn(`O arquivo .env pode ser lido por outros usuários. Rode: chmod 600 "${caminho}"`);
  }
}

void iniciar();
