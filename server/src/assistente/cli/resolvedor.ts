import { Injectable } from '@nestjs/common';
import { homedir } from 'node:os';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import type { ContaSalva } from '../tipos-api';
import { ADAPTADORES } from './adaptadores';
import { detectarCli, type ResultadoDeteccao } from './deteccao';
import type { AdaptadorCli, ProvedorIA } from './tipos';

/** A tela de Ajustes consulta várias vezes seguidas; detectar de novo a cada vez é desperdício. */
const VALIDADE_MS = 30_000;

/**
 * Onde está cada CLI, conforme a configuração salva (caminho escolhido ou
 * detecção automática) — e, para rodar, se ele está pronto.
 */
@Injectable()
export class ResolvedorDeClis {
  private readonly cache = new Map<string, { quando: number; resultado: Promise<ResultadoDeteccao> }>();

  constructor(private readonly repo: RepositorioAssistente) {}

  detectar(provedor: ProvedorIA, caminho: string | null): Promise<ResultadoDeteccao> {
    const chave = `${provedor}|${caminho ?? ''}`;
    const guardado = this.cache.get(chave);
    if (guardado && Date.now() - guardado.quando < VALIDADE_MS) return guardado.resultado;
    const resultado = detectarCli(provedor, caminho, { env: process.env, home: homedir() });
    this.cache.set(chave, { quando: Date.now(), resultado });
    return resultado;
  }

  esquecer(): void {
    this.cache.clear();
  }

  /** O que o executor usa: o caminho pronto para rodar (e a pasta de login da conta), ou o motivo de não dar. */
  async resolver(contaId: string): Promise<CliResolvido | { erro: string }> {
    const conta = this.repo.lerConfig().contas.find((c) => c.id === contaId);
    if (!conta) return { erro: 'Essa conta não existe mais. Escolha outra no topo da conversa.' };
    if (conta.tipo === 'api') return { erro: `A conta “${conta.nome}” é por chave de API, não por CLI.` };
    const adaptador = ADAPTADORES[conta.provedor];
    if (!conta.ativo) return { erro: `A conta “${conta.nome}” está desligada nos Ajustes do assistente.` };
    const r = await this.detectar(conta.provedor, conta.caminho);
    if (r.erro) return { erro: `O caminho do ${adaptador.nome} na conta “${conta.nome}” não serve: ${r.erro}` };
    if (!r.encontrado) return { erro: `O ${adaptador.nome} não foi encontrado neste computador. Para instalar: ${adaptador.comoInstalar}` };
    return { caminho: r.encontrado.caminho, adaptador, conta, env: envDaConta(adaptador, conta) };
  }
}

export interface CliResolvido {
  caminho: string;
  adaptador: AdaptadorCli;
  conta: ContaSalva;
  /** A pasta de login da conta, na variável que o CLI entende (vazio = login padrão). */
  env: Record<string, string>;
}

export function envDaConta(adaptador: AdaptadorCli, conta: ContaSalva): Record<string, string> {
  return conta.pastaLogin ? { [adaptador.variavelDeConta]: conta.pastaLogin } : {};
}

/** O comando de login desta conta, pronto para colar no terminal (bash, zsh e fish 3.1+). */
export function comoEntrarNaConta(adaptador: AdaptadorCli, conta: ContaSalva): string {
  return conta.pastaLogin ? `${adaptador.variavelDeConta}='${conta.pastaLogin}' ${adaptador.comoEntrar}` : adaptador.comoEntrar;
}
