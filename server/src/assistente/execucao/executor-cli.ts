import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ambienteLimpo } from '../cli/ambiente';
import { cortar } from '../cli/comum';
import type { AdaptadorCli, CodigoErro, EventoAgente, ServidorMcp } from '../cli/tipos';
import { rodarProcesso, type FimProcesso } from './processo';

/**
 * Uma rodada de um CLI: prepara as pastas e os arquivos que ele precisa,
 * monta o ambiente limpo, roda e traduz a saída em eventos. Não sabe de
 * conversa nem de banco — isso é com quem chama.
 */

export interface PedidoCli {
  adaptador: AdaptadorCli;
  caminho: string;
  pasta: string;
  pastaExecucao: string;
  prompt: string;
  instrucoes: string;
  modelo: string | null;
  sessaoId: string | null;
  imagens: string[];
  mcp: ServidorMcp;
  tempoMaximoMs: number;
  sinal: AbortSignal;
  aoEvento: (evento: EventoAgente) => void;
  /** Ambiente de onde sai o ambiente limpo (o do Fluxo, por padrão). */
  env?: NodeJS.ProcessEnv;
  /** Variáveis da conta (a pasta de login), por cima das que o adaptador permite herdar. */
  envDaConta?: Record<string, string>;
}

export interface FalhaCli {
  codigo: CodigoErro;
  mensagem: string;
}

export interface ResultadoCli {
  fim: FimProcesso;
  /** A sessão pedida não existe mais: vale tentar de novo sem ela. */
  sessaoPerdida: boolean;
  falha: FalhaCli | null;
}

const MODO_PASTA = 0o700;
const MODO_ARQUIVO = 0o600;

export async function executarCli(p: PedidoCli): Promise<ResultadoCli> {
  for (const pasta of [p.pasta, p.pastaExecucao]) mkdirSync(pasta, { recursive: true, mode: MODO_PASTA });
  const comando = p.adaptador.montar({
    pasta: p.pasta, pastaExecucao: p.pastaExecucao, prompt: p.prompt, instrucoes: p.instrucoes, modelo: p.modelo,
    sessaoId: p.sessaoId, mcp: p.mcp, imagens: p.imagens,
  });
  for (const arquivo of comando.arquivos) gravarPrivado(arquivo.caminho, arquivo.conteudo);

  const env = ambienteLimpo(p.env ?? process.env, {
    permitidas: p.adaptador.variaveisPermitidas,
    extras: { ...p.envDaConta, ...comando.env },
    // CLIs que são scripts Node (#!/usr/bin/env node) precisam achar o Node; e o próprio CLI pode chamar irmãos.
    pastasNoPath: [dirname(process.execPath), dirname(p.caminho)],
  });
  const interprete = p.adaptador.novoInterprete();
  let respondeu = false;
  const fim = await rodarProcesso({
    caminho: p.caminho, args: comando.args, cwd: p.pasta, env, entrada: comando.entrada, tempoMaximoMs: p.tempoMaximoMs, sinal: p.sinal,
    aoLinha: (linha) => {
      for (const evento of interprete(linha)) {
        if (evento.tipo === 'texto' || evento.tipo === 'ferramenta') respondeu = true;
        p.aoEvento(evento);
      }
    },
  });
  const sessaoPerdida = Boolean(p.sessaoId) && fim.codigo !== 0 && !respondeu && p.adaptador.sessaoPerdida(fim.codigo, fim.stderr);
  return { fim, sessaoPerdida, falha: sessaoPerdida ? null : falhaDe(fim, p.adaptador, p.tempoMaximoMs) };
}

function gravarPrivado(caminho: string, conteudo: string): void {
  mkdirSync(dirname(caminho), { recursive: true, mode: MODO_PASTA });
  writeFileSync(caminho, conteudo, { mode: MODO_ARQUIVO });
  chmodSync(caminho, MODO_ARQUIVO); // se já existia com outra permissão
}

function falhaDe(fim: FimProcesso, adaptador: AdaptadorCli, tempoMaximoMs: number): FalhaCli | null {
  if (fim.motivo === 'cancelado') return null;
  if (fim.motivo === 'falha_ao_iniciar') {
    return { codigo: 'cli', mensagem: `Não consegui iniciar o ${adaptador.nome} (${fim.erroAoIniciar ?? 'erro desconhecido'}). Confira o caminho nos Ajustes.` };
  }
  if (fim.motivo === 'tempo') {
    return { codigo: 'tempo', mensagem: `A resposta passou de ${Math.round(tempoMaximoMs / 60_000)} minutos e foi interrompida.` };
  }
  if (fim.codigo === 0) return null;
  const stderr = semCores(fim.stderr);
  const conhecida = adaptador.explicarFalha(fim.codigo, stderr);
  if (conhecida) return conhecida;
  const detalhe = ultimaLinhaUtil(stderr);
  const codigo = fim.codigo === null ? `sinal ${fim.sinal ?? '?'}` : `código ${fim.codigo}`;
  return { codigo: 'desconhecido', mensagem: `O ${adaptador.nome} terminou com erro (${codigo})${detalhe ? `: ${detalhe}` : '.'}` };
}

function semCores(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

function ultimaLinhaUtil(stderr: string): string {
  const linhas = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  return cortar(linhas.at(-1) ?? '', 300);
}
