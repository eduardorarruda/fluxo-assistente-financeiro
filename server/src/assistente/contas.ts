import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { ChavesDeApi } from './apis/chaves-de-api';
import { ModelosAoVivo, type ListaDeModelos } from './apis/modelos-ao-vivo';
import { PROVEDORES_API } from './apis/provedores-api';
import { ADAPTADORES } from './cli/adaptadores';
import { validarCaminho } from './cli/deteccao';
import { comoEntrarNaConta, ResolvedorDeClis } from './cli/resolvedor';
import type { ModeloIA } from './cli/modelos';
import { PROVEDORES, type ProvedorIA } from './cli/tipos';
import { RepositorioAssistente } from './dados/repositorio-assistente';
import { Execucoes } from './execucao/execucoes';
import { Indexador, type EstadoRag } from './rag/indexador';
import type { ConfigAssistenteSalva, ContaSalva } from './tipos-api';

/**
 * As contas do assistente: cada uma é um login de um CLI ou uma chave de API.
 * Várias do mesmo CLI convivem porque cada uma aponta a sua pasta de login
 * (CLAUDE_CONFIG_DIR, GEMINI_CLI_HOME, CODEX_HOME) — pessoal e trabalho, dois
 * planos, etc. Contas por API podem ser quantas a pessoa quiser por provedor;
 * a chave fica em `ChavesDeApi` e daqui só sai o final dela ("…AbCd").
 */

export interface ContaIA extends ContaSalva {
  caminhoDetectado: string | null;
  /** CLI: achou o programa. API: há chave guardada. */
  instalado: boolean;
  versao: string | null;
  /** Comando de login do CLI; '' nas contas por API. */
  comoEntrar: string;
  /** "…AbCd" nas contas por API com chave; null no resto. */
  chaveFinal: string | null;
}

export interface ProvedorInfo {
  provedor: ProvedorIA;
  nome: string;
  variavelDeConta: string;
  modelosSugeridos: string[];
  modelos: ModeloIA[];
  comoInstalar: string;
  /** O mesmo provedor por chave de API (Anthropic, Gemini API, OpenAI). */
  api: { nome: string; ondeCriarChave: string; modelos: ModeloIA[] };
}

export interface ConfigAssistente {
  contaPadrao: string | null;
  contas: ContaIA[];
  provedores: ProvedorInfo[];
  pastaSugerida: string;
  rag: EstadoRag;
}

export interface DadosConta {
  nome?: string;
  ativo?: boolean;
  caminho?: string | null;
  modelo?: string | null;
  pastaLogin?: string | null;
  /** Só contas por API: troca a chave. */
  chave?: string;
}

export type NovaConta =
  | (Omit<DadosConta, 'chave'> & { tipo: 'cli'; provedor: ProvedorIA; nome: string })
  | { tipo: 'api'; provedor: ProvedorIA; nome: string; chave: string; modelo?: string | null; ativo?: boolean };

@Injectable()
export class ServicoDeContas {
  constructor(
    private readonly repo: RepositorioAssistente,
    private readonly execucoes: Execucoes,
    private readonly indexador: Indexador,
    private readonly clis: ResolvedorDeClis,
    private readonly chaves: ChavesDeApi,
    private readonly modelosAoVivo: ModelosAoVivo,
  ) {}

  async config(): Promise<ConfigAssistente> {
    const salvo = this.repo.lerConfig();
    const contas = await Promise.all(salvo.contas.map((c) => this.info(c)));
    return {
      contaPadrao: padraoEfetivo(salvo.contaPadrao, contas)?.id ?? null,
      contas,
      provedores: PROVEDORES.map((p) => {
        const a = ADAPTADORES[p];
        const api = PROVEDORES_API[p];
        return {
          provedor: p, nome: a.nome, variavelDeConta: a.variavelDeConta, modelosSugeridos: a.modelos.map((m) => m.id), modelos: [...a.modelos],
          comoInstalar: a.comoInstalar, api: { nome: api.nome, ondeCriarChave: api.ondeCriarChave, modelos: [...api.modelos] },
        };
      }),
      pastaSugerida: join(homedir(), '.config', 'fluxo', 'contas'),
      rag: this.indexador.estado(),
    };
  }

  /** A conta que responde quando a conversa não escolheu: a padrão, se pronta; senão a primeira pronta. */
  async padrao(): Promise<ContaSalva | null> {
    const salvo = this.repo.lerConfig();
    return padraoEfetivo(salvo.contaPadrao, await Promise.all(salvo.contas.map((c) => this.info(c))));
  }

  existe(id: string): ContaSalva {
    const conta = this.repo.lerConfig().contas.find((c) => c.id === id);
    if (!conta) throw new NotFoundException('Conta não encontrada.');
    return conta;
  }

  async definirPadrao(contaId: string): Promise<ConfigAssistente> {
    this.existe(contaId);
    this.salvar({ ...this.repo.lerConfig(), contaPadrao: contaId });
    return this.config();
  }

  async criar(pedido: NovaConta): Promise<ConfigAssistente> {
    const config = this.repo.lerConfig();
    if (pedido.tipo === 'api') {
      const { chave, ...dados } = pedido;
      const nova: ContaSalva = { id: randomUUID(), ...dados, ativo: dados.ativo ?? true, caminho: null, modelo: dados.modelo ?? null, pastaLogin: null };
      this.chaves.salvar(nova.id, chave);
      try {
        this.salvar({ ...config, contas: [...config.contas, nova] });
      } catch (e) {
        this.chaves.remover(nova.id);
        throw e;
      }
      return this.config();
    }
    const { tipo, provedor, ...dados } = pedido;
    const nova: ContaSalva = { id: randomUUID(), provedor, nome: dados.nome, ativo: dados.ativo ?? true, tipo, caminho: null, modelo: null, pastaLogin: null };
    this.salvar({ ...config, contas: [...config.contas, this.aplicar(nova, dados, config.contas)] });
    return this.config();
  }

  async atualizar(id: string, dados: DadosConta): Promise<ConfigAssistente> {
    const config = this.repo.lerConfig();
    const atual = this.existe(id);
    const outras = config.contas.filter((c) => c.id !== id);
    const nova = atual.tipo === 'api' ? this.aplicarApi(atual, dados) : this.aplicar(atual, semChave(dados), outras);
    this.salvar({ ...config, contas: config.contas.map((c) => (c.id === id ? nova : c)) });
    return this.config();
  }

  /** Não remove a última; as conversas da conta removida passam para outra (preferindo o mesmo CLI). */
  async remover(id: string): Promise<ConfigAssistente> {
    const config = this.repo.lerConfig();
    const removida = this.existe(id);
    const restantes = config.contas.filter((c) => c.id !== id);
    if (!restantes.length) throw new BadRequestException('É preciso ter pelo menos uma conta.');
    const herdeira = restantes.find((c) => c.id === config.contaPadrao) ?? restantes.find((c) => c.provedor === removida.provedor) ?? restantes[0]!;
    this.repo.reatribuirConversas(id, herdeira);
    this.salvar({ contaPadrao: config.contaPadrao === id ? null : config.contaPadrao, contas: restantes });
    if (removida.tipo === 'api') {
      this.chaves.remover(id);
      this.modelosAoVivo.esquecer(id);
    }
    return this.config();
  }

  testar(id: string) {
    this.existe(id);
    return this.execucoes.testar(id);
  }

  /** Os modelos para o seletor: ao vivo da API (contas por chave) ou o catálogo do CLI. */
  async modelos(id: string): Promise<ListaDeModelos> {
    const conta = this.existe(id);
    if (conta.tipo === 'cli') return { modelos: [...ADAPTADORES[conta.provedor].modelos], aoVivo: false };
    return this.modelosAoVivo.listar(conta.id, conta.provedor, this.chaves.ler(conta.id));
  }

  /** Conta por API: muda nome, ativo, modelo e a chave; caminho e pasta de login não existem nela. */
  private aplicarApi(conta: ContaSalva, dados: DadosConta): ContaSalva {
    const { chave, caminho, pastaLogin, ...resto } = dados;
    if (caminho || pastaLogin) throw new BadRequestException('Conta por API não tem caminho do programa nem pasta de login.');
    if (chave) {
      this.chaves.salvar(conta.id, chave);
      this.modelosAoVivo.esquecer(conta.id);
    }
    return { ...conta, ...definidos(resto) };
  }

  private aplicar(conta: ContaSalva, dados: Omit<DadosConta, 'chave'>, outras: readonly ContaSalva[]): ContaSalva {
    const nova = { ...conta, ...definidos(dados) };
    if (nova.caminho) {
      const erro = validarCaminho(nova.caminho, ADAPTADORES[nova.provedor].binario);
      if (erro) throw new BadRequestException(`Caminho do programa: ${erro}`);
    }
    if (nova.pastaLogin) {
      const erro = validarPastaLogin(nova.pastaLogin);
      if (erro) throw new BadRequestException(`Pasta de login: ${erro}`);
    }
    if (outras.some((c) => c.tipo === 'cli' && c.provedor === nova.provedor && (c.pastaLogin ?? '') === (nova.pastaLogin ?? ''))) {
      throw new BadRequestException(`Já existe uma conta do ${ADAPTADORES[nova.provedor].nome} com essa pasta de login. Use outra pasta para outra conta.`);
    }
    // O CLI grava o login nela; criar já (só para você) evita o CLI criar com permissão aberta.
    if (nova.pastaLogin) mkdirSync(nova.pastaLogin, { recursive: true, mode: 0o700 });
    return nova;
  }

  private salvar(config: ConfigAssistenteSalva): void {
    this.repo.salvarConfig(config);
    this.clis.esquecer();
  }

  private async info(c: ContaSalva): Promise<ContaIA> {
    if (c.tipo === 'api') {
      const chaveFinal = this.chaves.final(c.id);
      return { ...c, caminhoDetectado: null, instalado: chaveFinal !== null, versao: null, comoEntrar: '', chaveFinal };
    }
    const a = ADAPTADORES[c.provedor];
    const r = await this.clis.detectar(c.provedor, c.caminho);
    return {
      ...c, caminhoDetectado: r.encontrado?.caminho ?? null, instalado: Boolean(r.encontrado), versao: r.encontrado?.versao ?? null,
      comoEntrar: comoEntrarNaConta(a, c), chaveFinal: null,
    };
  }
}

/** Pasta de login: absoluta, sem "..", sem aspas (vai entre aspas simples no comando de login). */
export function validarPastaLogin(pasta: string): string | null {
  if (!isAbsolute(pasta)) return 'informe o caminho absoluto (começando com /).';
  if (/['"\\\n\r\0`$]/.test(pasta)) return 'não use aspas, barra invertida, $ ou crase no caminho.';
  if (normalize(pasta) !== pasta.replace(/\/+$/, '') || pasta.split('/').includes('..')) return 'caminho inválido.';
  if (pasta === '/' || pasta.length > 500) return 'caminho inválido.';
  return null;
}

/** Chave em conta de CLI não existe: recusa em vez de ignorar calado. */
function semChave(dados: DadosConta): Omit<DadosConta, 'chave'> {
  const { chave, ...resto } = dados;
  if (chave !== undefined) throw new BadRequestException('Só conta por API tem chave. Esta conta usa o login do CLI.');
  return resto;
}

function definidos(dados: Omit<DadosConta, 'chave'>): Partial<ContaSalva> {
  return Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined)) as Partial<ContaSalva>;
}

function padraoEfetivo<T extends ContaSalva & { instalado: boolean }>(padrao: string | null, contas: readonly T[]): T | null {
  const prontas = contas.filter((c) => c.ativo && c.instalado);
  return prontas.find((c) => c.id === padrao) ?? prontas[0] ?? null;
}
