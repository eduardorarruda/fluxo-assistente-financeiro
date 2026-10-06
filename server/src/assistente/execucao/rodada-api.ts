import type { ChavesDeApi } from '../apis/chaves-de-api';
import type { FabricaDeModelos, ModeloDeLinguagem } from '../apis/fabrica-de-modelos';
import { modeloPadraoDaApi, PROVEDORES_API } from '../apis/provedores-api';
import { cortar } from '../cli/comum';
import type { EventoAgente } from '../cli/tipos';
import type { Ferramentas } from '../ferramentas/ferramentas';
import type { ContaSalva } from '../tipos-api';
import { executarApi, type ResultadoApi } from './executor-api';
import type { FalhaCli, ResultadoCli } from './executor-cli';
import { INSTRUCOES, montarPrompt, type AnexoNoPrompt } from './prompt';

/**
 * O lado das contas por API do `Execucoes`: acha a chave, cria o modelo e
 * roda a resposta (ou o teste de conexão) pelo `executarApi`. Sem ponte MCP,
 * sem pasta de execução, sem sessão de CLI: o histórico vai inteiro a cada vez.
 */

export interface ContaApiPronta {
  conta: ContaSalva;
  chave: string;
  modelo: ModeloDeLinguagem;
  idDoModelo: string;
}

export interface PerguntaApi {
  conversaId: string;
  texto: string;
  hoje: string;
  anexos: readonly (AnexoNoPrompt & { caminho?: string })[];
  historico: readonly { papel: 'usuario' | 'assistente'; texto: string }[];
  voz?: boolean;
  tempoMaximoMs: number;
  sinal: AbortSignal;
  aoEvento: (e: EventoAgente) => void;
}

export interface ResultadoDoTeste {
  ok: boolean;
  mensagem: string;
  duracaoMs: number;
}

const TEMPO_TESTE_MS = 30_000;

export class RodadaApi {
  constructor(
    private readonly chaves: ChavesDeApi,
    private readonly fabrica: FabricaDeModelos,
    private readonly ferramentas: Ferramentas,
  ) {}

  /** A chave e o modelo (o escolhido, ou o principal do catálogo) — ou por que não dá para rodar. */
  preparar(conta: ContaSalva, modelo: string | null): ContaApiPronta | { erro: FalhaCli } {
    if (!conta.ativo) return { erro: { codigo: 'desconhecido', mensagem: `A conta “${conta.nome}” está desligada nos Ajustes do assistente.` } };
    const chave = this.chaves.ler(conta.id);
    if (!chave) return { erro: { codigo: 'autenticacao', mensagem: `A conta “${conta.nome}” está sem a chave da API. Cole a chave nos Ajustes do assistente.` } };
    const idDoModelo = modelo ?? modeloPadraoDaApi(conta.provedor);
    if (!nomeDeModeloDeApi(idDoModelo)) {
      return { erro: { codigo: 'desconhecido', mensagem: `O nome de modelo “${idDoModelo}” não vale para a API (só letras, números, ".", "-", "_" e ":"). Escolha outro modelo.` } };
    }
    return { conta, chave, idDoModelo, modelo: this.fabrica(conta.provedor, chave, idDoModelo) };
  }

  /** Uma resposta da conversa. O turno atual passa por `montarPrompt` (data, anexos, modo voz), como no CLI. */
  async responder(pronta: ContaApiPronta, p: PerguntaApi): Promise<ResultadoCli> {
    const r = await executarApi({
      provedor: pronta.conta.provedor, modelo: pronta.modelo, idDoModelo: pronta.idDoModelo, chave: pronta.chave,
      instrucoes: INSTRUCOES, historico: p.historico,
      turno: montarPrompt({ texto: p.texto, hoje: p.hoje, anexos: p.anexos, historico: [], voz: p.voz }),
      imagens: p.anexos.filter((a) => a.tipo === 'imagem' && a.caminho).map((a) => a.caminho!),
      ferramentas: this.ferramentas, conversaId: p.conversaId, tempoMaximoMs: p.tempoMaximoMs, sinal: p.sinal, aoEvento: p.aoEvento,
    });
    return comoResultadoCli(r);
  }

  /** Teste de conexão dos Ajustes: um pedido mínimo, sem ferramentas, sem novas tentativas. */
  async testar(conta: ContaSalva): Promise<ResultadoDoTeste> {
    const inicio = Date.now();
    const pronta = this.preparar(conta, conta.modelo);
    if ('erro' in pronta) return { ok: false, mensagem: pronta.erro.mensagem, duracaoMs: Date.now() - inicio };
    let texto = '';
    const r = await executarApi({
      provedor: conta.provedor, modelo: pronta.modelo, idDoModelo: pronta.idDoModelo, chave: pronta.chave,
      instrucoes: 'Teste de conexão do Fluxo: responda apenas OK.', historico: [], turno: 'Responda apenas com a palavra OK.',
      imagens: [], ferramentas: null, conversaId: null, tempoMaximoMs: TEMPO_TESTE_MS, tentativas: 0, sinal: new AbortController().signal,
      aoEvento: (e) => {
        if (e.tipo === 'texto') texto += e.delta;
      },
    });
    const duracaoMs = Date.now() - inicio;
    if (r.falha) return { ok: false, mensagem: r.falha.mensagem, duracaoMs };
    if (!texto.trim()) return { ok: false, mensagem: `A ${PROVEDORES_API[conta.provedor].nome} não respondeu nada.`, duracaoMs };
    return { ok: true, mensagem: `Funcionando: respondeu “${cortar(texto.trim(), 40)}”.`, duracaoMs };
  }
}

/** O `Execucoes.finalizar` entende o resultado do CLI; a rodada por API fala a mesma língua. */
function comoResultadoCli(r: ResultadoApi): ResultadoCli {
  return {
    fim: { codigo: null, sinal: null, stderr: '', duracaoMs: r.duracaoMs, motivo: r.motivo, erroAoIniciar: null },
    sessaoPerdida: false,
    falha: r.falha,
  };
}

/**
 * O nome do modelo entra no caminho da URL do provedor (o Gemini monta
 * `/models/<nome>:streamGenerateContent`): sem "/" nem "..", um nome digitado
 * não leva a chave para outro endpoint do mesmo host.
 */
export function nomeDeModeloDeApi(nome: string): boolean {
  return /^[A-Za-z0-9][\w.:-]*$/.test(nome) && !nome.includes('..');
}
