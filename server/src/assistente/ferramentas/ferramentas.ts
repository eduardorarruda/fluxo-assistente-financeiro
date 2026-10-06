import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';
import { Financas } from '../../servicos/financas';
import { cortar } from '../cli/comum';
import { ServicoDeAcoes } from '../acoes/servico-acoes';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import type { EfeitoFerramenta } from './definicao';
import {
  criarCatalogo, ErroDeFerramenta, type Buscador, type ContextoFerramenta, type Definicao, type GeradorDeImagens, type TextosDeAnexos,
} from './catalogo';

export type { Buscador, ContextoFerramenta, GeradorDeImagens, TextosDeAnexos };

export const BUSCADOR = Symbol('BUSCADOR');
export const TEXTOS_DE_ANEXOS = Symbol('TEXTOS_DE_ANEXOS');
export const GERADOR_DE_IMAGENS = Symbol('GERADOR_DE_IMAGENS');

/** Resposta grande demais enche o contexto do modelo; acima disto, corta e avisa. */
const LIMITE_RESPOSTA = 60_000;

export interface DescricaoFerramenta {
  nome: string;
  descricao: string;
  inputSchema: Record<string, unknown> & { type: 'object' };
  /** Vira `readOnlyHint`/`destructiveHint` na ponte MCP. */
  efeito: EfeitoFerramenta;
}

export interface RespostaFerramenta {
  ok: boolean;
  /** JSON (sucesso) ou a mensagem de erro, para o modelo ler. */
  texto: string;
}

/**
 * Executa as ferramentas do agente. Valida a entrada (o modelo erra
 * formato), nunca lança: erro vira resposta legível, para o modelo poder
 * corrigir e chamar de novo.
 */
@Injectable()
export class Ferramentas {
  private readonly log = new Logger('Ferramentas');
  private readonly catalogo: Map<string, Definicao>;

  constructor(
    financas: Financas,
    assistente: RepositorioAssistente,
    @Inject(BUSCADOR) buscador: Buscador,
    @Inject(TEXTOS_DE_ANEXOS) textos: TextosDeAnexos,
    @Optional() @Inject(GERADOR_DE_IMAGENS) imagens?: GeradorDeImagens,
    @Optional() acoes?: ServicoDeAcoes,
  ) {
    this.catalogo = new Map(criarCatalogo({ financas, assistente, buscador, textos, imagens, acoes }).map((d) => [d.nome, d]));
  }

  lista(): DescricaoFerramenta[] {
    return [...this.catalogo.values()].map((d) => ({
      nome: d.nome,
      descricao: d.descricao,
      inputSchema: esquemaJson(d.entrada),
      efeito: d.efeito ?? 'leitura',
    }));
  }

  existe(nome: string): boolean {
    return this.catalogo.has(nome);
  }

  rotulo(nome: string, entrada: unknown): string {
    const d = this.catalogo.get(nome);
    if (!d) return nome;
    const r = d.entrada.safeParse(entrada ?? {});
    try {
      return d.rotulo(r.success ? r.data : {});
    } catch {
      return nome;
    }
  }

  async executar(nome: string, entrada: unknown, ctx: ContextoFerramenta): Promise<RespostaFerramenta> {
    const d = this.catalogo.get(nome);
    if (!d) return { ok: false, texto: `Ferramenta desconhecida: ${nome}.` };
    const r = d.entrada.safeParse(entrada ?? {});
    if (!r.success) {
      const motivo = r.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
      return { ok: false, texto: `Entrada inválida — ${motivo}` };
    }
    try {
      const resultado = await d.executar(r.data, ctx);
      return { ok: true, texto: serializar(resultado) };
    } catch (e) {
      if (e instanceof ErroDeFerramenta) return { ok: false, texto: e.message };
      this.log.error(`Ferramenta ${nome} falhou: ${(e as Error).stack ?? String(e)}`);
      return { ok: false, texto: 'A ferramenta falhou do lado do Fluxo. Tente outra abordagem.' };
    }
  }
}

function esquemaJson(esquema: z.ZodType): DescricaoFerramenta['inputSchema'] {
  const { $schema: _, ...resto } = z.toJSONSchema(esquema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return { ...resto, type: 'object' };
}

function serializar(valor: unknown): string {
  const texto = JSON.stringify(valor);
  if (texto.length <= LIMITE_RESPOSTA) return texto;
  return `${cortar(texto, LIMITE_RESPOSTA)}\n[resposta cortada: use filtros ou um limite menor]`;
}
