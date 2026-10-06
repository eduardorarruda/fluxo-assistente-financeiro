import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Validar } from '../http/validacao';
import { esquemaPreferencias, FORMATO_CLIENT_ID, FORMATO_CLIENT_SECRET } from './cofre-google';
import { CSP_DO_RETORNO, paginaDeRetorno } from './pagina-retorno';
import { ServicoGoogle, type EstadoPublicoGoogle } from './servico-google';

/** A mensagem de erro do zod diz o motivo, nunca repete o valor (o secret não volta). */
const credenciais = z.object({
  clientId: z.string().trim().regex(FORMATO_CLIENT_ID, 'não parece um client ID do Google (termina em .apps.googleusercontent.com)'),
  clientSecret: z.string().trim().regex(FORMATO_CLIENT_SECRET, 'não parece um client secret do Google (começa com GOCSPX-)'),
}).strict();

const preferencias = esquemaPreferencias
  .partial()
  .strict()
  .transform((p) => (p.antecedencias ? { ...p, antecedencias: [...new Set(p.antecedencias)].sort((a, b) => b - a) } : p));

const desconexao = z.object({ apagarAgenda: z.boolean().default(false) }).strict().default({ apagarAgenda: false });

/**
 * Google Agenda. Tudo atrás da Seguranca com a sessão, menos o retorno do
 * Google (`GET /api/google/retorno`): ele chega sem o cookie (SameSite=Strict
 * não acompanha redirecionamento vindo de accounts.google.com) e é
 * autenticado pelo `state` de uso único — ver `Seguranca` e docs/GOOGLE-AGENDA.md.
 */
@Controller('api/google')
export class GoogleControlador {
  constructor(private readonly google: ServicoGoogle) {}

  @Get('estado')
  estado(): EstadoPublicoGoogle {
    return this.google.estado();
  }

  @Put('cliente')
  salvarCliente(@Body(new Validar(credenciais)) corpo: z.infer<typeof credenciais>): EstadoPublicoGoogle {
    return this.google.salvarCliente(corpo);
  }

  @Delete('cliente')
  removerCliente(): EstadoPublicoGoogle {
    return this.google.removerCliente();
  }

  @Put('preferencias')
  mudarPreferencias(@Body(new Validar(preferencias)) corpo: z.infer<typeof preferencias>): EstadoPublicoGoogle {
    return this.google.mudarPreferencias(corpo);
  }

  @Post('conectar')
  @HttpCode(200)
  conectar(): { url: string } {
    return this.google.iniciarConexao();
  }

  @Get('retorno')
  async retorno(@Query('code') codigo: unknown, @Query('state') estado: unknown, @Query('error') erro: unknown, @Res() res: Response): Promise<void> {
    const r = await this.google.concluirConexao({ codigo, estado, erro });
    res
      .status(r.ok ? 200 : 400)
      .set({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': CSP_DO_RETORNO,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      .type('html')
      .send(paginaDeRetorno(r.ok
        ? { ok: true, titulo: 'Google Agenda conectado', texto: 'Pode fechar esta janela. O Fluxo já está criando a agenda "Fluxo" com os seus vencimentos.' }
        : { ok: false, titulo: 'Não deu para conectar', texto: r.motivo }));
  }

  @Post('sincronizar')
  @HttpCode(200)
  sincronizar(): Promise<EstadoPublicoGoogle> {
    return this.google.sincronizarAgora();
  }

  @Post('desconectar')
  @HttpCode(200)
  desconectar(@Body(new Validar(desconexao)) corpo: z.infer<typeof desconexao>): Promise<EstadoPublicoGoogle & { aviso: string | null }> {
    return this.google.desconectar(corpo.apagarAgenda);
  }
}
