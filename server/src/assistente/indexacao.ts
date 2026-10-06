import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Repositorio } from '../dados/repositorio';
import { Financas } from '../servicos/financas';
import { RepositorioAssistente } from './dados/repositorio-assistente';
import { nomeCategoria } from './ferramentas/formato';
import { Indexador } from './rag/indexador';

const VERIFICAR_A_CADA_MS = 30_000;

/**
 * Mantém a busca em dia com o banco: na subida e sempre que o repositório
 * mudar (sincronização, recategorização), reindexa os movimentos — só os
 * que mudaram são vetorizados de novo. Também fecha, na subida, respostas
 * que ficaram "gerando" quando o Fluxo foi desligado.
 */
@Injectable()
export class IndexacaoDeMovimentos implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('IndexacaoDeMovimentos');
  private ultimaVersao = -1;
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly financas: Financas,
    private readonly repositorio: Repositorio,
    private readonly indexador: Indexador,
    private readonly assistente: RepositorioAssistente,
  ) {}

  onApplicationBootstrap(): void {
    const interrompidas = this.assistente.interromperPendentes();
    if (interrompidas) this.log.log(`${interrompidas} resposta(s) interrompida(s) pelo desligamento anterior.`);
    this.indexador.iniciar();
    this.verificar();
    this.temporizador = setInterval(() => this.verificar(), VERIFICAR_A_CADA_MS);
    this.temporizador.unref();
  }

  verificar(): void {
    if (this.repositorio.versao === this.ultimaVersao) return;
    this.ultimaVersao = this.repositorio.versao;
    try {
      this.indexador.indexarMovimentos(
        this.financas.todosOsMovimentos().map((m) => ({
          id: m.id, data: m.data, descricao: m.descricao, estabelecimento: m.estabelecimento, contraparteNome: m.contraparteNome,
          categoria: nomeCategoria(m.categoriaId) ?? '', natureza: m.natureza, valor: m.valor, sentido: m.sentido, conta: m.conta,
          parcela: m.parcela ? { numero: m.parcela.numero, total: m.parcela.total } : null, nota: m.nota,
        })),
      );
    } catch (e) {
      this.log.error(`Não consegui indexar os movimentos: ${(e as Error).message}`);
    }
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }
}
