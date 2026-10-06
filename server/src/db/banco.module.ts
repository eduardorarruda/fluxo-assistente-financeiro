import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { abrirBanco, type Banco } from './conexao';
import { CONFIG, type Config } from '../config';

export const BANCO = Symbol('BANCO');

@Global()
@Module({
  providers: [
    {
      provide: BANCO,
      inject: [CONFIG],
      useFactory: (config: Config): Banco => abrirBanco(config.caminhoBanco),
    },
  ],
  exports: [BANCO],
})
export class BancoModule implements OnApplicationShutdown {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  onApplicationShutdown(): void {
    this.banco.$client.close();
  }
}
