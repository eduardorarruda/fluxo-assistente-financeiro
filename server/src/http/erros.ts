import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { NaoEncontrado } from '../dados/repositorio';
import { PluggyNaoConfigurada } from '../servicos/sincronizador';

/** Falha ao falar com o banco/Pluggy. A mensagem já é amigável (ver `mensagemAmigavel`). */
export class ErroDeIntegracao extends Error {}

/**
 * Toda resposta de erro tem o formato { erro: string }. Erro inesperado não
 * vaza detalhe interno para a tela — vai para o log.
 */
@Catch()
export class FiltroDeErros implements ExceptionFilter {
  private readonly log = new Logger('HTTP');

  catch(erro: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<Response>();
    const [status, mensagem] = this.traduzir(erro);
    if (status >= 500 && !(erro instanceof ErroDeIntegracao)) this.log.error(erro instanceof Error ? erro.stack : String(erro));
    resposta.status(status).json({ erro: mensagem });
  }

  private traduzir(erro: unknown): [number, string] {
    if (erro instanceof HttpException) {
      const corpo = erro.getResponse();
      const mensagem = typeof corpo === 'string' ? corpo : ((corpo as { message?: string | string[] }).message ?? erro.message);
      return [erro.getStatus(), Array.isArray(mensagem) ? mensagem.join('; ') : mensagem];
    }
    if (erro instanceof NaoEncontrado) return [404, erro.message];
    if (erro instanceof PluggyNaoConfigurada) return [409, erro.message];
    if (erro instanceof ErroDeIntegracao) return [502, erro.message];
    return [500, 'Algo deu errado aqui dentro. O detalhe ficou no log do Fluxo.'];
  }
}
