import { ambienteLimpo } from './ambiente';

const ENV = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/ana',
  LANG: 'pt_BR.UTF-8',
  LC_ALL: 'pt_BR.UTF-8',
  XDG_CONFIG_HOME: '/home/ana/.config',
  HTTPS_PROXY: 'http://proxy:3128',
  PLUGGY_CLIENT_ID: 'id',
  PLUGGY_CLIENT_SECRET: 'segredo-da-pluggy',
  FLUXO_SESSAO: 'token-da-sessao',
  CAMINHO_BANCO: '/home/ana/fluxo.db',
  ANTHROPIC_API_KEY: 'sk-ant',
  OPENAI_API_KEY: 'sk-openai',
  GEMINI_API_KEY: 'gk',
  CLAUDE_CONFIG_DIR: '/home/ana/.claude-trabalho',
  NODE_OPTIONS: '--require /tmp/x.js',
  LD_PRELOAD: '/tmp/x.so',
};

describe('ambienteLimpo', () => {
  it('mantém o básico para o CLI achar o login e a rede', () => {
    const env = ambienteLimpo(ENV, { permitidas: [], extras: {}, pastasNoPath: [] });
    expect(env).toMatchObject({ HOME: '/home/ana', LANG: 'pt_BR.UTF-8', LC_ALL: 'pt_BR.UTF-8', XDG_CONFIG_HOME: '/home/ana/.config', HTTPS_PROXY: 'http://proxy:3128' });
    expect(env.PATH).toContain('/usr/bin');
  });

  it('nunca passa os segredos do Fluxo nem chaves de API pagas por uso', () => {
    const env = ambienteLimpo(ENV, { permitidas: [], extras: {}, pastasNoPath: [] });
    const texto = JSON.stringify(env);
    for (const segredo of ['segredo-da-pluggy', 'token-da-sessao', 'sk-ant', 'sk-openai', 'gk']) expect(texto).not.toContain(segredo);
    expect(env).not.toHaveProperty('CAMINHO_BANCO');
  });

  it('nem variáveis que injetam código no processo', () => {
    const env = ambienteLimpo(ENV, { permitidas: [], extras: {}, pastasNoPath: [] });
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('LD_PRELOAD');
  });

  it('passa as variáveis que o adaptador pediu e as extras', () => {
    const env = ambienteLimpo(ENV, { permitidas: ['CLAUDE_CONFIG_DIR'], extras: { FLUXO_PONTE_ACESSO: 'abc' }, pastasNoPath: [] });
    expect(env).toMatchObject({ CLAUDE_CONFIG_DIR: '/home/ana/.claude-trabalho', FLUXO_PONTE_ACESSO: 'abc' });
  });

  it('põe as pastas pedidas na frente do PATH, sem repetir', () => {
    const env = ambienteLimpo(ENV, { permitidas: [], extras: {}, pastasNoPath: ['/opt/node/bin', '/usr/bin'] });
    expect(env.PATH).toBe('/opt/node/bin:/usr/bin:/bin');
  });

  it('sem cor nem terminal interativo na saída', () => {
    const env = ambienteLimpo(ENV, { permitidas: [], extras: {}, pastasNoPath: [] });
    expect(env).toMatchObject({ NO_COLOR: '1', TERM: 'dumb', CI: '1' });
  });
});
