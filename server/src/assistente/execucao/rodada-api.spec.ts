import { nomeDeModeloDeApi } from './rodada-api';

describe('nomeDeModeloDeApi', () => {
  it('aceita os nomes de modelo das três APIs', () => {
    for (const nome of ['claude-opus-5-5', 'gemini-3.1-pro-preview', 'gpt-6.1-sol', 'gpt-5.5', 'ft:gpt-6-luna:org:abc']) {
      expect(nomeDeModeloDeApi(nome)).toBe(true);
    }
  });

  it('recusa nome que mudaria o caminho da URL do provedor', () => {
    for (const nome of ['../files', 'gemini/../../v1/files', 'tunedModels/x', 'a..b', '-x', 'a b', 'x@y']) {
      expect(nomeDeModeloDeApi(nome)).toBe(false);
    }
  });
});
