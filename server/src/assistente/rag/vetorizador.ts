import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Transforma texto em vetor (embedding) para a busca por significado. O
 * modelo roda nesta máquina: o extrato nunca sai daqui para virar vetor.
 */

export type TipoDeTexto = 'consulta' | 'documento';

export interface Vetorizador {
  readonly modelo: string;
  readonly dimensao: number;
  /** Vetores normalizados (norma 1), um por texto. */
  vetorizar(textos: string[], tipo: TipoDeTexto): Promise<Float32Array[]>;
}

export interface ProgressoDownload {
  carregado: number;
  total: number;
  arquivo: string;
}

/** O que o Indexador precisa: vetorizar, saber se já baixou e baixar. */
export interface VetorizadorPreparavel extends Vetorizador {
  baixado(): boolean;
  preparar(aoProgredir?: (p: ProgressoDownload) => void): Promise<void>;
}

export const MODELO_PADRAO = 'Xenova/multilingual-e5-small';
const DIMENSAO_E5_SMALL = 384;
/** Textos por chamada ao modelo: limita a memória do ONNX. */
const TAMANHO_DO_LOTE = 16;
/** O e5 foi treinado com estes prefixos; sem eles a qualidade cai. */
const PREFIXO: Record<TipoDeTexto, string> = { consulta: 'query: ', documento: 'passage: ' };

/**
 * Arquivos que a pipeline de feature-extraction lê (dtype q8). O cache do
 * transformers grava em `<pasta>/<modelo>/<arquivo>` e só renomeia o arquivo
 * para o nome final quando o download termina — existir é estar completo.
 */
export const ARQUIVOS_DO_MODELO = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'] as const;

/** Evento de progresso do transformers (um por arquivo). */
export interface EventoDeCarga {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface OpcoesDeCarga {
  pasta: string;
  /** Só `preparar` deixa ir à rede; `vetorizar` lê apenas do disco. */
  permitirRede: boolean;
  aoCarregar?: (evento: EventoDeCarga) => void;
}

/** Textos (já com prefixo) → um vetor normalizado por texto. */
export type FuncaoDeVetores = (textos: string[]) => Promise<Float32Array[]>;
export type CarregadorDeModelo = (modelo: string, opcoes: OpcoesDeCarga) => Promise<FuncaoDeVetores>;

/**
 * Carregador de verdade. `import()` dinâmico: o pacote é pesado (ONNX) e só
 * carrega quando a busca por significado é usada. O `env` do transformers é
 * global ao processo — e este é o único lugar que mexe nele.
 */
export const carregarComTransformers: CarregadorDeModelo = async (modelo, opcoes) => {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = opcoes.pasta;
  env.useFSCache = true;
  env.allowLocalModels = false;
  env.allowRemoteModels = opcoes.permitirRede;
  const extrator = await pipeline('feature-extraction', modelo, {
    dtype: 'q8',
    progress_callback: (info: unknown) => opcoes.aoCarregar?.(info as EventoDeCarga),
  });
  return async (textos) => {
    const tensor = await extrator(textos, { pooling: 'mean', normalize: true });
    const [linhas = 0, colunas = 0] = tensor.dims;
    const dados = tensor.data as Float32Array;
    return Array.from({ length: linhas }, (_, i) => dados.slice(i * colunas, (i + 1) * colunas));
  };
};

export class VetorizadorLocal implements VetorizadorPreparavel {
  readonly dimensao = DIMENSAO_E5_SMALL;
  private funcao: FuncaoDeVetores | null = null;
  private carga: Promise<FuncaoDeVetores> | null = null;

  constructor(
    private readonly pastaModelos: string,
    readonly modelo: string = MODELO_PADRAO,
    private readonly carregador: CarregadorDeModelo = carregarComTransformers,
  ) {}

  /** Os arquivos do modelo já estão na pasta (sem rede). */
  baixado(): boolean {
    return ARQUIVOS_DO_MODELO.every((arquivo) => existsSync(join(this.pastaModelos, this.modelo, arquivo)));
  }

  /** Baixa (se preciso) e carrega o modelo. Só aqui a rede é permitida. */
  async preparar(aoProgredir?: (p: ProgressoDownload) => void): Promise<void> {
    if (this.funcao) return;
    // Uma carga só do disco já em andamento: espera; se ela falhar, tenta com rede.
    if (this.carga) await this.carga.catch(() => undefined);
    if (this.funcao) return;
    await this.carregar(true, aoProgredir ? somadorDeProgresso(aoProgredir) : undefined);
  }

  async vetorizar(textos: string[], tipo: TipoDeTexto): Promise<Float32Array[]> {
    if (textos.length === 0) return [];
    const funcao = this.funcao ?? (await this.carregarDoDisco());
    const vetores: Float32Array[] = [];
    for (let i = 0; i < textos.length; i += TAMANHO_DO_LOTE) {
      const lote = textos.slice(i, i + TAMANHO_DO_LOTE).map((t) => PREFIXO[tipo] + t);
      const resultado = await funcao(lote);
      vetores.push(...this.conferir(resultado, lote.length));
    }
    return vetores;
  }

  private carregarDoDisco(): Promise<FuncaoDeVetores> {
    if (!this.carga && !this.baixado()) {
      return Promise.reject(new Error(
        `O modelo de busca por significado (${this.modelo}) não foi baixado. Ative a busca nos Ajustes do assistente.`,
      ));
    }
    return this.carregar(false);
  }

  /** Uma carga por vez: quem chega no meio espera a mesma promessa. */
  private carregar(permitirRede: boolean, aoCarregar?: (e: EventoDeCarga) => void): Promise<FuncaoDeVetores> {
    if (this.funcao) return Promise.resolve(this.funcao);
    if (!this.carga) {
      this.carga = this.carregador(this.modelo, { pasta: this.pastaModelos, permitirRede, aoCarregar })
        .then((funcao) => {
          this.funcao = funcao;
          return funcao;
        })
        .finally(() => {
          this.carga = null;
        });
    }
    return this.carga;
  }

  private conferir(vetores: Float32Array[], esperados: number): Float32Array[] {
    if (vetores.length !== esperados) {
      throw new Error(`O modelo devolveu ${vetores.length} vetores para ${esperados} textos.`);
    }
    const errado = vetores.find((v) => v.length !== this.dimensao);
    if (errado) throw new Error(`O modelo devolveu vetor de dimensão ${errado.length}; esperava ${this.dimensao}.`);
    return vetores;
  }
}

/**
 * O transformers avisa o progresso arquivo a arquivo; a tela quer um número
 * só. Guarda o último carregado/total de cada arquivo e soma. Total 0 (sem
 * Content-Length) não apaga o total já conhecido.
 */
function somadorDeProgresso(aoProgredir: (p: ProgressoDownload) => void): (e: EventoDeCarga) => void {
  const porArquivo = new Map<string, { carregado: number; total: number }>();
  return (evento) => {
    const arquivo = evento.file;
    if (!arquivo || (evento.status !== 'progress' && evento.status !== 'done')) return;
    const anterior = porArquivo.get(arquivo);
    if (evento.status === 'done') {
      if (!anterior) return;
      const total = Math.max(anterior.total, anterior.carregado);
      porArquivo.set(arquivo, { carregado: total, total });
    } else {
      const carregado = evento.loaded ?? 0;
      porArquivo.set(arquivo, { carregado, total: Math.max(evento.total ?? 0, anterior?.total ?? 0, carregado) });
    }
    let carregado = 0;
    let total = 0;
    for (const p of porArquivo.values()) {
      carregado += p.carregado;
      total += p.total;
    }
    aoProgredir({ carregado, total, arquivo });
  };
}
