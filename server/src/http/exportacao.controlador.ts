import { Controller, Get, Header } from '@nestjs/common';
import { Exportador, type Exportacao } from '../servicos/exportacao';

/** Seus dados num arquivo JSON aberto. Atrás da sessão como toda a /api (só leitura). */
@Controller('api/exportacao')
export class ExportacaoControlador {
  constructor(private readonly exportador: Exportador) {}

  @Get()
  @Header('Content-Disposition', 'attachment; filename="fluxo-meus-dados.json"')
  @Header('Cache-Control', 'no-store')
  exportar(): Exportacao {
    return this.exportador.exportar(new Date());
  }
}
