import { CHAVE_FALSA, conta, contaApi } from '../../testes/fixtures/assistente';
import {
  contaPronta, ehApi, LIMITE_CHAVE, LIMITE_MODELO, pastaValida, problemaNaChave, problemaNoModelo, problemaNoNome, slug, sugerirNome, sugerirNomeLivre, sugerirPasta,
} from './regras-contas';

describe('regras das contas', () => {
  it('nome de modelo segue a regra do servidor', () => {
    for (const ok of ['sonnet', 'claude-opus-4-1', 'gemini-2.5-pro', 'gpt-5:mini', 'org/modelo@2026', 'a_b']) expect(problemaNoModelo(ok)).toBeNull();
    for (const ruim of ['', '   ', '-x', '--yolo', 'a b', '.oculto', 'modelo;rm', 'ção']) expect(problemaNoModelo(ruim)).not.toBeNull();
    expect(problemaNoModelo('a'.repeat(LIMITE_MODELO))).toBeNull();
    expect(problemaNoModelo('a'.repeat(LIMITE_MODELO + 1))).toMatch(/máximo/);
  });

  it('pasta de login vazia ou absoluta', () => {
    expect(pastaValida('')).toBe(true);
    expect(pastaValida('/home/ana/x')).toBe(true);
    expect(pastaValida('C:\\Users\\ana')).toBe(true);
    expect(pastaValida('contas/x')).toBe(false);
    expect(pastaValida('~/x')).toBe(false);
  });

  it('slug tira acento e junta com hífen; a pasta sugerida usa provedor + slug', () => {
    expect(slug('  Claude Trabalho — Ação!  ')).toBe('claude-trabalho-acao');
    expect(sugerirPasta('/home/ana/.config/fluxo/contas/', 'claude', 'Claude 2')).toBe('/home/ana/.config/fluxo/contas/claude-2');
    expect(sugerirPasta('/base', 'claude', 'Trabalho')).toBe('/base/claude-trabalho');
    expect(sugerirPasta('/base', 'codex', '!!!')).toBe('/base/codex');
  });

  it('nome sugerido pula os que já existem', () => {
    expect(sugerirNome('Claude', [conta()])).toBe('Claude 2');
    expect(sugerirNome('Claude', [conta({ nome: 'Claude 2' }), conta({ nome: 'claude 3' })])).toBe('Claude 4');
  });

  it('conta pronta = ligada e instalada', () => {
    expect(contaPronta(conta())).toBe(true);
    expect(contaPronta(conta({ ativo: false }))).toBe(false);
    expect(contaPronta(conta({ instalado: false }))).toBe(false);
  });

  it('chave de API segue a regra do servidor: aparada, 20–300 caracteres ASCII visíveis, sem espaço', () => {
    expect(problemaNaChave(CHAVE_FALSA)).toBeNull();
    expect(problemaNaChave(`  ${CHAVE_FALSA}\n`)).toBeNull();
    expect(problemaNaChave('a'.repeat(LIMITE_CHAVE.min))).toBeNull();
    expect(problemaNaChave('a'.repeat(LIMITE_CHAVE.max))).toBeNull();
    expect(problemaNaChave('')).toMatch(/Cole/);
    expect(problemaNaChave('a'.repeat(LIMITE_CHAVE.min - 1))).toMatch(/Curta/);
    expect(problemaNaChave('a'.repeat(LIMITE_CHAVE.max + 1))).toMatch(/Longa/);
    expect(problemaNaChave('sk-ant teste-000000000000000000')).toMatch(/espaços/);
    expect(problemaNaChave('sk-ant\tteste-00000000000000000')).toMatch(/espaços/);
    expect(problemaNaChave('sk-ant-ção-0000000000000000000')).toMatch(/sem acento/);
  });

  it('nome de conta: obrigatório e sem repetir (ignora maiúsculas e a própria conta)', () => {
    const contas = [conta(), contaApi()];
    expect(problemaNoNome('  ', contas)).toMatch(/Dê um nome/);
    expect(problemaNoNome('CLAUDE (api)', contas)).toMatch(/Já existe/);
    expect(problemaNoNome('Claude (API)', contas, 'api-1')).toBeNull();
    expect(problemaNoNome('Claude trabalho', contas)).toBeNull();
  });

  it('nome sugerido de conta de API: o próprio, se livre; senão numerado', () => {
    expect(sugerirNomeLivre('Claude (API)', [conta()])).toBe('Claude (API)');
    expect(sugerirNomeLivre('Claude (API)', [conta(), contaApi()])).toBe('Claude (API) 2');
  });

  it('tipo da conta: sem `tipo` (servidor antigo) é CLI', () => {
    expect(ehApi(contaApi())).toBe(true);
    expect(ehApi(conta())).toBe(false);
    expect(ehApi({ ...conta(), tipo: undefined } as unknown as ReturnType<typeof conta>)).toBe(false);
    expect(ehApi(undefined)).toBe(false);
  });
});
