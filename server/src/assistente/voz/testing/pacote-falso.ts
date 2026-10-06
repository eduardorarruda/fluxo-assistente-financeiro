import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pack, type Cabecalho } from 'tar-stream';
import type { VozDoCatalogo } from '../catalogo';
import type { CarregadorDeVoz } from '../sintetizador';

/**
 * Pacotes de voz de mentira para os testes: um .tar.bz2 de verdade (o bzip2 do
 * sistema comprime; o Fluxo descomprime em JavaScript), com o que uma voz tem
 * — ou com o que um pacote malicioso teria.
 */

export interface ItemDoPacote {
  cabecalho: Cabecalho;
  conteudo?: string;
}

export const ITENS_DE_VOZ = (raiz: string): ItemDoPacote[] => [
  { cabecalho: { name: `${raiz}/`, type: 'directory' } },
  { cabecalho: { name: `${raiz}/pt_BR-teste-medium.onnx` }, conteudo: 'modelo' },
  { cabecalho: { name: `${raiz}/tokens.txt` }, conteudo: '_ 0\n' },
  { cabecalho: { name: `${raiz}/espeak-ng-data/` , type: 'directory' } },
  { cabecalho: { name: `${raiz}/espeak-ng-data/phontab` }, conteudo: 'fonemas' },
  { cabecalho: { name: `${raiz}/espeak-ng-data/lang/roa/pt-BR` }, conteudo: 'name brazil' },
];

export async function tarBz2(itens: ItemDoPacote[]): Promise<Buffer> {
  const p = pack();
  const pedacos: Buffer[] = [];
  p.on('data', (b: Buffer) => pedacos.push(b));
  const fim = new Promise<void>((resolve) => p.on('end', () => resolve()));
  for (const item of itens) {
    const conteudo = item.conteudo ?? '';
    await new Promise<void>((resolve, reject) =>
      p.entry({ ...item.cabecalho, size: item.cabecalho.type === 'directory' || item.cabecalho.type === 'symlink' ? 0 : Buffer.byteLength(conteudo) }, item.cabecalho.type === 'directory' || item.cabecalho.type === 'symlink' ? undefined : conteudo, (e) => (e ? reject(e) : resolve())),
    );
  }
  p.finalize();
  await fim;
  const r = spawnSync('bzip2', ['-c'], { input: Buffer.concat(pedacos) });
  if (r.status !== 0) throw new Error('bzip2 indisponível para o teste');
  return r.stdout;
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function vozDeTeste(id: string, pacote: Buffer, parcial: Partial<VozDoCatalogo> = {}): VozDoCatalogo {
  return {
    id,
    nome: id,
    genero: 'masculina',
    qualidade: 'média',
    descricao: 'voz de teste',
    licenca: 'CC0',
    credito: 'testes',
    naoComercial: false,
    url: `https://exemplo.invalid/${id}.tar.bz2`,
    bytes: pacote.length,
    sha256: sha256(pacote),
    raiz: `vits-piper-${id}`,
    ...parcial,
  };
}

/** fetch de mentira: devolve os bytes do pacote (em pedaços) para a URL dele; registra as URLs pedidas. */
export function fetchFalso(pacotes: Record<string, Buffer>, opcoes: { status?: number; tamanhoAnunciado?: number } = {}) {
  const pedidas: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    pedidas.push(url);
    const corpo = pacotes[url];
    if (!corpo) return new Response('não achei', { status: 404 });
    const pedacos = [corpo.subarray(0, Math.floor(corpo.length / 2)), corpo.subarray(Math.floor(corpo.length / 2))];
    const fluxo = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of pedacos) c.enqueue(new Uint8Array(p));
        c.close();
      },
    });
    return new Response(fluxo, { status: opcoes.status ?? 200, headers: { 'content-length': String(opcoes.tamanhoAnunciado ?? corpo.length) } });
  };
  return { fetch, pedidas };
}

/** Carregador de voz de mentira: "fala" 1 amostra por caractere, registra o que gerou. */
export function carregadorFalso(opcoes: { taxa?: number; atrasoMs?: number; falhar?: Error } = {}) {
  const cargas: string[] = [];
  const geradas: { texto: string; velocidade: number }[] = [];
  const carregador: CarregadorDeVoz = async (pasta) => {
    cargas.push(pasta);
    if (opcoes.falhar) throw opcoes.falhar;
    return {
      taxa: opcoes.taxa ?? 22_050,
      async gerar(texto, velocidade) {
        geradas.push({ texto, velocidade });
        if (opcoes.atrasoMs) await new Promise((r) => setTimeout(r, opcoes.atrasoMs));
        return new Float32Array(texto.length).fill(0.5);
      },
    };
  };
  return { carregador, cargas, geradas };
}
