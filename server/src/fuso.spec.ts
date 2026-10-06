describe('fuso', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    vi.resetModules();
  });

  it('sem TZ definido, o processo roda no fuso de Brasília', async () => {
    delete process.env.TZ;
    await import('./fuso.js');
    expect(process.env.TZ).toBe('America/Sao_Paulo');
  });

  it('TZ definido por quem subiu o processo é respeitado', async () => {
    process.env.TZ = 'America/Manaus';
    await import('./fuso.js');
    expect(process.env.TZ).toBe('America/Manaus');
  });
});
