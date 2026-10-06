import { Global, Module } from '@nestjs/common';
import { paraDia } from './domain/datas';
import type { Dia } from './domain/types';

export interface Relogio {
  agora(): Date;
  hoje(): Dia;
}

export const RELOGIO = Symbol('RELOGIO');

export const relogioDoSistema: Relogio = {
  agora: () => new Date(),
  hoje: () => paraDia(new Date()),
};

/** Relógio fixo para os testes: "hoje" não muda enquanto a suíte roda. */
export function relogioFixo(dia: Dia): Relogio {
  return { agora: () => new Date(`${dia}T15:00:00`), hoje: () => dia };
}

@Global()
@Module({ providers: [{ provide: RELOGIO, useValue: relogioDoSistema }], exports: [RELOGIO] })
export class RelogioModule {}
