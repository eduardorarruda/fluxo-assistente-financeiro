import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import { CABECALHO_PONTE } from '../../http/seguranca';
import { Validar } from '../../http/validacao';
import { Execucoes } from '../execucao/execucoes';
import { Ferramentas } from '../ferramentas/ferramentas';
import { chamadaDeFerramenta, nomeDeFerramenta } from './validacao';

/**
 * O que a ponte MCP chama. Autenticado pelo token da execução (não pela
 * sessão — ver `Seguranca`), que diz de qual conversa é a chamada.
 */
@Controller('api/assistente/ferramentas')
export class FerramentasControlador {
  constructor(private readonly ferramentas: Ferramentas, private readonly execucoes: Execucoes) {}

  @Get()
  listar(@Headers(CABECALHO_PONTE) token: string | undefined) {
    this.contexto(token);
    return this.ferramentas.lista();
  }

  @Post(':nome')
  @HttpCode(200)
  async chamar(
    @Headers(CABECALHO_PONTE) token: string | undefined,
    @Param('nome', new Validar(nomeDeFerramenta)) nome: string,
    @Body(new Validar(chamadaDeFerramenta)) corpo: z.infer<typeof chamadaDeFerramenta>,
  ) {
    const { conversaId } = this.contexto(token);
    if (!conversaId) return { ok: false, texto: 'As ferramentas não estão disponíveis no teste de conexão.' };
    return this.ferramentas.executar(nome, corpo.entrada, { conversaId });
  }

  private contexto(token: string | undefined) {
    const ctx = this.execucoes.contextoDoToken(token);
    if (!ctx) throw new ForbiddenException('Token da ponte inválido ou expirado.');
    return ctx;
  }
}
