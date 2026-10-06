import { extrairTexto, LIMITE_DE_CARACTERES } from './extrator';
import { pdfDeTeste } from './testing/pdf';

describe('extrairTexto', () => {
  describe('texto', () => {
    it('decodifica UTF-8', async () => {
      expect(await extrairTexto(Buffer.from('Açaí;12,50\n', 'utf8'), 'texto')).toEqual({ texto: 'Açaí;12,50\n', paginas: null });
    });

    it('cai para Windows-1252 quando não é UTF-8 válido (OFX/CSV de banco)', async () => {
      expect((await extrairTexto(Buffer.from([0x50, 0xe3, 0x6f]), 'texto')).texto).toBe('Pão');
    });

    it('corta textos enormes', async () => {
      const { texto } = await extrairTexto(Buffer.from('x'.repeat(LIMITE_DE_CARACTERES + 500)), 'texto');
      expect(texto).toHaveLength(LIMITE_DE_CARACTERES);
    });
  });

  describe('pdf', () => {
    it('extrai o texto de cada página, marcando o número dela', async () => {
      const r = await extrairTexto(pdfDeTeste(['Fatura do cartao Nubank', 'Total a pagar 1234']), 'pdf');
      expect(r).toEqual({
        texto: '[Página 1]\nFatura do cartao Nubank\n\n[Página 2]\nTotal a pagar 1234',
        paginas: 2,
      });
    });

    it('pula a marcação de página sem texto', async () => {
      const r = await extrairTexto(pdfDeTeste(['', 'Resumo']), 'pdf');
      expect(r).toEqual({ texto: '[Página 2]\nResumo', paginas: 2 });
    });

    it('PDF sem texto nenhum (escaneado) devolve texto vazio', async () => {
      expect(await extrairTexto(pdfDeTeste(['']), 'pdf')).toEqual({ texto: '', paginas: 1 });
    });

    it('não estraga o buffer de quem chamou', async () => {
      const bytes = pdfDeTeste(['Oi']);
      const copia = Buffer.from(bytes);
      await extrairTexto(bytes, 'pdf');
      expect(bytes.equals(copia)).toBe(true);
    });

    it('PDF corrompido vira erro amigável em português', async () => {
      await expect(extrairTexto(Buffer.from('%PDF-1.4 isto não é um pdf'), 'pdf')).rejects.toThrow(
        /Não foi possível ler este PDF/,
      );
    });
  });
});
