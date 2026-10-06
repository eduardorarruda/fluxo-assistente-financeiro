import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CONFIG, type Config } from '../config';
import { randomUUID } from 'node:crypto';
import { NaoEncontrado, Repositorio } from '../dados/repositorio';
import { chaveDeDescricao } from '../domain/texto';
import type { Mes } from '../domain/types';
import { Financas } from '../servicos/financas';
import { PluggyNaoConfigurada, Sincronizador } from '../servicos/sincronizador';
import { ErroDeIntegracao } from './erros';
import {
  ajusteMovimento, categoria, configuracoes, consultaMes, filtroMovimentos, id, idConexao, limiteOrcamento, meta, novaConexao,
  novaRegra, remocao, sincronizar, tokenConexao, Validar,
} from './validacao';
import { Vigia } from './vigia';
import type { z } from 'zod';

/** Erros de integração viram 502 com a mensagem amigável que o sincronizador já montou. */
async function integracao<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof NaoEncontrado || e instanceof PluggyNaoConfigurada) throw e;
    throw new ErroDeIntegracao((e as Error).message);
  }
}

@Controller('api')
export class EstadoControlador {
  constructor(
    private readonly financas: Financas,
    private readonly sincronizador: Sincronizador,
    private readonly repositorio: Repositorio,
    private readonly vigia: Vigia,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('saude')
  saude() {
    return { ok: true };
  }

  @Post('ping')
  @HttpCode(204)
  ping(): void {
    this.vigia.sinal();
  }

  @Get('estado')
  estado() {
    return {
      ...this.financas.estado(this.sincronizador.pluggyConfigurada, (c) => this.sincronizador.sincronizando(c)),
      pluggySandbox: this.config.pluggy?.incluirSandbox ?? false,
    };
  }

  @Get('alertas')
  alertas() {
    return this.financas.alertas();
  }

  @Get('categorias')
  categorias() {
    return this.financas.categorias();
  }

  @Put('configuracoes')
  salvarConfiguracoes(@Body(new Validar(configuracoes)) corpo: z.infer<typeof configuracoes>) {
    return this.repositorio.salvarConfiguracoes(corpo);
  }
}

@Controller('api')
export class PainelControlador {
  constructor(private readonly financas: Financas) {}

  private mes(q: { mes?: Mes }): Mes {
    return q.mes ?? this.financas.mesAtual();
  }

  @Get('visao-geral')
  visaoGeral(@Query(new Validar(consultaMes)) q: z.infer<typeof consultaMes>) {
    return this.financas.visaoGeral(this.mes(q));
  }

  @Get('fluxo')
  fluxo(@Query(new Validar(consultaMes)) q: z.infer<typeof consultaMes>) {
    return this.financas.fluxo(this.mes(q));
  }

  @Get('insights')
  insights(@Query(new Validar(consultaMes)) q: z.infer<typeof consultaMes>) {
    return this.financas.insights(this.mes(q));
  }

  @Get('orcamento')
  orcamento(@Query(new Validar(consultaMes)) q: z.infer<typeof consultaMes>) {
    return this.financas.orcamento(this.mes(q));
  }

  @Get('cartoes')
  cartoes() {
    return this.financas.cartoes();
  }

  @Get('cartoes/:contaId/faturas/:mes')
  fatura(@Param('contaId', new Validar(id)) contaId: string, @Param('mes', new Validar(consultaMes.shape.mes.unwrap())) mes: Mes) {
    return this.financas.itensDaFatura(contaId, mes);
  }

  @Get('caixinhas')
  caixinhas() {
    return this.financas.caixinhas();
  }

  @Get('recorrencias')
  recorrencias() {
    return this.financas.recorrencias();
  }
}

@Controller('api/movimentos')
export class MovimentosControlador {
  constructor(private readonly financas: Financas, private readonly repositorio: Repositorio) {}

  @Get()
  listar(@Query(new Validar(filtroMovimentos)) f: z.infer<typeof filtroMovimentos>) {
    return this.financas.movimentos(f);
  }

  @Patch(':id')
  ajustar(@Param('id', new Validar(id)) transacaoId: string, @Body(new Validar(ajusteMovimento)) a: z.infer<typeof ajusteMovimento>) {
    const { regra, ...ajuste } = a;
    this.repositorio.salvarAjuste(transacaoId, ajuste);
    if (regra && a.categoriaId) {
      const m = this.financas.movimento(transacaoId);
      this.repositorio.criarRegra({ id: randomUUID(), texto: regra.texto, categoriaId: a.categoriaId, sentido: m?.sentido ?? null });
    }
    const atualizado = this.financas.movimento(transacaoId);
    if (!atualizado) throw new NaoEncontrado('Transação não encontrada.');
    return atualizado;
  }

  /** Sugestão de texto para a regra: o "nome limpo" do estabelecimento. */
  @Get(':id/sugestao-de-regra')
  sugestao(@Param('id', new Validar(id)) transacaoId: string) {
    const m = this.financas.movimento(transacaoId);
    if (!m) throw new NaoEncontrado('Transação não encontrada.');
    return { texto: chaveDeDescricao(m.estabelecimento || m.descricao) || m.descricao };
  }
}

@Controller('api/regras')
export class RegrasControlador {
  constructor(private readonly repositorio: Repositorio) {}

  @Get()
  listar() {
    return this.repositorio.instantaneo().regras.sort((a, b) => a.prioridade - b.prioridade);
  }

  @Post()
  criar(@Body(new Validar(novaRegra)) r: z.infer<typeof novaRegra>) {
    return this.repositorio.criarRegra({ id: randomUUID(), ...r });
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Param('id', new Validar(id)) regraId: string): void {
    this.repositorio.removerRegra(regraId);
  }
}

@Controller('api/orcamento')
export class OrcamentoControlador {
  constructor(private readonly repositorio: Repositorio) {}

  @Put(':categoriaId')
  @HttpCode(204)
  definir(@Param('categoriaId', new Validar(categoria)) categoriaId: string, @Body(new Validar(limiteOrcamento)) c: z.infer<typeof limiteOrcamento>): void {
    this.repositorio.definirOrcamento(categoriaId, c.limite);
  }
}

@Controller('api/metas')
export class MetasControlador {
  constructor(private readonly financas: Financas, private readonly repositorio: Repositorio) {}

  @Get()
  listar() {
    return this.financas.metas();
  }

  @Post()
  criar(@Body(new Validar(meta)) m: z.infer<typeof meta>) {
    const nova = { id: randomUUID(), ...m };
    this.repositorio.salvarMeta(nova);
    return this.financas.metas().find((x) => x.id === nova.id);
  }

  @Put(':id')
  atualizar(@Param('id', new Validar(id)) metaId: string, @Body(new Validar(meta)) m: z.infer<typeof meta>) {
    if (!this.repositorio.instantaneo().metas.some((x) => x.id === metaId)) throw new NaoEncontrado('Meta não encontrada.');
    this.repositorio.salvarMeta({ id: metaId, ...m });
    return this.financas.metas().find((x) => x.id === metaId);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Param('id', new Validar(id)) metaId: string): void {
    this.repositorio.removerMeta(metaId);
  }
}

@Controller('api')
export class ConexoesControlador {
  constructor(private readonly sincronizador: Sincronizador, private readonly repositorio: Repositorio) {}

  @Post('conexoes/token')
  async token(@Body(new Validar(tokenConexao)) c: z.infer<typeof tokenConexao>) {
    return { token: await integracao(() => this.sincronizador.criarTokenDeConexao(c.itemId)) };
  }

  @Post('conexoes')
  async conectar(@Body(new Validar(novaConexao)) c: z.infer<typeof novaConexao>) {
    return integracao(() => this.sincronizador.registrarConexaoPluggy(c.itemId));
  }

  @Post('conexoes/:id/sincronizar')
  async sincronizar(@Param('id', new Validar(idConexao)) conexaoId: string, @Body(new Validar(sincronizar)) c: z.infer<typeof sincronizar>) {
    return integracao(() => this.sincronizador.sincronizar(conexaoId, c.pedirAoBanco));
  }

  @Delete('conexoes/:id')
  @HttpCode(204)
  async remover(@Param('id', new Validar(idConexao)) conexaoId: string, @Query(new Validar(remocao)) q: z.infer<typeof remocao>) {
    await integracao(() => this.sincronizador.removerConexao(conexaoId, q.revogar === '1'));
  }

  @Get('sincronizacoes')
  historico() {
    return this.repositorio.ultimasSincronizacoes(30);
  }

  @Post('demonstracao')
  async ativarDemo() {
    return integracao(() => this.sincronizador.ativarDemonstracao());
  }

  @Delete('demonstracao')
  @HttpCode(204)
  removerDemo(): void {
    this.sincronizador.removerDemonstracao();
  }
}
