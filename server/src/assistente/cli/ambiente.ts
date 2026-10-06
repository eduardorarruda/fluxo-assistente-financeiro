/**
 * O ambiente em que o CLI roda. Começa vazio e só recebe o necessário para
 * ele achar o login da pessoa e sair para a rede — nunca o segredo da
 * Pluggy, o token da sessão do Fluxo, chaves de API (o CLI cobraria por uso
 * em vez de usar o plano) nem variáveis que injetam código (NODE_OPTIONS,
 * LD_PRELOAD).
 */

const BASICAS = [
  'HOME', 'USER', 'LOGNAME', 'LANG', 'LANGUAGE', 'TZ', 'TMPDIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  // Chaveiro do sistema (alguns CLIs guardam o login nele).
  'DBUS_SESSION_BUS_ADDRESS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];

export interface OpcoesAmbiente {
  /** Variáveis do usuário que este CLI precisa (pasta de configuração, projeto do Google…). */
  permitidas: readonly string[];
  /** Variáveis que o Fluxo define para esta execução (o token da ponte, por exemplo). */
  extras: Record<string, string>;
  /** Pastas que vão na frente do PATH (a do Node, para CLIs que são scripts Node). */
  pastasNoPath: readonly string[];
}

export function ambienteLimpo(origem: NodeJS.ProcessEnv, opcoes: OpcoesAmbiente): Record<string, string> {
  const env: Record<string, string> = {};
  for (const chave of [...BASICAS, ...opcoes.permitidas]) {
    const valor = origem[chave];
    if (valor !== undefined) env[chave] = valor;
  }
  for (const [chave, valor] of Object.entries(origem)) {
    if (chave.startsWith('LC_') && valor !== undefined) env[chave] = valor;
  }
  const caminhos = [...opcoes.pastasNoPath, ...(origem.PATH ?? '').split(':')].filter(Boolean);
  env.PATH = [...new Set(caminhos)].join(':');
  env.NO_COLOR = '1';
  env.TERM = 'dumb';
  env.CI = '1';
  return { ...env, ...opcoes.extras };
}
