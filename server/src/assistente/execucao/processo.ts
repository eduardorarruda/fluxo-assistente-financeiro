import { Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/**
 * Roda o CLI como processo filho: sem shell (lista de argumentos), entrada
 * pela stdin, saída lida linha a linha. O processo nasce num grupo próprio —
 * cancelar ou estourar o tempo mata o grupo inteiro, inclusive o que o CLI
 * tiver iniciado (o Gemini se relança como filho; o MCP é neto).
 */

export interface OpcoesProcesso {
  caminho: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  entrada: string;
  tempoMaximoMs: number;
  sinal?: AbortSignal;
  aoLinha: (linha: string) => void;
}

export type MotivoFim = 'normal' | 'tempo' | 'cancelado' | 'falha_ao_iniciar';

export interface FimProcesso {
  codigo: number | null;
  sinal: NodeJS.Signals | null;
  /** Só o fim do stderr: é onde fica a mensagem de erro. */
  stderr: string;
  duracaoMs: number;
  motivo: MotivoFim;
  erroAoIniciar: string | null;
}

const LIMITE_STDERR = 16 * 1024;
/** Uma linha de JSON maior que isto é lixo (ou ataque): descarta. */
const LIMITE_LINHA = 20 * 1024 * 1024;
const ESPERA_ANTES_DO_KILL_MS = 3000;

const log = new Logger('ProcessoCli');

export function rodarProcesso(o: OpcoesProcesso): Promise<FimProcesso> {
  const inicio = Date.now();
  const fim = (motivo: MotivoFim, extra: Partial<FimProcesso> = {}): FimProcesso => ({
    codigo: null, sinal: null, stderr: '', duracaoMs: Date.now() - inicio, motivo, erroAoIniciar: null, ...extra,
  });
  if (o.sinal?.aborted) return Promise.resolve(fim('cancelado'));

  return new Promise((resolver) => {
    const filho = spawn(o.caminho, [...o.args], { cwd: o.cwd, env: o.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let motivo: MotivoFim = 'normal';
    let stderr = '';
    let terminou = false;
    const linhas = leitorDeLinhas(o.aoLinha);

    const encerrar = (porque: MotivoFim) => {
      if (terminou || motivo !== 'normal') return;
      motivo = porque;
      matarGrupo(filho.pid, 'SIGTERM');
      setTimeout(() => matarGrupo(filho.pid, 'SIGKILL'), ESPERA_ANTES_DO_KILL_MS).unref();
    };
    const relogio = setTimeout(() => encerrar('tempo'), o.tempoMaximoMs);
    const aoCancelar = () => encerrar('cancelado');
    o.sinal?.addEventListener('abort', aoCancelar, { once: true });
    const limpar = () => {
      terminou = true;
      clearTimeout(relogio);
      o.sinal?.removeEventListener('abort', aoCancelar);
    };

    filho.on('error', (e) => {
      if (terminou) return;
      limpar();
      resolver(fim('falha_ao_iniciar', { erroAoIniciar: `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}`.trim() }));
    });
    filho.stdout.on('data', (pedaco: Buffer) => linhas.receber(pedaco));
    filho.stderr.on('data', (pedaco: Buffer) => {
      stderr = (stderr + pedaco.toString('utf8')).slice(-LIMITE_STDERR);
    });
    filho.stdin.on('error', () => undefined); // EPIPE: o CLI saiu antes de ler tudo
    filho.stdin.end(o.entrada);

    filho.on('close', (codigo, sinal) => {
      if (terminou) return;
      linhas.terminar();
      limpar();
      // O grupo pode ter sobrado (netos que o CLI não esperou).
      matarGrupo(filho.pid, 'SIGKILL');
      resolver(fim(motivo, { codigo, sinal, stderr }));
    });
  });
}

function leitorDeLinhas(aoLinha: (linha: string) => void) {
  const decodificador = new StringDecoder('utf8');
  let resto = '';
  const entregar = (linha: string) => {
    if (!linha.trim()) return;
    try {
      aoLinha(linha);
    } catch (e) {
      log.error(`Falha ao tratar uma linha do CLI: ${(e as Error).message}`);
    }
  };
  return {
    receber(pedaco: Buffer) {
      resto += decodificador.write(pedaco);
      const partes = resto.split('\n');
      resto = partes.pop() ?? '';
      if (resto.length > LIMITE_LINHA) resto = '';
      for (const p of partes) entregar(p.replace(/\r$/, ''));
    },
    terminar() {
      resto += decodificador.end();
      entregar(resto);
      resto = '';
    },
  };
}

function matarGrupo(pid: number | undefined, sinal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, sinal);
  } catch {
    // O grupo já acabou.
  }
}
