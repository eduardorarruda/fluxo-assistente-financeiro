import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOGO_DE_VOZES, IDS_DE_VOZ, VOZ_PADRAO } from './catalogo';
import { ServicoDeVoz } from './servico-voz';
import { carregadorFalso, fetchFalso, ITENS_DE_VOZ, tarBz2, vozDeTeste } from './testing/pacote-falso';

/** Instala uma voz "na mão" (sem download), como se já tivesse sido baixada. */
function instalarNaMao(pastaModelos: string, id: string) {
  const pasta = join(pastaModelos, 'piper', id);
  mkdirSync(join(pasta, 'espeak-ng-data'), { recursive: true });
  writeFileSync(join(pasta, `pt_BR-${id}-medium.onnx`), 'modelo');
  writeFileSync(join(pasta, 'tokens.txt'), '_ 0\n');
  writeFileSync(join(pasta, 'espeak-ng-data', 'phontab'), 'x');
}

describe('catálogo de vozes', () => {
  it('é fixo: só URLs da release tts-models do sherpa-onnx, com tamanho e SHA-256', () => {
    for (const v of CATALOGO_DE_VOZES) {
      expect(v.url).toMatch(/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/tts-models\/vits-piper-pt_BR-[a-z]+-(medium|high)\.tar\.bz2$/);
      expect(v.url.endsWith(`${v.raiz}.tar.bz2`)).toBe(true);
      expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(v.bytes).toBeGreaterThan(10_000_000);
      expect(v.licenca).toBeTruthy();
    }
    expect(IDS_DE_VOZ).toContain(VOZ_PADRAO);
    expect(new Set(IDS_DE_VOZ).size).toBe(IDS_DE_VOZ.length);
  });
});

describe('ServicoDeVoz', () => {
  let pasta: string;
  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'fluxo-voz-'));
  });
  afterEach(() => rmSync(pasta, { recursive: true, force: true }));

  describe('download', () => {
    it('baixa da URL do catálogo, confere, extrai e instala atomicamente; o estado mostra o progresso', async () => {
      const pacote = await tarBz2(ITENS_DE_VOZ('vits-piper-teste'));
      const voz = vozDeTeste('teste', pacote);
      const rede = fetchFalso({ [voz.url]: pacote });
      const servico = new ServicoDeVoz(pasta, { catalogo: [voz], fetch: rede.fetch });
      expect(servico.estado()).toMatchObject({ instalada: false, baixando: false, progresso: null, erro: null });

      const durante = servico.baixar('teste');
      expect(durante).toMatchObject({ baixando: true, vozBaixando: 'teste' });
      expect(servico.baixar('teste').baixando).toBe(true); // pedir de novo não duplica
      await servico.esperarDownload();

      expect(rede.pedidas).toEqual([voz.url]);
      const depois = servico.estado();
      expect(depois).toMatchObject({ instalada: true, baixando: false, erro: null });
      expect(depois.vozes[0]).toMatchObject({ id: 'teste', instalada: true });
      expect(readdirSync(join(pasta, 'piper'))).toEqual(['teste']); // nada temporário sobrou
    });

    it('SHA-256 diferente: nada é instalado e o erro aparece no estado', async () => {
      const pacote = await tarBz2(ITENS_DE_VOZ('vits-piper-teste'));
      const voz = vozDeTeste('teste', pacote, { sha256: '0'.repeat(64) });
      const extrair = vi.fn();
      const servico = new ServicoDeVoz(pasta, { catalogo: [voz], fetch: fetchFalso({ [voz.url]: pacote }).fetch, extrair });
      servico.baixar('teste');
      await servico.esperarDownload();
      expect(extrair).not.toHaveBeenCalled();
      expect(servico.estado()).toMatchObject({ instalada: false, baixando: false });
      expect(servico.estado().erro).toMatch(/SHA-256/);
      expect(readdirSync(join(pasta, 'piper'))).toEqual([]);
    });

    it('tamanho anunciado errado, HTTP de erro ou rede fora: falha amigável', async () => {
      const pacote = await tarBz2(ITENS_DE_VOZ('vits-piper-teste'));
      const voz = vozDeTeste('teste', pacote);
      const casos = [
        { fetch: fetchFalso({ [voz.url]: pacote }, { tamanhoAnunciado: pacote.length + 1 }).fetch, erro: /tamanho esperado/ },
        { fetch: fetchFalso({ [voz.url]: pacote }, { status: 503 }).fetch, erro: /respondeu 503/ },
        { fetch: async () => Promise.reject(new TypeError('fetch failed')), erro: /sem conexão/ },
      ];
      for (const caso of casos) {
        const servico = new ServicoDeVoz(pasta, { catalogo: [voz], fetch: caso.fetch });
        servico.baixar('teste');
        await servico.esperarDownload();
        expect(servico.estado().erro).toMatch(caso.erro);
        expect(servico.estado().instalada).toBe(false);
      }
    });

    it('corpo maior que o catálogo para no meio (mesmo sem Content-Length confiável)', async () => {
      const pacote = await tarBz2(ITENS_DE_VOZ('vits-piper-teste'));
      const voz = vozDeTeste('teste', pacote, { bytes: 10 });
      const servico = new ServicoDeVoz(pasta, { catalogo: [voz], fetch: fetchFalso({ [voz.url]: pacote }, { tamanhoAnunciado: 0 }).fetch });
      servico.baixar('teste');
      await servico.esperarDownload();
      expect(servico.estado().erro).toMatch(/maior do que o esperado/);
    });

    it('pacote sem o modelo não é instalado', async () => {
      const pacote = await tarBz2([{ cabecalho: { name: 'vits-piper-teste/tokens.txt' }, conteudo: 'x' }]);
      const voz = vozDeTeste('teste', pacote);
      const servico = new ServicoDeVoz(pasta, { catalogo: [voz], fetch: fetchFalso({ [voz.url]: pacote }).fetch });
      servico.baixar('teste');
      await servico.esperarDownload();
      expect(servico.estado().erro).toMatch(/sem o modelo/);
      expect(existsSync(join(pasta, 'piper', 'teste'))).toBe(false);
    });

    it('voz fora do catálogo é recusada (allowlist); outra voz durante um download é conflito', async () => {
      const pacote = await tarBz2(ITENS_DE_VOZ('vits-piper-teste'));
      const a = vozDeTeste('a', pacote, { raiz: 'vits-piper-teste' });
      const b = vozDeTeste('b', pacote, { raiz: 'vits-piper-teste' });
      const servico = new ServicoDeVoz(pasta, { catalogo: [a, b], fetch: fetchFalso({ [a.url]: pacote, [b.url]: pacote }).fetch });
      expect(() => servico.baixar('https://evil.example/voz.tar.bz2')).toThrow(NotFoundException);
      servico.baixar('a');
      expect(() => servico.baixar('b')).toThrow(ConflictException);
      expect(() => servico.remover('a')).toThrow(ConflictException);
      await servico.esperarDownload();
    });

    it('o catálogo padrão recusa qualquer id que não seja dele', () => {
      const servico = new ServicoDeVoz(pasta, { fetch: vi.fn() });
      expect(() => servico.baixar('../../etc')).toThrow(NotFoundException);
      expect(() => servico.remover('qualquer')).toThrow(NotFoundException);
      expect(servico.estado().vozes.map((v) => v.id)).toEqual(IDS_DE_VOZ);
    });
  });

  describe('fala', () => {
    it('sem voz instalada: conflito com o caminho dos Ajustes', async () => {
      const servico = new ServicoDeVoz(pasta, { carregador: carregadorFalso().carregador });
      await expect(servico.falar({ texto: 'Oi.' })).rejects.toThrow(/Baixe uma em Ajustes/);
    });

    it('gera WAV, carrega o modelo uma vez só e prefere a padrão quando a pedida não está instalada', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      const falso = carregadorFalso();
      const servico = new ServicoDeVoz(pasta, { carregador: falso.carregador });
      const wav = await servico.falar({ texto: 'Oi, tudo bem?', voz: 'dii', velocidade: 1.25 });
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.length).toBe(44 + 'Oi, tudo bem?'.length * 2);
      await servico.falar({ texto: 'De novo.' });
      expect(falso.cargas).toEqual([join(pasta, 'piper', VOZ_PADRAO)]);
      expect(falso.geradas).toEqual([{ texto: 'Oi, tudo bem?', velocidade: 1.25 }, { texto: 'De novo.', velocidade: 1 }]);
    });

    it('limita a velocidade e o tamanho do texto', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      const falso = carregadorFalso();
      const servico = new ServicoDeVoz(pasta, { carregador: falso.carregador });
      await servico.falar({ texto: 'Rápido.', velocidade: 9 });
      expect(falso.geradas[0]?.velocidade).toBe(2);
      await expect(servico.falar({ texto: 'a'.repeat(601) })).rejects.toThrow(/longo demais/);
      await expect(servico.falar({ texto: '   ' })).rejects.toThrow(ConflictException);
    });

    it('fila: uma síntese por vez, na ordem; cheia vira 503', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      let rodando = 0;
      let maximo = 0;
      const ordem: string[] = [];
      const servico = new ServicoDeVoz(pasta, {
        maximoNaFila: 3,
        carregador: async () => ({
          taxa: 16_000,
          async gerar(texto) {
            rodando += 1;
            maximo = Math.max(maximo, rodando);
            await new Promise((r) => setTimeout(r, 5));
            ordem.push(texto);
            rodando -= 1;
            return new Float32Array(1);
          },
        }),
      });
      const pedidos = ['um', 'dois', 'três'].map((t) => servico.falar({ texto: t }));
      await expect(servico.falar({ texto: 'quatro' })).rejects.toThrow(ServiceUnavailableException);
      await Promise.all(pedidos);
      expect(maximo).toBe(1);
      expect(ordem).toEqual(['um', 'dois', 'três']);
      await servico.falar({ texto: 'cinco' }); // a fila esvaziou: volta a aceitar
    });

    it('pedido cancelado antes da vez é pulado sem sintetizar', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      const falso = carregadorFalso({ atrasoMs: 5 });
      const servico = new ServicoDeVoz(pasta, { carregador: falso.carregador });
      const primeiro = servico.falar({ texto: 'primeira' });
      let desistiu = false;
      const segundo = servico.falar({ texto: 'segunda' }, () => desistiu);
      desistiu = true;
      await primeiro;
      await expect(segundo).rejects.toThrow(/cancelada/);
      expect(falso.geradas.map((g) => g.texto)).toEqual(['primeira']);
    });

    it('tempo limite: 503 para quem pediu, e a fila espera a síntese acabar de verdade', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      const falso = carregadorFalso({ atrasoMs: 60 });
      const servico = new ServicoDeVoz(pasta, { carregador: falso.carregador, tempoLimiteMs: 10 });
      await expect(servico.falar({ texto: 'demorada' })).rejects.toThrow(/demorou demais/);
    });

    it('falha do modelo: 503 genérico, sem o texto na mensagem, e a próxima fala tenta carregar de novo', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      const falso = carregadorFalso({ falhar: new Error('onnx quebrou') });
      const servico = new ServicoDeVoz(pasta, { carregador: falso.carregador });
      const erro = await servico.falar({ texto: 'Saldo de R$ 9.999,99' }).catch((e: Error) => e);
      expect(erro).toBeInstanceOf(ServiceUnavailableException);
      expect(String((erro as Error).message)).not.toContain('9.999');
      await servico.falar({ texto: 'outra' }).catch(() => undefined);
      expect(falso.cargas).toHaveLength(2);
    });

    it('preparar carrega antes (sem lançar) e remover descarta o modelo da memória', async () => {
      instalarNaMao(pasta, VOZ_PADRAO);
      const falso = carregadorFalso();
      const servico = new ServicoDeVoz(pasta, { carregador: falso.carregador });
      await servico.preparar();
      await servico.falar({ texto: 'oi' });
      expect(falso.cargas).toHaveLength(1);
      const estado = servico.remover(VOZ_PADRAO);
      expect(estado.instalada).toBe(false);
      expect(existsSync(join(pasta, 'piper', VOZ_PADRAO))).toBe(false);
      await expect(servico.preparar()).resolves.toBeUndefined();
    });
  });
});
