import { Body, Controller, Delete, Get, NotFoundException, Param, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, statSync } from 'node:fs';
import type { z } from 'zod';
import { id, Validar } from '../../http/validacao';
import { Anexos } from '../anexos/anexos';
import { ServicoDeImagens } from '../imagens/servico-imagens';
import type { ConfigImagens } from '../tipos-api';
import { mudancaImagens } from './validacao';

/**
 * Imagens do assistente: os ajustes do Nano Banana e o arquivo das imagens
 * (geradas ou anexadas) para a tela mostrar. Tudo atrás da sessão (`Seguranca`).
 * Nenhuma resposta daqui contém a chave do Gemini.
 */
@Controller('api/assistente')
export class ImagensControlador {
  constructor(private readonly imagens: ServicoDeImagens, private readonly anexos: Anexos) {}

  @Get('imagens/config')
  config(): ConfigImagens {
    return this.imagens.config();
  }

  @Put('imagens/config')
  mudar(@Body(new Validar(mudancaImagens)) corpo: z.infer<typeof mudancaImagens>): ConfigImagens {
    return this.imagens.mudar(corpo);
  }

  @Delete('imagens/config')
  removerChave(): ConfigImagens {
    return this.imagens.removerChave();
  }

  /**
   * Só imagem (PNG/JPEG/WEBP/GIF, tipo conferido pelos bytes ao gravar): o
   * Content-Type vem do que foi gravado e `nosniff` impede o navegador de
   * reinterpretar. PDF e texto não saem por aqui.
   */
  @Get('anexos/:id/arquivo')
  arquivo(@Param('id', new Validar(id)) anexoId: string, @Res() res: Response): void {
    const { caminho, mime, nome } = this.anexos.imagem(anexoId);
    let tamanho: number;
    try {
      tamanho = statSync(caminho).size;
    } catch {
      throw new NotFoundException('Imagem não encontrada.');
    }
    res.status(200).set({
      'Content-Type': mime,
      'Content-Length': String(tamanho),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    const fluxo = createReadStream(caminho);
    fluxo.on('error', () => res.destroy());
    fluxo.pipe(res);
  }
}
