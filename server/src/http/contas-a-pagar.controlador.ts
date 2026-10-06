import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { ContasAPagar, type ContaAPagar } from '../servicos/contas-a-pagar';
import { Financas } from '../servicos/financas';
import { dadosContaAPagar, filtroContasAPagar, id, pagamentoConta, parcialContaAPagar, Validar } from './validacao';

/** Resumo do movimento que pagou a conta, para a tela mostrar "pago com …". */
export interface MovimentoDaConta {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  conta: string;
}

/**
 * Contas a pagar. Atrás da `Seguranca` como todo /api (escrita pede X-Fluxo);
 * a regra mora no serviço `ContasAPagar`, que o assistente e a Agenda também usam.
 */
@Controller('api/contas-a-pagar')
export class ContasAPagarControlador {
  constructor(private readonly contas: ContasAPagar, private readonly financas: Financas) {}

  /** Junta a cada conta o movimento que a pagou (nulo se aberta ou se o banco trocou o id). */
  private comMovimento(contas: ContaAPagar[]): (ContaAPagar & { movimento: MovimentoDaConta | null })[] {
    const ligados = new Set(contas.map((c) => c.movimentoId).filter(Boolean));
    const porId = new Map(
      ligados.size ? this.financas.todosOsMovimentos().filter((m) => ligados.has(m.id)).map((m) => [m.id, m]) : [],
    );
    return contas.map((conta) => {
      const m = conta.movimentoId ? porId.get(conta.movimentoId) : undefined;
      return { ...conta, movimento: m ? { id: m.id, data: m.data, descricao: m.descricao, valor: m.valor, conta: m.conta } : null };
    });
  }

  private umaComMovimento(conta: ContaAPagar) {
    return this.comMovimento([conta])[0]!;
  }

  @Get()
  listar(@Query(new Validar(filtroContasAPagar)) f: z.infer<typeof filtroContasAPagar>) {
    return this.comMovimento(this.contas.listar(f));
  }

  /** Faturas de cartão a pagar (fechamento e vencimento), só leitura. */
  @Get('faturas')
  faturas() {
    return this.contas.vencimentosDeCartao();
  }

  @Post()
  criar(@Body(new Validar(dadosContaAPagar)) d: z.infer<typeof dadosContaAPagar>) {
    return this.umaComMovimento(this.contas.criar(d));
  }

  @Post('conciliar')
  @HttpCode(200)
  conciliar() {
    return this.comMovimento(this.contas.conciliar());
  }

  @Patch(':id')
  atualizar(@Param('id', new Validar(id)) contaId: string, @Body(new Validar(parcialContaAPagar)) p: z.infer<typeof parcialContaAPagar>) {
    return this.umaComMovimento(this.contas.atualizar(contaId, p));
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Param('id', new Validar(id)) contaId: string): void {
    this.contas.remover(contaId);
  }

  @Post(':id/paga')
  @HttpCode(200)
  pagar(@Param('id', new Validar(id)) contaId: string, @Body(new Validar(pagamentoConta)) p: z.infer<typeof pagamentoConta>) {
    return this.umaComMovimento(this.contas.marcarPaga(contaId, p));
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  reabrir(@Param('id', new Validar(id)) contaId: string) {
    return this.umaComMovimento(this.contas.reabrir(contaId));
  }

  @Get(':id/candidatos')
  candidatos(@Param('id', new Validar(id)) contaId: string) {
    return this.contas.candidatos(contaId);
  }
}
