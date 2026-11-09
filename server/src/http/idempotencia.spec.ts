import { describe, expect, it } from 'vitest';
import { Idempotencia, VALIDADE_DA_CHAVE_MS } from './idempotencia';

describe('Idempotencia', () => {
  it('mesma chave faz uma vez e devolve o mesmo resultado; outra chave faz de novo', () => {
    let feitos = 0;
    const idem = new Idempotencia(() => 0);
    const fazer = () => ++feitos;
    expect(idem.umaVez('conta', 'chave-0001', fazer)).toBe(1);
    expect(idem.umaVez('conta', 'chave-0001', fazer)).toBe(1);
    expect(idem.umaVez('conta', 'chave-0002', fazer)).toBe(2);
  });

  it('sem chave, faz sempre (comportamento antigo)', () => {
    let feitos = 0;
    const idem = new Idempotencia();
    idem.umaVez('conta', undefined, () => ++feitos);
    idem.umaVez('conta', undefined, () => ++feitos);
    expect(feitos).toBe(2);
  });

  it('a chave vence depois da validade', () => {
    let agora = 0;
    let feitos = 0;
    const idem = new Idempotencia(() => agora);
    idem.umaVez('conta', 'chave-0001', () => ++feitos);
    agora = VALIDADE_DA_CHAVE_MS;
    idem.umaVez('conta', 'chave-0001', () => ++feitos);
    expect(feitos).toBe(2);
  });

  it('erro não fica guardado: tentar de novo com a mesma chave refaz', () => {
    const idem = new Idempotencia(() => 0);
    expect(() => idem.umaVez('conta', 'chave-0001', () => { throw new Error('falhou'); })).toThrow('falhou');
    expect(idem.umaVez('conta', 'chave-0001', () => 'ok')).toBe('ok');
  });

  it('recusa chave malformada ou repetida no cabeçalho', () => {
    const idem = new Idempotencia();
    expect(() => idem.umaVez('conta', 'curta', () => 1)).toThrow(/inválida/);
    expect(() => idem.umaVez('conta', ['a-chave-1', 'a-chave-2'], () => 1)).toThrow(/inválida/);
  });
});
