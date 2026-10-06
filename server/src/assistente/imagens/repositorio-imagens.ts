import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { BANCO } from '../../db/banco.module';
import type { Banco } from '../../db/conexao';
import * as s from '../../db/schema';
import { LIMITE_DIARIO_MAXIMO, LIMITE_DIARIO_PADRAO, MODELO_IMAGEM_PADRAO, MODELOS_IMAGEM, type ModeloImagem } from './modelos-imagem';

const CHAVE = 'imagens';

export interface PreferenciasImagens {
  modelo: ModeloImagem;
  limiteDiario: number;
  /** Quantas imagens foram geradas no dia `dia` (AAAA-MM-DD local). */
  uso: { dia: string; geradas: number };
}

const esquema = z.object({
  modelo: z.enum(MODELOS_IMAGEM).catch(MODELO_IMAGEM_PADRAO),
  limiteDiario: z.number().int().min(1).max(LIMITE_DIARIO_MAXIMO).catch(LIMITE_DIARIO_PADRAO),
  uso: z.object({ dia: z.string(), geradas: z.number().int().min(0) }).catch({ dia: '', geradas: 0 }),
});

const PADRAO: PreferenciasImagens = { modelo: MODELO_IMAGEM_PADRAO, limiteDiario: LIMITE_DIARIO_PADRAO, uso: { dia: '', geradas: 0 } };

/**
 * Preferências das imagens (modelo, limite por dia) e o contador do dia, na
 * tabela de configurações. O contador fica aqui, e não contado pelos anexos,
 * para que apagar a conversa não devolva a cota do dia. A chave NÃO fica aqui
 * (ver `CofreChaveGemini`).
 */
@Injectable()
export class RepositorioImagens {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  ler(): PreferenciasImagens {
    const linha = this.banco.select().from(s.configuracoes).where(eq(s.configuracoes.chave, CHAVE)).get();
    if (!linha) return PADRAO;
    try {
      const r = esquema.safeParse(JSON.parse(linha.valor));
      return r.success ? r.data : PADRAO;
    } catch {
      return PADRAO;
    }
  }

  salvar(p: PreferenciasImagens): void {
    const valor = JSON.stringify(p);
    this.banco.insert(s.configuracoes).values({ chave: CHAVE, valor }).onConflictDoUpdate({ target: s.configuracoes.chave, set: { valor } }).run();
  }

  geradasEm(dia: string): number {
    const { uso } = this.ler();
    return uso.dia === dia ? uso.geradas : 0;
  }

  /** Soma `delta` ao contador do dia (negativo devolve uma vaga quando a geração falha). */
  contar(dia: string, delta: number): number {
    const atual = this.ler();
    const geradas = Math.max(0, (atual.uso.dia === dia ? atual.uso.geradas : 0) + delta);
    this.salvar({ ...atual, uso: { dia, geradas } });
    return geradas;
  }
}
