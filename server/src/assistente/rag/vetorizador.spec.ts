import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizado } from './testing/vetorizador-falso';
import {
  ARQUIVOS_DO_MODELO, MODELO_PADRAO, VetorizadorLocal,
  type CarregadorDeModelo, type EventoDeCarga, type FuncaoDeVetores, type OpcoesDeCarga,
} from './vetorizador';

const DIM = 384;

function vetorQualquer(semente: number): Float32Array {
  return normalizado(Array.from({ length: DIM }, (_, i) => ((i * 31 + semente) % 7) + 1));
}

/** Carregador falso: registra as cargas e as chamadas à função de vetores. */
function carregadorFalso(opcoes: { eventos?: EventoDeCarga[]; falhar?: Error; dimensao?: number } = {}) {
  const cargas: OpcoesDeCarga[] = [];
  const lotes: string[][] = [];
  const funcao: FuncaoDeVetores = async (textos) => {
    lotes.push(textos);
    return textos.map((_, i) => (opcoes.dimensao ? new Float32Array(opcoes.dimensao) : vetorQualquer(i)));
  };
  const carregar: CarregadorDeModelo = async (_modelo, o) => {
    cargas.push(o);
    await new Promise((r) => setImmediate(r));
    for (const e of opcoes.eventos ?? []) o.aoCarregar?.(e);
    if (opcoes.falhar) throw opcoes.falhar;
    return funcao;
  };
  return { carregar, cargas, lotes };
}

describe('VetorizadorLocal', () => {
  let pasta: string;

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-modelos-'));
  });

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  function simularDownload(modelo = MODELO_PADRAO): void {
    for (const arquivo of ARQUIVOS_DO_MODELO) {
      const caminho = join(pasta, modelo, arquivo);
      mkdirSync(dirname(caminho), { recursive: true });
      writeFileSync(caminho, 'x');
    }
  }

  it('usa o e5-small multilíngue, 384 dimensões, por padrão', () => {
    const v = new VetorizadorLocal(pasta);
    expect(v.modelo).toBe('Xenova/multilingual-e5-small');
    expect(v.dimensao).toBe(384);
  });

  it('baixado: só quando todos os arquivos do modelo estão na pasta', () => {
    const v = new VetorizadorLocal(pasta);
    expect(v.baixado()).toBe(false);
    simularDownload();
    expect(v.baixado()).toBe(true);
    rmSync(join(pasta, MODELO_PADRAO, ARQUIVOS_DO_MODELO[0]!));
    expect(v.baixado()).toBe(false);
  });

  it('vetorizar sem o modelo baixado falha com mensagem clara e não toca a rede', async () => {
    const falso = carregadorFalso();
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    await expect(v.vetorizar(['oi'], 'consulta')).rejects.toThrow(/não foi baixado/);
    expect(falso.cargas).toHaveLength(0);
  });

  it('vetorizar com o modelo baixado carrega do disco, sem rede', async () => {
    simularDownload();
    const falso = carregadorFalso();
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    const vetores = await v.vetorizar(['mercado'], 'documento');
    expect(vetores).toHaveLength(1);
    expect(vetores[0]).toBeInstanceOf(Float32Array);
    expect(falso.cargas).toEqual([expect.objectContaining({ pasta, permitirRede: false })]);
  });

  it('põe os prefixos do e5: "query: " na consulta e "passage: " no documento', async () => {
    simularDownload();
    const falso = carregadorFalso();
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    await v.vetorizar(['comida fora'], 'consulta');
    await v.vetorizar(['iFood pizza'], 'documento');
    expect(falso.lotes).toEqual([['query: comida fora'], ['passage: iFood pizza']]);
  });

  it('processa em lotes de 16 e devolve um vetor por texto, na ordem', async () => {
    simularDownload();
    const falso = carregadorFalso();
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    const textos = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const vetores = await v.vetorizar(textos, 'documento');
    expect(falso.lotes.map((l) => l.length)).toEqual([16, 16, 8]);
    expect(falso.lotes[2]![7]).toBe('passage: t39');
    expect(vetores).toHaveLength(40);
    expect(falso.cargas).toHaveLength(1);
  });

  it('lista vazia não carrega o modelo', async () => {
    const falso = carregadorFalso();
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    expect(await v.vetorizar([], 'documento')).toEqual([]);
    expect(falso.cargas).toHaveLength(0);
  });

  it('recusa vetor com dimensão errada', async () => {
    simularDownload();
    const falso = carregadorFalso({ dimensao: 3 });
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    await expect(v.vetorizar(['x'], 'documento')).rejects.toThrow(/dimensão/);
  });

  it('preparar permite a rede, é idempotente e chamadas simultâneas compartilham a carga', async () => {
    const falso = carregadorFalso();
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    await Promise.all([v.preparar(), v.preparar(), v.preparar()]);
    await v.preparar();
    expect(falso.cargas).toHaveLength(1);
    expect(falso.cargas[0]).toMatchObject({ pasta, permitirRede: true });
    await v.vetorizar(['x'], 'consulta');
    expect(falso.cargas).toHaveLength(1);
  });

  it('preparar que falhou pode ser tentado de novo', async () => {
    const ruim = carregadorFalso({ falhar: new Error('sem internet') });
    let atual = ruim.carregar;
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, (m, o) => atual(m, o));
    await expect(v.preparar()).rejects.toThrow('sem internet');
    const bom = carregadorFalso();
    atual = bom.carregar;
    await v.preparar();
    expect(bom.cargas).toHaveLength(1);
  });

  it('soma o progresso de todos os arquivos', async () => {
    const eventos: EventoDeCarga[] = [
      { status: 'initiate', file: 'config.json' },
      { status: 'progress', file: 'config.json', loaded: 50, total: 100 },
      { status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 1000, total: 4000 },
      { status: 'progress_total', loaded: 1, total: 1 },
      { status: 'done', file: 'config.json' },
      { status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 3000, total: 0 },
    ];
    const falso = carregadorFalso({ eventos });
    const v = new VetorizadorLocal(pasta, MODELO_PADRAO, falso.carregar);
    const recebidos: unknown[] = [];
    await v.preparar((p) => recebidos.push(p));
    expect(recebidos).toEqual([
      { carregado: 50, total: 100, arquivo: 'config.json' },
      { carregado: 1050, total: 4100, arquivo: 'onnx/model_quantized.onnx' },
      { carregado: 1100, total: 4100, arquivo: 'config.json' },
      { carregado: 3100, total: 4100, arquivo: 'onnx/model_quantized.onnx' },
    ]);
  });
});

/**
 * Com o modelo de verdade (~120 MB na primeira vez). Desligado por padrão:
 * FLUXO_TESTAR_MODELO=1 npx vitest run src/assistente/rag/vetorizador
 */
describe.skipIf(process.env.FLUXO_TESTAR_MODELO !== '1')('VetorizadorLocal com o modelo real', () => {
  const pasta = process.env.FLUXO_PASTA_MODELOS ?? join(tmpdir(), 'fluxo-modelos-teste');

  it('gera vetores normalizados de 384 dimensões que aproximam significados', { timeout: 600_000 }, async () => {
    const v = new VetorizadorLocal(pasta);
    await v.preparar();
    expect(v.baixado()).toBe(true);
    const [consulta] = await v.vetorizar(['comida fora de casa'], 'consulta');
    const [restaurante, luz] = await v.vetorizar(['Restaurante almoço executivo', 'Conta de energia elétrica'], 'documento');
    const cosseno = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);
    expect(consulta).toHaveLength(384);
    expect(Math.hypot(...consulta!)).toBeCloseTo(1, 3);
    expect(cosseno(consulta!, restaurante!)).toBeGreaterThan(cosseno(consulta!, luz!));
  });
});
