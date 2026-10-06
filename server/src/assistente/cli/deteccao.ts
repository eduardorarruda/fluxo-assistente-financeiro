import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { ambienteLimpo } from './ambiente';
import type { ProvedorIA } from './tipos';

/**
 * Onde está o CLI e qual a versão. O Fluxo aberto pelo menu do KDE não tem o
 * PATH do terminal (nvm, ~/.local/bin…), então além do PATH procura nas
 * pastas de instalação de costume.
 */

export interface CliEncontrado {
  caminho: string;
  versao: string | null;
}

export interface ResultadoDeteccao {
  encontrado: CliEncontrado | null;
  /** Só quando o caminho configurado pela pessoa não serve. */
  erro: string | null;
}

export interface OpcoesDeteccao {
  env: NodeJS.ProcessEnv;
  home: string;
  /** Último recurso para a versão: rodar `<cli> --version`. Injetável nos testes. */
  versaoPorExecucao?: (caminho: string) => Promise<string | null>;
}

const BINARIOS: Record<ProvedorIA, string> = { claude: 'claude', gemini: 'gemini', codex: 'codex' };
const PACOTES: Record<ProvedorIA, string> = { claude: '@anthropic-ai/claude-code', gemini: '@google/gemini-cli', codex: '@openai/codex' };
const SEMVER = /\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/;
const TEMPO_VERSAO_MS = 10_000;
const NIVEIS_ATE_O_PACOTE = 6;

export function pastasCandidatas(env: NodeJS.ProcessEnv, home: string): string[] {
  const nvm = [join(home, '.nvm', 'versions', 'node'), join(home, '.local', 'share', 'nvm')].flatMap((base) =>
    listar(base).sort().reverse().map((v) => join(base, v, 'bin')));
  const comuns = [
    join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'), join(home, '.volta', 'bin'),
    join(home, '.yarn', 'bin'), join(home, '.local', 'share', 'pnpm'), join(home, '.claude', 'local'),
    '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin', ...nvm,
  ];
  return [...new Set([...(env.PATH ?? '').split(':').filter(Boolean), ...comuns])];
}

function listar(pasta: string): string[] {
  try {
    return readdirSync(pasta);
  } catch {
    return [];
  }
}

/** null se o caminho serve; senão, o motivo (para mostrar na tela). */
export function validarCaminho(caminho: string, binario: string): string | null {
  if (!isAbsolute(caminho) || caminho.includes('\0')) return 'Informe o caminho absoluto do programa (começando com /).';
  if (basename(caminho) !== binario) return `O arquivo precisa se chamar "${binario}".`;
  if (!existsSync(caminho)) return 'Esse arquivo não existe.';
  if (!statSync(caminho).isFile()) return 'Esse caminho não é um arquivo.';
  try {
    accessSync(caminho, constants.X_OK);
  } catch {
    return 'Esse arquivo não tem permissão de execução.';
  }
  return null;
}

export async function detectarCli(provedor: ProvedorIA, configurado: string | null, opcoes: OpcoesDeteccao): Promise<ResultadoDeteccao> {
  const binario = BINARIOS[provedor];
  let caminho: string | null = configurado;
  if (configurado) {
    const erro = validarCaminho(configurado, binario);
    if (erro) return { encontrado: null, erro };
  } else {
    caminho = pastasCandidatas(opcoes.env, opcoes.home).map((p) => join(p, binario)).find((c) => validarCaminho(c, binario) === null) ?? null;
  }
  if (!caminho) return { encontrado: null, erro: null };
  const versao = versaoSemExecutar(caminho, PACOTES[provedor]) ?? (await (opcoes.versaoPorExecucao ?? versaoPorExecucao)(caminho));
  return { encontrado: { caminho, versao }, erro: null };
}

/** Pelo instalador nativo (…/versions/2.1.268) ou pelo package.json do pacote npm. */
function versaoSemExecutar(caminho: string, pacote: string): string | null {
  let real: string;
  try {
    real = realpathSync(caminho);
  } catch {
    return null;
  }
  const doNome = basename(real).match(/^\d+\.\d+\.\d+$/);
  if (doNome) return doNome[0];
  let pasta = dirname(real);
  for (let i = 0; i < NIVEIS_ATE_O_PACOTE; i++) {
    const versao = versaoDoPacote(join(pasta, 'package.json'), pacote);
    if (versao) return versao;
    const acima = dirname(pasta);
    if (acima === pasta) break;
    pasta = acima;
  }
  return null;
}

function versaoDoPacote(arquivo: string, pacote: string): string | null {
  try {
    const p = JSON.parse(readFileSync(arquivo, 'utf8')) as { name?: unknown; version?: unknown };
    return p.name === pacote && typeof p.version === 'string' ? p.version : null;
  } catch {
    return null;
  }
}

function versaoPorExecucao(caminho: string): Promise<string | null> {
  const env = ambienteLimpo(process.env, { permitidas: [], extras: {}, pastasNoPath: [dirname(process.execPath)] });
  return new Promise((resolver) => {
    execFile(caminho, ['--version'], { env, timeout: TEMPO_VERSAO_MS, maxBuffer: 64 * 1024 }, (erro, saida) => {
      resolver(erro ? null : (String(saida).match(SEMVER)?.[1] ?? null));
    });
  });
}
