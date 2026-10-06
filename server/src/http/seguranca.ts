import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CABECALHO_SESSAO, COOKIE_SESSAO, lerCookie, type Sessao } from './sessao';

/**
 * O Fluxo só atende esta máquina, e só quem abriu pelo atalho.
 *
 * - Host: barra DNS rebinding (um site que aponta o próprio domínio para
 *   127.0.0.1 continua mandando o Host dele, não o nosso).
 * - Origin: um site aberto em outra aba pode disparar POST para 127.0.0.1;
 *   o navegador manda a Origin dele e aqui ela é recusada.
 * - X-Fluxo nas escritas: cabeçalho próprio obriga o preflight de CORS, que o
 *   Fluxo não responde — nem POST sem corpo de outro site passa.
 * - Sessão: toda a /api (menos a saúde) exige o token, por cookie ou cabeçalho.
 */
/** Única rota que recebe bytes crus (o upload de anexo); todo o resto é JSON. */
const ROTA_DE_UPLOAD = /^\/api\/assistente\/conversas\/[^/]+\/anexos$/;
/** Chamadas da ponte MCP do assistente: autenticadas pelo token da execução, não pela sessão. */
const ROTAS_DA_PONTE = '/api/assistente/ferramentas';
export const CABECALHO_PONTE = 'x-fluxo-ponte';
/**
 * Volta do consentimento do Google. Chega de um redirecionamento de
 * accounts.google.com, e o cookie SameSite=Strict não vem junto: quem a
 * autentica é o `state` de uso único do pedido em aberto (só GET, só esta rota).
 */
export const ROTA_RETORNO_GOOGLE = '/api/google/retorno';

/** O valor de um parâmetro que aparece UMA vez só (repetido, o Express o leria como lista: recusa). */
function parametro(url: string, nome: string): string | undefined {
  const i = url.indexOf('?');
  const valores = i < 0 ? [] : new URLSearchParams(url.slice(i + 1)).getAll(nome);
  return valores.length === 1 ? valores[0] : undefined;
}

export class Seguranca {
  private readonly hosts: Set<string>;
  private readonly origens: Set<string>;

  constructor(
    portas: readonly number[],
    private readonly sessao: Sessao,
    /** Diz se um token da ponte é de uma execução em andamento. */
    private readonly ponteValida: (token: string | undefined) => boolean = () => false,
    /** Diz se um `state` é de um pedido de conexão ao Google em aberto (sem consumi-lo). */
    private readonly retornoGoogleValido: (estado: string | undefined) => boolean = () => false,
  ) {
    this.hosts = new Set(portas.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
    this.origens = new Set([...this.hosts].map((h) => `http://${h}`));
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.hosts.has(req.headers.host ?? '')) throw new ForbiddenException('Host não permitido.');
    const caminho = req.originalUrl.split('?')[0] ?? '';
    const escrita = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (escrita) {
      const origem = req.headers.origin;
      if (origem && !this.origens.has(origem)) throw new ForbiddenException('Origem não permitida.');
      if (req.headers['x-fluxo'] !== '1') throw new ForbiddenException('Requisição sem o cabeçalho do Fluxo.');
      const corpo = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
      const upload = req.method === 'POST' && ROTA_DE_UPLOAD.test(caminho) && req.is('application/octet-stream');
      if (corpo && !upload && !req.is('application/json')) throw new ForbiddenException('Envie JSON.');
    }
    if (caminho === ROTAS_DA_PONTE || caminho.startsWith(`${ROTAS_DA_PONTE}/`)) {
      const token = req.headers[CABECALHO_PONTE];
      if (!this.ponteValida(Array.isArray(token) ? token[0] : token)) throw new UnauthorizedException('Token da ponte inválido ou expirado.');
      next();
      return;
    }
    if (caminho === ROTA_RETORNO_GOOGLE && req.method === 'GET' && this.retornoGoogleValido(parametro(req.originalUrl, 'state'))) {
      next();
      return;
    }
    if (caminho.startsWith('/api/') && caminho !== '/api/saude') {
      const cabecalho = req.headers[CABECALHO_SESSAO];
      const token = (Array.isArray(cabecalho) ? cabecalho[0] : cabecalho) ?? lerCookie(req.headers.cookie, COOKIE_SESSAO);
      if (!this.sessao.valida(token)) throw new UnauthorizedException('Abra o Fluxo pelo atalho do menu.');
    }
    next();
  }
}
