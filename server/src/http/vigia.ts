import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

const SEM_SINAL_MS = 90_000;
const CARENCIA_INICIAL_MS = 120_000;

/**
 * Aberto pelo atalho do menu, o Fluxo se desliga sozinho quando a janela
 * fecha: a página manda um sinal a cada 20 s; 90 s sem sinal e o servidor
 * sai. Nada fica rodando esquecido.
 */
@Injectable()
export class Vigia implements OnApplicationShutdown {
  private readonly log = new Logger(Vigia.name);
  private ultimoSinal = Date.now();
  private recebeuAlgum = false;
  private temporizador: NodeJS.Timeout | null = null;
  private encerrar: (() => void) | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  iniciar(encerrar: () => void): void {
    if (!this.config.desligarSemJanela) return;
    this.encerrar = encerrar;
    const inicio = Date.now();
    this.temporizador = setInterval(() => {
      const agora = Date.now();
      const semJanela = this.recebeuAlgum ? agora - this.ultimoSinal > SEM_SINAL_MS : agora - inicio > CARENCIA_INICIAL_MS;
      if (semJanela) {
        this.log.log('A janela fechou — desligando.');
        this.encerrar?.();
      }
    }, 15_000);
    this.temporizador.unref();
  }

  sinal(): void {
    this.ultimoSinal = Date.now();
    this.recebeuAlgum = true;
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }
}
