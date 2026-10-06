import type { Provider } from '@nestjs/common';
import { join } from 'node:path';
import { CONFIG, type Config } from '../config';
import { BANCO } from '../db/banco.module';
import type { Banco } from '../db/conexao';
import { RepositorioDeAcoes } from './acoes/repositorio-acoes';
import { ServicoDeAcoes } from './acoes/servico-acoes';
import { Anexos } from './anexos/anexos';
import { ChavesDeApi } from './apis/chaves-de-api';
import { FABRICA_DE_MODELOS, fabricaDeModelosReal, type FabricaDeModelos } from './apis/fabrica-de-modelos';
import { ModelosAoVivo } from './apis/modelos-ao-vivo';
import { ResolvedorDeClis } from './cli/resolvedor';
import { ServicoDeContas } from './contas';
import { RepositorioAssistente } from './dados/repositorio-assistente';
import { COMANDO_PONTE, Execucoes, RESOLVEDOR_CLI, type ComandoPonte, type ResolvedorCli } from './execucao/execucoes';
import { BUSCADOR, Ferramentas, GERADOR_DE_IMAGENS, TEXTOS_DE_ANEXOS, type Buscador } from './ferramentas/ferramentas';
import { AcoesControlador } from './http/acoes.controlador';
import { AssistenteControlador } from './http/assistente.controlador';
import { FerramentasControlador } from './http/ferramentas.controlador';
import { ImagensControlador } from './http/imagens.controlador';
import { CofreChaveGemini } from './imagens/chave-gemini';
import { RepositorioImagens } from './imagens/repositorio-imagens';
import { ServicoDeImagens } from './imagens/servico-imagens';
import { IndexacaoDeMovimentos } from './indexacao';
import { Indexador } from './rag/indexador';
import { IndiceDeTrechos } from './rag/indice';
import { VetorizadorLocal } from './rag/vetorizador';
import { ServicoAssistente } from './servico-assistente';
import { ServicoDeVoz } from './voz/servico-voz';
import { VozControlador } from './voz/voz.controlador';

/**
 * O assistente entra no AppModule por aqui (e não como módulo próprio) porque
 * usa o `Financas` e o `Repositorio`, que moram no AppModule.
 */

export const CONTROLADORES_ASSISTENTE = [AssistenteControlador, FerramentasControlador, ImagensControlador, VozControlador, AcoesControlador];

/** A ponte MCP compilada fica ao lado deste arquivo (dist/assistente/mcp/ponte.js). */
export const PONTE_COMPILADA = join(__dirname, 'mcp', 'ponte.js');

export const PROVEDORES_ASSISTENTE: Provider[] = [
  RepositorioAssistente,
  RepositorioDeAcoes,
  ServicoDeAcoes,
  ResolvedorDeClis,
  Ferramentas,
  Execucoes,
  Anexos,
  ServicoAssistente,
  ServicoDeContas,
  IndexacaoDeMovimentos,
  RepositorioImagens,
  ServicoDeImagens,
  { provide: CofreChaveGemini, inject: [CONFIG], useFactory: (config: Config) => new CofreChaveGemini(config.pastaAssistente) },
  { provide: GERADOR_DE_IMAGENS, useExisting: ServicoDeImagens },
  { provide: IndiceDeTrechos, inject: [BANCO], useFactory: (banco: Banco) => new IndiceDeTrechos(banco) },
  { provide: VetorizadorLocal, inject: [CONFIG], useFactory: (config: Config) => new VetorizadorLocal(config.pastaModelos) },
  { provide: Indexador, inject: [IndiceDeTrechos, VetorizadorLocal], useFactory: (i: IndiceDeTrechos, v: VetorizadorLocal) => new Indexador(i, v) },
  {
    provide: BUSCADOR,
    inject: [Indexador],
    useFactory: (indexador: Indexador): Buscador => ({
      buscar: (consulta, opcoes) => indexador.buscar(consulta, opcoes),
      modo: () => (indexador.estado().ativo ? 'hibrido' : 'palavras'),
    }),
  },
  { provide: TEXTOS_DE_ANEXOS, useExisting: Anexos },
  { provide: RESOLVEDOR_CLI, inject: [ResolvedorDeClis], useFactory: (r: ResolvedorDeClis): ResolvedorCli => (p) => r.resolver(p) },
  { provide: COMANDO_PONTE, useValue: { comando: process.execPath, args: [PONTE_COMPILADA] } satisfies ComandoPonte },
  { provide: ChavesDeApi, inject: [CONFIG], useFactory: (config: Config) => new ChavesDeApi(config.pastaAssistente) },
  { provide: FABRICA_DE_MODELOS, useValue: fabricaDeModelosReal satisfies FabricaDeModelos },
  { provide: ModelosAoVivo, useFactory: () => new ModelosAoVivo() },
  { provide: ServicoDeVoz, inject: [CONFIG], useFactory: (config: Config) => new ServicoDeVoz(config.pastaModelos) },
];
