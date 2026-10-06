import {
  BadRequestException, Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { NaoEncontrado, Repositorio, type LinhaContaAPagar } from '../dados/repositorio';
import {
  candidatosDaConta, conciliarContas, proximoVencimento, situacaoDaConta,
  type ContaConciliavel, type Repeticao, type SituacaoConta, type VencimentoDeCartao,
} from '../domain/contas-a-pagar';
import { diaDoMes } from '../domain/datas';
import type { Movimento } from '../domain/types';
import { dadosContaAPagar, filtroContasAPagar, pagamentoConta, parcialContaAPagar, Validar } from '../http/validacao';
import { RELOGIO, type Relogio } from '../relogio';
import { Financas } from './financas';
import { Sincronizador } from './sincronizador';

export type { Repeticao, SituacaoConta, VencimentoDeCartao };

export interface ContaAPagar {
  id: string;
  descricao: string;
  /** Centavos, > 0. */
  valor: number;
  /** AAAA-MM-DD. */
  vencimento: string;
  repete: Repeticao;
  categoriaId: string | null;
  /** Texto que identifica o débito no extrato (ex.: "ENEL"); null = usa a descrição. */
  textoNoExtrato: string | null;
  /** atrasada = aberta e vencimento < hoje (calculada, não guardada). */
  situacao: SituacaoConta;
  pagaEm: string | null;
  movimentoId: string | null;
  origem: 'pessoa' | 'assistente';
  nota: string | null;
  criadaEm: string;
  atualizadaEm: string;
}

export interface DadosContaAPagar {
  descricao: string;
  valor: number;
  vencimento: string;
  repete?: Repeticao;
  categoriaId?: string | null;
  textoNoExtrato?: string | null;
  nota?: string | null;
  origem?: 'pessoa' | 'assistente';
}

export interface FiltroContasAPagar {
  de?: string;
  ate?: string;
  situacao?: SituacaoConta;
}

/** Movimento que pode ser o pagamento de uma conta, para a pessoa escolher. */
export interface CandidatoAPagamento {
  id: string;
  data: string;
  descricao: string;
  estabelecimento: string | null;
  valor: number;
  conta: string;
  tipoConta: Movimento['tipoConta'];
  /** Casa texto, valor e janela: a conciliação automática só não ligou porque havia mais de um. */
  forte: boolean;
}

/** Contas pagas de uma vez numa conciliação não passam disto (proteção contra laço). */
const MAXIMO_DE_VOLTAS = 24;
const ESPERA_AVISO_MS = 150;
const MAXIMO_CANDIDATOS = 20;

function validar<T>(esquema: z.ZodType<T>, valor: unknown): T {
  return new Validar(esquema).transform(valor);
}

function recusadosDe(linha: LinhaContaAPagar): string[] {
  try {
    const lista = JSON.parse(linha.recusados) as unknown;
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function paraConciliavel(l: LinhaContaAPagar): ContaConciliavel {
  return {
    id: l.id, descricao: l.descricao, valor: l.valor, vencimento: l.vencimento, textoNoExtrato: l.textoNoExtrato,
    pagaEm: l.pagaEm, movimentoId: l.movimentoId, recusados: recusadosDe(l),
  };
}

/** Só o que veio preenchido: `{ nota: undefined }` não apaga a nota. */
function definidos<T extends object>(parcial: T): Partial<T> {
  return Object.fromEntries(Object.entries(parcial).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A ocorrência gerada continua igual ao que o pagamento criou (ninguém editou). */
function intocada(gerada: LinhaContaAPagar, mae: LinhaContaAPagar): boolean {
  const campos = ['descricao', 'valor', 'repete', 'categoriaId', 'textoNoExtrato', 'nota'] as const;
  return campos.every((k) => gerada[k] === mae[k])
    && gerada.vencimento === proximoVencimento(mae.vencimento, mae.repete, mae.diaDoVencimento);
}

/**
 * Contas a pagar: cadastro, pagamento (à mão ou pela conciliação com o
 * extrato) e aviso de mudança para quem acompanha (a Agenda do Google). As
 * regras moram em `domain/contas-a-pagar.ts`; aqui só a orquestração.
 */
@Injectable()
export class ContasAPagar implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('ContasAPagar');
  private readonly ouvintes = new Set<() => void>();
  private aviso: NodeJS.Timeout | null = null;
  private pararDeOuvir: (() => void) | null = null;

  constructor(
    private readonly repositorio: Repositorio,
    private readonly financas: Financas,
    private readonly sincronizador: Sincronizador,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  onModuleInit(): void {
    this.pararDeOuvir = this.sincronizador.aoTerminar(() => this.conciliarSemFalhar('depois da sincronização'));
  }

  onApplicationBootstrap(): void {
    this.conciliarSemFalhar('ao iniciar');
  }

  onModuleDestroy(): void {
    this.pararDeOuvir?.();
    if (this.aviso) clearTimeout(this.aviso);
    this.aviso = null;
  }

  // ---------------------------------------------------------------- leitura

  listar(f: FiltroContasAPagar = {}): ContaAPagar[] {
    const filtro = validar(filtroContasAPagar, f);
    const hoje = this.relogio.hoje();
    return this.repositorio
      .contasAPagar()
      .map((l) => this.paraConta(l, hoje))
      .filter((c) => (!filtro.de || c.vencimento >= filtro.de) && (!filtro.ate || c.vencimento <= filtro.ate))
      .filter((c) => !filtro.situacao || c.situacao === filtro.situacao);
  }

  obter(id: string): ContaAPagar | null {
    const linha = this.repositorio.contaAPagar(id);
    return linha ? this.paraConta(linha, this.relogio.hoje()) : null;
  }

  /** Faturas de cartão a pagar, só para mostrar junto (nunca viram conta a pagar). */
  vencimentosDeCartao(): VencimentoDeCartao[] {
    return this.financas.faturasAPagar();
  }

  /** Movimentos que podem ter pago esta conta, do mais provável ao menos. */
  candidatos(id: string): CandidatoAPagamento[] {
    const linha = this.linha(id);
    const todas = this.repositorio.contasAPagar();
    const ligados = new Set(todas.filter((c) => c.id !== id && c.movimentoId).map((c) => c.movimentoId!));
    const movimentos = this.financas.todosOsMovimentos();
    const conta = paraConciliavel(linha);
    // "Provável" segue o critério da conciliação: o que a pessoa recusou ao reabrir nunca é sugerido.
    const fortes = new Set(candidatosDaConta(conta, movimentos, ligados, 'estrito').map((m) => m.id));
    return candidatosDaConta(conta, movimentos, ligados, 'amplo')
      .slice(0, MAXIMO_CANDIDATOS)
      .map((m) => ({
        id: m.id, data: m.data, descricao: m.descricao, estabelecimento: m.estabelecimento, valor: m.valor,
        conta: m.conta, tipoConta: m.tipoConta, forte: fortes.has(m.id),
      }));
  }

  // ---------------------------------------------------------------- escrita

  criar(d: DadosContaAPagar): ContaAPagar {
    const dados = validar(dadosContaAPagar, d);
    const agora = this.relogio.agora().toISOString();
    const linha: LinhaContaAPagar = {
      id: randomUUID(), ...dados, diaDoVencimento: diaDoMes(dados.vencimento), pagaEm: null, movimentoId: null,
      recusados: '[]', anteriorId: null, criadaEm: agora, atualizadaEm: agora,
    };
    this.repositorio.salvarContasAPagar([linha]);
    this.conciliarSemFalhar('ao criar');
    this.avisar();
    return this.obter(linha.id)!;
  }

  atualizar(id: string, parcial: Partial<DadosContaAPagar>): ContaAPagar {
    const atual = this.linha(id);
    const p = definidos(validar(parcialContaAPagar, parcial ?? {}));
    const nova: LinhaContaAPagar = {
      ...atual, ...p,
      diaDoVencimento: p.vencimento ? diaDoMes(p.vencimento) : atual.diaDoVencimento,
      atualizadaEm: this.relogio.agora().toISOString(),
    };
    this.repositorio.salvarContasAPagar([nova]);
    this.conciliarSemFalhar('ao editar');
    this.avisar();
    return this.obter(id)!;
  }

  /**
   * Marca como paga — com o movimento que pagou (escolhido pela pessoa) ou só
   * com a data. Conta que repete ganha a ocorrência seguinte (uma só, mesmo
   * se marcada de novo).
   */
  marcarPaga(id: string, p: { movimentoId?: string | null; data?: string } = {}): ContaAPagar {
    const atual = this.linha(id);
    const pagamento = validar(pagamentoConta, p ?? {});
    const movimentoId = pagamento.movimentoId ?? null;
    const movimento = movimentoId ? this.movimentoQuePaga(id, movimentoId) : null;
    const agora = this.relogio.agora().toISOString();
    const paga: LinhaContaAPagar = {
      ...atual,
      pagaEm: pagamento.data ?? movimento?.data ?? this.relogio.hoje(),
      movimentoId,
      // Escolher o movimento à mão desfaz uma recusa anterior dele.
      recusados: JSON.stringify(recusadosDe(atual).filter((r) => r !== movimentoId)),
      atualizadaEm: agora,
    };
    const proxima = this.proximaOcorrencia(atual, this.repositorio.contasAPagar(), agora);
    this.repositorio.salvarContasAPagar(proxima ? [paga, proxima] : [paga]);
    if (proxima) this.conciliarSemFalhar('ao pagar');
    this.avisar();
    return this.obter(id)!;
  }

  /**
   * Volta a conta para aberta. O movimento que estava ligado vira "recusado"
   * (a conciliação não o escolhe de novo), e a ocorrência seguinte que nasceu
   * do pagamento some — se ainda estiver aberta e ninguém tiver mexido nela.
   */
  reabrir(id: string): ContaAPagar {
    const atual = this.linha(id);
    if (!atual.pagaEm) return this.obter(id)!;
    const recusados = atual.movimentoId ? [...new Set([...recusadosDe(atual), atual.movimentoId])] : recusadosDe(atual);
    const aberta: LinhaContaAPagar = {
      ...atual, pagaEm: null, movimentoId: null, recusados: JSON.stringify(recusados), atualizadaEm: this.relogio.agora().toISOString(),
    };
    const geradas = this.repositorio
      .contasAPagar()
      .filter((c) => c.anteriorId === id && !c.pagaEm && intocada(c, atual))
      .map((c) => c.id);
    this.repositorio.salvarContasAPagar([aberta], geradas);
    this.avisar();
    return this.obter(id)!;
  }

  remover(id: string): void {
    this.linha(id);
    this.repositorio.salvarContasAPagar([], [id]);
    this.avisar();
  }

  /** Roda a conciliação com os movimentos atuais; devolve as que foram pagas agora. */
  conciliar(): ContaAPagar[] {
    const movimentos = this.financas.todosOsMovimentos();
    const pagas: string[] = [];
    for (let volta = 0; volta < MAXIMO_DE_VOLTAS; volta++) {
      const linhas = this.repositorio.contasAPagar();
      const ligacoes = conciliarContas(linhas.map(paraConciliavel), movimentos);
      if (ligacoes.length === 0) break;
      const porId = new Map(linhas.map((l) => [l.id, l]));
      const agora = this.relogio.agora().toISOString();
      const salvar: LinhaContaAPagar[] = [];
      for (const ligacao of ligacoes) {
        const linha = porId.get(ligacao.contaId)!;
        salvar.push({ ...linha, pagaEm: ligacao.data, movimentoId: ligacao.movimentoId, atualizadaEm: agora });
        const proxima = this.proximaOcorrencia(linha, [...linhas, ...salvar], agora);
        if (proxima) salvar.push(proxima);
        pagas.push(linha.id);
      }
      this.repositorio.salvarContasAPagar(salvar);
    }
    if (pagas.length > 0) {
      this.log.log(`${pagas.length} conta(s) a pagar marcada(s) como paga(s) pelo extrato`);
      this.avisar();
    }
    const hoje = this.relogio.hoje();
    return pagas.map((id) => this.repositorio.contaAPagar(id)).filter((l) => l !== undefined).map((l) => this.paraConta(l, hoje));
  }

  /** Avisa quem quiser (a Agenda) que algo mudou; devolve a função de cancelar. */
  aoMudar(cb: () => void): () => void {
    this.ouvintes.add(cb);
    return () => {
      this.ouvintes.delete(cb);
    };
  }

  // --------------------------------------------------------------- internos

  private linha(id: string): LinhaContaAPagar {
    const linha = this.repositorio.contaAPagar(id);
    if (!linha) throw new NaoEncontrado('Conta a pagar não encontrada.');
    return linha;
  }

  private paraConta(l: LinhaContaAPagar, hoje: string): ContaAPagar {
    return {
      id: l.id, descricao: l.descricao, valor: l.valor, vencimento: l.vencimento, repete: l.repete,
      categoriaId: l.categoriaId, textoNoExtrato: l.textoNoExtrato, situacao: situacaoDaConta(l, hoje),
      pagaEm: l.pagaEm, movimentoId: l.movimentoId, origem: l.origem, nota: l.nota,
      criadaEm: l.criadaEm, atualizadaEm: l.atualizadaEm,
    };
  }

  /** O movimento escolhido existe, é um gasto e não pagou outra conta. */
  private movimentoQuePaga(contaId: string, movimentoId: string): Movimento {
    const movimento = this.financas.movimento(movimentoId);
    if (!movimento) throw new BadRequestException('Esse movimento não está no extrato.');
    if (movimento.natureza !== 'DESPESA') {
      throw new BadRequestException('Só um gasto paga uma conta: transferência, investimento ou pagamento de fatura não.');
    }
    const outra = this.repositorio.contasAPagar().find((c) => c.id !== contaId && c.movimentoId === movimentoId);
    if (outra) throw new BadRequestException(`Esse movimento já pagou "${outra.descricao}".`);
    return movimento;
  }

  /** A ocorrência seguinte de uma conta que repete, se ainda não existe. */
  private proximaOcorrencia(linha: LinhaContaAPagar, todas: readonly LinhaContaAPagar[], agora: string): LinhaContaAPagar | null {
    const vencimento = proximoVencimento(linha.vencimento, linha.repete, linha.diaDoVencimento);
    if (!vencimento || todas.some((c) => c.anteriorId === linha.id)) return null;
    return {
      ...linha, id: randomUUID(), vencimento, pagaEm: null, movimentoId: null, recusados: '[]',
      anteriorId: linha.id, criadaEm: agora, atualizadaEm: agora,
    };
  }

  private conciliarSemFalhar(quando: string): void {
    try {
      this.conciliar();
    } catch (e) {
      this.log.error(`Conciliação ${quando}: ${(e as Error).message}`);
    }
  }

  /** Junta mudanças seguidas num aviso só. */
  private avisar(): void {
    if (this.aviso) clearTimeout(this.aviso);
    this.aviso = setTimeout(() => {
      this.aviso = null;
      for (const ouvinte of this.ouvintes) {
        try {
          ouvinte();
        } catch (e) {
          this.log.error(`Aviso de mudança: ${(e as Error).message}`);
        }
      }
    }, ESPERA_AVISO_MS);
    this.aviso.unref();
  }
}
