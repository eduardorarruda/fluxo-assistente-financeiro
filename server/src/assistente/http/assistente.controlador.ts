import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { id, Validar } from '../../http/validacao';
import { Anexos } from '../anexos/anexos';
import { Execucoes } from '../execucao/execucoes';
import { ServicoDeContas } from '../contas';
import { ServicoAssistente } from '../servico-assistente';
import type { EventoExecucao } from '../tipos-api';
import {
  alteracaoConversa, buscaConversas, contaPadrao, dadosConta, desde, nomeDoAnexo, novaConta, novaConversa, novaMensagem,
} from './validacao';

const BATIDA_MS = 15_000;

@Controller('api/assistente')
export class AssistenteControlador {
  constructor(
    private readonly servico: ServicoAssistente,
    private readonly contas: ServicoDeContas,
    private readonly execucoes: Execucoes,
    private readonly anexos: Anexos,
  ) {}

  // ----------------------------------------------------------- configuração

  @Get('config')
  config() {
    return this.contas.config();
  }

  @Put('config')
  definirPadrao(@Body(new Validar(contaPadrao)) corpo: z.infer<typeof contaPadrao>) {
    return this.contas.definirPadrao(corpo.contaPadrao);
  }

  @Post('contas')
  criarConta(@Body(new Validar(novaConta)) corpo: z.infer<typeof novaConta>) {
    return this.contas.criar(corpo);
  }

  @Patch('contas/:id')
  atualizarConta(@Param('id', new Validar(id)) contaId: string, @Body(new Validar(dadosConta)) corpo: z.infer<typeof dadosConta>) {
    return this.contas.atualizar(contaId, corpo);
  }

  @Delete('contas/:id')
  removerConta(@Param('id', new Validar(id)) contaId: string) {
    return this.contas.remover(contaId);
  }

  /** Os modelos para o seletor: ao vivo da API nas contas por chave (`aoVivo`), o catálogo no resto. */
  @Get('contas/:id/modelos')
  modelosDaConta(@Param('id', new Validar(id)) contaId: string) {
    return this.contas.modelos(contaId);
  }

  @Post('contas/:id/testar')
  @HttpCode(200)
  testarConta(@Param('id', new Validar(id)) contaId: string) {
    return this.contas.testar(contaId);
  }

  @Post('rag/ativar')
  @HttpCode(200)
  ativarRag() {
    return this.servico.ativarRag();
  }

  @Post('rag/reindexar')
  @HttpCode(200)
  reindexarRag() {
    return this.servico.reindexarRag();
  }

  // -------------------------------------------------------------- conversas

  @Get('conversas')
  listar(@Query(new Validar(buscaConversas)) q: z.infer<typeof buscaConversas>) {
    return this.servico.listar(q.busca);
  }

  @Post('conversas')
  criar(@Body(new Validar(novaConversa)) corpo: z.infer<typeof novaConversa>) {
    return this.servico.criar(corpo);
  }

  @Get('conversas/:id')
  obter(@Param('id', new Validar(id)) conversaId: string) {
    return this.servico.obter(conversaId);
  }

  @Patch('conversas/:id')
  atualizar(@Param('id', new Validar(id)) conversaId: string, @Body(new Validar(alteracaoConversa)) corpo: z.infer<typeof alteracaoConversa>) {
    return this.servico.atualizar(conversaId, corpo);
  }

  @Delete('conversas/:id')
  @HttpCode(204)
  remover(@Param('id', new Validar(id)) conversaId: string): void {
    this.servico.remover(conversaId);
  }

  /** Bytes crus (application/octet-stream); o nome vai na query. */
  @Post('conversas/:id/anexos')
  receberAnexo(@Param('id', new Validar(id)) conversaId: string, @Query(new Validar(nomeDoAnexo)) q: z.infer<typeof nomeDoAnexo>, @Req() req: Request) {
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException('Envie o arquivo como application/octet-stream.');
    return this.servico.receberAnexo(conversaId, q.nome, req.body);
  }

  @Delete('anexos/:id')
  @HttpCode(204)
  removerAnexo(@Param('id', new Validar(id)) anexoId: string): void {
    this.anexos.remover(anexoId);
  }

  // -------------------------------------------------------------- mensagens

  @Post('conversas/:id/mensagens')
  enviar(@Param('id', new Validar(id)) conversaId: string, @Body(new Validar(novaMensagem)) corpo: z.infer<typeof novaMensagem>) {
    return this.servico.enviar(conversaId, corpo);
  }

  @Post('mensagens/:id/repetir')
  repetir(@Param('id', new Validar(id)) mensagemId: string) {
    return this.servico.repetir(mensagemId);
  }

  @Post('execucoes/:id/cancelar')
  @HttpCode(204)
  cancelar(@Param('id', new Validar(id)) execucaoId: string): void {
    this.servico.cancelar(execucaoId);
  }

  /**
   * Server-Sent Events. Cada evento leva o número (`id:`) para reconectar com
   * `?desde=`; `desde=0` manda tudo desde o começo. Termina no evento `fim`.
   */
  @Get('execucoes/:id/eventos')
  eventos(@Param('id', new Validar(id)) execucaoId: string, @Query(new Validar(desde)) q: z.infer<typeof desde>, @Req() req: Request, @Res() res: Response): void {
    if (!this.execucoes.existe(execucaoId)) throw new NotFoundException('Essa resposta não está mais em andamento.');
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let aberta = true;
    let cancelarAssinatura: (() => void) | null = null;
    const batida = setInterval(() => res.write(': ping\n\n'), BATIDA_MS);
    const encerrar = () => {
      if (!aberta) return;
      aberta = false;
      clearInterval(batida);
      cancelarAssinatura?.();
      res.end();
    };
    const escrever = (seq: number, evento: EventoExecucao) => {
      if (!aberta) return;
      res.write(`id: ${seq}\ndata: ${JSON.stringify(evento)}\n\n`);
      if (evento.tipo === 'fim') setImmediate(encerrar);
    };
    req.on('close', encerrar);
    cancelarAssinatura = this.execucoes.assinar(execucaoId, q.desde, escrever);
    if (!cancelarAssinatura) encerrar();
  }
}
