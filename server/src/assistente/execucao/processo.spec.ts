import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rodarProcesso, type OpcoesProcesso } from './processo';

let pasta: string;

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'fluxo-processo-'));
});

afterEach(() => rmSync(pasta, { recursive: true, force: true }));

/** Roda um script Node como se fosse o CLI. */
function script(codigo: string, extra: Partial<OpcoesProcesso> = {}) {
  const linhas: string[] = [];
  const promessa = rodarProcesso({
    caminho: process.execPath,
    args: ['-e', codigo],
    cwd: pasta,
    env: { PATH: process.env.PATH ?? '' },
    entrada: '',
    tempoMaximoMs: 20_000,
    aoLinha: (l) => linhas.push(l),
    ...extra,
  });
  return { linhas, promessa };
}

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('rodarProcesso', () => {
  it('entrega linha por linha, mesmo quando uma linha chega em dois pedaços', async () => {
    const { linhas, promessa } = script(`
      process.stdout.write('{"a":1}\\n{"b"');
      setTimeout(() => process.stdout.write(':2}\\n{"c":3}'), 50);
    `);
    const fim = await promessa;
    expect(linhas).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(fim).toMatchObject({ codigo: 0, motivo: 'normal' });
  });

  it('não quebra acentos divididos entre pedaços', async () => {
    const { linhas, promessa } = script(`
      const b = Buffer.from('ação\\n');
      process.stdout.write(b.subarray(0, 2));
      setTimeout(() => process.stdout.write(b.subarray(2)), 30);
    `);
    await promessa;
    expect(linhas).toEqual(['ação']);
  });

  it('manda a entrada pela stdin e fecha (o CLI espera o fim da entrada)', async () => {
    const { linhas, promessa } = script(`
      let t = ''; process.stdin.on('data', (d) => (t += d)); process.stdin.on('end', () => console.log('recebi:' + t));
    `, { entrada: 'Quanto gastei?' });
    await promessa;
    expect(linhas).toEqual(['recebi:Quanto gastei?']);
  });

  it('guarda o código de saída e o fim do stderr', async () => {
    const { promessa } = script(`process.stderr.write('x'.repeat(40000) + 'FIM'); process.exit(3);`);
    const fim = await promessa;
    expect(fim.codigo).toBe(3);
    expect(fim.stderr.endsWith('FIM')).toBe(true);
    expect(fim.stderr.length).toBeLessThanOrEqual(16 * 1024);
  });

  it('estoura o tempo máximo e mata o processo', async () => {
    const { promessa } = script(`setInterval(() => {}, 1000);`, { tempoMaximoMs: 300 });
    const fim = await promessa;
    expect(fim.motivo).toBe('tempo');
  });

  it('cancelar mata o grupo inteiro, inclusive os filhos do CLI', async () => {
    const controle = new AbortController();
    const { linhas, promessa } = script(`
      const { spawn } = require('node:child_process');
      const neto = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      console.log(String(neto.pid));
      setInterval(() => {}, 1000);
    `, { sinal: controle.signal });
    await vi.waitFor(() => expect(linhas.length).toBe(1), { timeout: 10_000 });
    const neto = Number(linhas[0]);
    controle.abort();
    const fim = await promessa;
    expect(fim.motivo).toBe('cancelado');
    await vi.waitFor(() => expect(vivo(neto)).toBe(false), { timeout: 10_000 });
  });

  it('já cancelado antes de começar não chega a rodar', async () => {
    const controle = new AbortController();
    controle.abort();
    const { linhas, promessa } = script(`console.log('rodei')`, { sinal: controle.signal });
    expect((await promessa).motivo).toBe('cancelado');
    expect(linhas).toEqual([]);
  });

  it('programa que não existe vira falha ao iniciar, sem lançar', async () => {
    const fim = await rodarProcesso({
      caminho: join(pasta, 'nao-existe'), args: [], cwd: pasta, env: {}, entrada: '', tempoMaximoMs: 5000, aoLinha: () => undefined,
    });
    expect(fim.motivo).toBe('falha_ao_iniciar');
    expect(fim.erroAoIniciar).toMatch(/ENOENT/);
  });

  it('erro no tratamento de uma linha não derruba a execução', async () => {
    let chamadas = 0;
    const fim = await rodarProcesso({
      caminho: process.execPath, args: ['-e', `console.log('a'); console.log('b')`], cwd: pasta, env: {}, entrada: '', tempoMaximoMs: 10_000,
      aoLinha: () => {
        chamadas++;
        throw new Error('bug');
      },
    });
    expect(chamadas).toBe(2);
    expect(fim.motivo).toBe('normal');
  });
});
