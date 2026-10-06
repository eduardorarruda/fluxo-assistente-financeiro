import type { ProvedorInfo } from '../../api/tipos-assistente';
import { catalogoApiDe, catalogoDe, sugestoesDeModelo } from './catalogo';

const base: ProvedorInfo = { provedor: 'claude', nome: 'Claude Code', variavelDeConta: 'CLAUDE_CONFIG_DIR', modelosSugeridos: ['opus'], modelos: [], comoInstalar: '',
  api: { nome: 'API da Anthropic', ondeCriarChave: 'https://console.anthropic.com/settings/keys', modelos: [{ id: 'claude-sonnet-4-5', nome: 'Sonnet 4.5', descricao: 'Equilibrado', principal: true }] },
};

describe('catalogoDe', () => {
  it('usa o catálogo do servidor quando ele vem', () => {
    const info = { ...base, modelos: [{ id: 'claude-opus-5-5', nome: 'Opus 5.5', descricao: 'O mais capaz', principal: true }] };
    expect(catalogoDe(info).map((m) => m.nome)).toEqual(['Opus 5.5']);
  });

  it('servidor de versão anterior (sem `modelos`): cai nos modelos sugeridos em vez de ficar vazio', () => {
    const antigo = { ...base, modelos: undefined } as unknown as ProvedorInfo;
    expect(catalogoDe(antigo)).toEqual([{ id: 'opus', nome: 'opus', descricao: 'sugerido pelo Fluxo', principal: true }]);
    expect(sugestoesDeModelo(antigo)).toEqual([{ valor: 'opus', rotulo: 'opus', descricao: 'opus · sugerido pelo Fluxo' }]);
  });

  it('sem informação do CLI: lista vazia', () => {
    expect(catalogoDe(undefined)).toEqual([]);
  });
});

describe('catalogoApiDe', () => {
  it('é o catálogo fixo da API (não o do CLI)', () => {
    expect(catalogoApiDe(base).map((m) => m.id)).toEqual(['claude-sonnet-4-5']);
  });

  it('servidor sem contas de API (sem `api`): lista vazia em vez de quebrar', () => {
    expect(catalogoApiDe({ ...base, api: undefined } as unknown as ProvedorInfo)).toEqual([]);
    expect(catalogoApiDe(undefined)).toEqual([]);
  });
});
