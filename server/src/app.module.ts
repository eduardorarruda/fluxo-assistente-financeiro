import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { raw, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { PluggyClient } from 'pluggy-sdk';
import { CONTROLADORES_ASSISTENTE, PROVEDORES_ASSISTENTE } from './assistente/assistente.providers';
import { TAMANHO_MAXIMO_ANEXO } from './assistente/anexos/anexos';
import { Execucoes } from './assistente/execucao/execucoes';
import { CONFIG, ConfigModule, lerConfig, type Config } from './config';
import { Repositorio } from './dados/repositorio';
import { BancoModule } from './db/banco.module';
import { CONTROLADORES_GOOGLE, PROVEDORES_GOOGLE } from './google/google.providers';
import { ServicoGoogle } from './google/servico-google';
import {
  ConexoesControlador, EstadoControlador, MetasControlador, MovimentosControlador, OrcamentoControlador,
  PainelControlador, RegrasControlador,
} from './http/controladores';
import { ContasAPagarControlador } from './http/contas-a-pagar.controlador';
import { EntradaControlador } from './http/entrada';
import { FiltroDeErros } from './http/erros';
import { Seguranca } from './http/seguranca';
import { Sessao } from './http/sessao';
import { Vigia } from './http/vigia';
import { ProvedorDemo } from './provedores/provedor-demo';
import { ProvedorPluggy } from './provedores/provedor-pluggy';
import { RelogioModule } from './relogio';
import { ContasAPagar } from './servicos/contas-a-pagar';
import { Financas } from './servicos/financas';
import { PROVEDOR_PLUGGY, Sincronizador } from './servicos/sincronizador';

/**
 * Porta do Vite, só em desenvolvimento: as chamadas dele passam pelo proxy
 * com esse Host. Em produção (o atalho define NODE_ENV=production) nenhuma
 * porta além da do próprio Fluxo é aceita.
 */
const PORTA_VITE =
  process.env.NODE_ENV === 'production' ? null : Number(process.env.PORTA_VITE ?? process.env.PORT ?? 5173);

// O front compilado só é servido se existir (em desenvolvimento quem serve é o Vite).
function servirFront() {
  const pasta = lerConfigSemFalhar()?.pastaWeb;
  return pasta && existsSync(pasta)
    ? [ServeStaticModule.forRoot({ rootPath: pasta,
        // /assets fora do fallback: arquivo que não existe é 404, não o index.html fingindo ser JS.
        exclude: ['/api/{*caminho}', '/entrar', '/assets/{*caminho}'], serveStaticOptions: {
            index: 'index.html',
            maxAge: '1h',
            // Os assets têm hash no nome e podem ficar em cache; o index.html não, senão
            // uma versão nova do Fluxo só apareceria uma hora depois.
            setHeaders: (res: { setHeader: (k: string, v: string) => void }, caminho: string) => {
              if (caminho.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
            },
          } })]
    : [];
}

function lerConfigSemFalhar(): Config | null {
  try {
    return lerConfig();
  } catch {
    return null;
  }
}

@Module({
  imports: [
    ConfigModule,
    RelogioModule,
    BancoModule,
    // Limite generoso para uma pessoa só; existe para um script em loop não travar o SQLite.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    ...servirFront(),
  ],
  controllers: [
    EntradaControlador,
    EstadoControlador, PainelControlador, MovimentosControlador, RegrasControlador, OrcamentoControlador,
    MetasControlador, ConexoesControlador, ContasAPagarControlador,
    ...CONTROLADORES_ASSISTENTE,
    ...CONTROLADORES_GOOGLE,
  ],
  providers: [
    ...PROVEDORES_ASSISTENTE,
    ...PROVEDORES_GOOGLE,
    Repositorio,
    Financas,
    Sincronizador,
    // Contas a pagar: o assistente (ferramentas de escrita) e a Agenda do Google injetam este serviço.
    ContasAPagar,
    Vigia,
    {
      provide: Sessao,
      inject: [CONFIG],
      // Banco em memória (testes) não tem pasta: o token vem de FLUXO_SESSAO.
      useFactory: (config: Config) =>
        new Sessao(config.caminhoBanco === ':memory:' ? null : dirname(config.caminhoBanco), process.env.FLUXO_SESSAO),
    },
    { provide: ProvedorDemo, useFactory: () => new ProvedorDemo() },
    {
      provide: PROVEDOR_PLUGGY,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        config.pluggy ? new ProvedorPluggy(new PluggyClient({ clientId: config.pluggy.clientId, clientSecret: config.pluggy.clientSecret })) : null,
    },
    { provide: APP_FILTER, useClass: FiltroDeErros },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly sessao: Sessao, private readonly execucoes: Execucoes, private readonly google: ServicoGoogle) {}

  configure(consumer: MiddlewareConsumer): void {
    const portas = [lerConfigSemFalhar()?.porta ?? 8778, ...(PORTA_VITE ? [PORTA_VITE] : [])];
    const seguranca = new Seguranca(
      portas, this.sessao, (token) => this.execucoes.contextoDoToken(token) !== null, (estado) => this.google.retornoValido(estado),
    );
    consumer.apply((req: Request, res: Response, next: NextFunction) => seguranca.use(req, res, next)).forRoutes('*');
    // Anexo chega em bytes crus. Depois da Seguranca: só chega aqui o que ela deixou passar.
    consumer
      .apply(raw({ type: 'application/octet-stream', limit: TAMANHO_MAXIMO_ANEXO + 1024 }))
      .forRoutes({ path: 'api/assistente/conversas/:id/anexos', method: RequestMethod.POST });
  }
}
