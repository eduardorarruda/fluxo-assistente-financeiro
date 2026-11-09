import { Inject, Injectable } from '@nestjs/common';
import { BANCO } from '../db/banco.module';
import type { Banco } from '../db/conexao';

/**
 * Tudo o que é seu no banco, tabela por tabela. Fica de fora só o que é derivado
 * e se refaz sozinho: os trechos do índice de busca e as sessões dos CLIs.
 * Chaves e tokens nunca estão no banco (moram em arquivos 0600), então não saem aqui.
 */
export const TABELAS_EXPORTADAS = [
  'conexoes', 'contas', 'caixinhas', 'investimentos', 'transacoes', 'faturas', 'historico', 'sincronizacoes',
  'ajustes', 'regras', 'orcamentos', 'metas', 'contas_a_pagar', 'configuracoes',
  'conversas', 'mensagens', 'anexos',
] as const;

export interface Exportacao {
  formato: 'fluxo-exportacao';
  versao: 1;
  geradaEm: string;
  observacao: string;
  tabelas: Record<(typeof TABELAS_EXPORTADAS)[number], unknown[]>;
}

@Injectable()
export class Exportador {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  /** Uma leitura só (transação), para as tabelas baterem entre si. Valores em centavos, datas AAAA-MM-DD. */
  exportar(agora: Date): Exportacao {
    const ler = this.banco.$client.transaction(() =>
      Object.fromEntries(TABELAS_EXPORTADAS.map((t) => [t, this.banco.$client.prepare(`SELECT * FROM "${t}"`).all()])),
    );
    return {
      formato: 'fluxo-exportacao',
      versao: 1,
      geradaEm: agora.toISOString(),
      observacao: 'Valores em centavos (inteiros). Os arquivos dos anexos e imagens ficam na pasta do assistente; aqui vão só os dados deles.',
      tabelas: ler() as Exportacao['tabelas'],
    };
  }
}
