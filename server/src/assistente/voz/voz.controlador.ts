import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Validar } from '../../http/validacao';
import { IDS_DE_VOZ } from './catalogo';
import { type EstadoVoz, MAXIMO_CARACTERES, ServicoDeVoz } from './servico-voz';
import { VELOCIDADE } from './sintetizador';

/**
 * A voz natural (Piper) do assistente. Atrás da `Seguranca` como o resto da
 * /api: sessão local em tudo e `X-Fluxo: 1` nas escritas (inclusive no
 * `falar`, que é POST com JSON). A voz é sempre um `id` do catálogo — nunca
 * uma URL.
 */

export const idDeVoz = z.enum(IDS_DE_VOZ);
export const pedidoBaixar = z.strictObject({ voz: idDeVoz });
export const pedidoPreparar = z.strictObject({ voz: idDeVoz.optional() });
export const pedidoFalar = z.strictObject({
  texto: z.string().trim().min(1, 'texto vazio').max(MAXIMO_CARACTERES, `no máximo ${MAXIMO_CARACTERES} caracteres por fala`),
  voz: idDeVoz.optional(),
  velocidade: z.number().min(VELOCIDADE.min).max(VELOCIDADE.max).optional(),
});

@Controller('api/assistente/voz')
export class VozControlador {
  constructor(private readonly voz: ServicoDeVoz) {}

  @Get()
  estado(): EstadoVoz {
    return this.voz.estado();
  }

  @Post('baixar')
  @HttpCode(200)
  baixar(@Body(new Validar(pedidoBaixar)) corpo: z.infer<typeof pedidoBaixar>): EstadoVoz {
    return this.voz.baixar(corpo.voz);
  }

  @Delete(':voz')
  remover(@Param('voz', new Validar(idDeVoz)) voz: string): EstadoVoz {
    return this.voz.remover(voz);
  }

  /** Carrega o modelo na memória antes da primeira fala (não espera). */
  @Post('preparar')
  @HttpCode(202)
  preparar(@Body(new Validar(pedidoPreparar)) corpo: z.infer<typeof pedidoPreparar>): void {
    void this.voz.preparar(corpo.voz);
  }

  /** Uma frase → audio/wav. Se a tela desistir (fechou a conexão) antes da vez dela, a síntese é pulada. */
  @Post('falar')
  @HttpCode(200)
  async falar(@Body(new Validar(pedidoFalar)) corpo: z.infer<typeof pedidoFalar>, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    let desistiu = false;
    // A resposta fechou sem terminar = a tela cancelou o pedido (parou de falar).
    res.once('close', () => {
      desistiu = !res.writableFinished;
    });
    const wav = await this.voz.falar(corpo, () => desistiu);
    return new StreamableFile(wav, { type: 'audio/wav', length: wav.length, disposition: 'inline' });
  }
}
