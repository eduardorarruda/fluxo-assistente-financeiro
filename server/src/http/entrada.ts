import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { COOKIE_SESSAO, Sessao } from './sessao';

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

const PAGINA_BLOQUEIO = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Fluxo</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#07080d;color:#eef1fa;font:15px system-ui">
<div style="text-align:center;max-width:420px"><h1 style="font-weight:600">Abra pelo atalho</h1>
<p style="color:#b3bad0">Este link de entrada já foi usado ou expirou. Abra o Fluxo pelo menu do sistema (ou rode <code>./fluxo.sh</code>).</p></div>`;

/**
 * A porta de entrada: o atalho do menu abre /entrar?c=<código de uso único>,
 * que vira o cookie da sessão. O código some da barra de endereço no redirect.
 */
@Controller()
export class EntradaControlador {
  constructor(@Inject(Sessao) private readonly sessao: Sessao) {}

  @Get('entrar')
  entrar(@Query('c') codigo: unknown, @Res() res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.sessao.usarCodigo(codigo)) {
      res.status(403).type('html').send(PAGINA_BLOQUEIO);
      return;
    }
    res.cookie(COOKIE_SESSAO, this.sessao.token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: TRINTA_DIAS_MS });
    res.redirect(302, '/');
  }
}
