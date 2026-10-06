import { ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { id, Validar } from '../../http/validacao';
import { ServicoDeAcoes } from '../acoes/servico-acoes';
import { AcaoJaDecidida, AcaoNaoEncontrada, ErroDeAcao, type AcaoAssistente } from '../acoes/tipos-acoes';

/**
 * As decisões da PESSOA sobre o que o assistente fez ou propôs: aprovar,
 * recusar, desfazer. Ficam atrás da sessão (`Seguranca`), como o resto da API —
 * o token da ponte MCP só abre `/api/assistente/ferramentas`, então nenhum
 * modelo chega aqui. Repetir um clique (ou clicar em duas abas) não faz duas vezes.
 */
@Controller('api/assistente')
export class AcoesControlador {
  constructor(private readonly acoes: ServicoDeAcoes) {}

  @Get('conversas/:id/acoes')
  listar(@Param('id', new Validar(id)) conversaId: string): AcaoAssistente[] {
    return this.acoes.listar(conversaId);
  }

  @Post('propostas/:id/aprovar')
  @HttpCode(200)
  aprovar(@Param('id', new Validar(id)) acaoId: string): AcaoAssistente {
    return traduzir(() => this.acoes.aprovar(acaoId));
  }

  @Post('propostas/:id/recusar')
  @HttpCode(200)
  recusar(@Param('id', new Validar(id)) acaoId: string): AcaoAssistente {
    return traduzir(() => this.acoes.recusar(acaoId));
  }

  @Post('acoes/:id/desfazer')
  @HttpCode(200)
  desfazer(@Param('id', new Validar(id)) acaoId: string): AcaoAssistente {
    return traduzir(() => this.acoes.desfazer(acaoId));
  }
}

function traduzir<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof AcaoNaoEncontrada) throw new NotFoundException(e.message);
    if (e instanceof AcaoJaDecidida || e instanceof ErroDeAcao) throw new ConflictException(e.message);
    throw e;
  }
}
