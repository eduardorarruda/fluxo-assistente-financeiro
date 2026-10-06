import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, type Config } from '../../config';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import type { TextosDeAnexos } from '../ferramentas/catalogo';
import { Indexador } from '../rag/indexador';
import type { Anexo } from '../tipos-api';
import { identificarArquivo } from './tipo-arquivo';

export const TAMANHO_MAXIMO_ANEXO = 15 * 1024 * 1024;
export const ANEXOS_POR_CONVERSA = 20;
const ESPERA_INDEXACAO_MS = 60_000;
const TAMANHO_DO_NOME = 120;

/**
 * Os arquivos que a pessoa anexa. O tipo é decidido pelos bytes; o nome
 * original fica só no banco (no disco é `<uuid>.<extensão>`, numa pasta
 * 0700). PDF e texto são extraídos e indexados para a busca; imagem vai
 * direto para o CLI olhar.
 */
@Injectable()
export class Anexos implements TextosDeAnexos {
  private readonly log = new Logger('Anexos');
  private readonly indexando = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: RepositorioAssistente,
    private readonly indexador: Indexador,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  pastaDaConversa(conversaId: string): string {
    return join(this.config.pastaAssistente, 'conversas', conversaId);
  }

  caminho(conversaId: string, arquivo: string): string {
    return join(this.pastaDaConversa(conversaId), 'anexos', arquivo);
  }

  private caminhoDoTexto(anexoId: string): string {
    return join(this.config.pastaAssistente, 'textos', `${anexoId}.txt`);
  }

  receber(conversaId: string, nomeOriginal: string, bytes: Buffer): Anexo {
    if (!bytes.length) throw new BadRequestException('O arquivo está vazio.');
    if (bytes.length > TAMANHO_MAXIMO_ANEXO) throw new HttpException('O arquivo passa de 15 MB.', HttpStatus.PAYLOAD_TOO_LARGE);
    if (this.repo.anexosDaConversa(conversaId).filter((a) => a.origem === 'pessoa').length >= ANEXOS_POR_CONVERSA) {
      throw new BadRequestException(`Esta conversa já tem ${ANEXOS_POR_CONVERSA} anexos, o máximo.`);
    }
    const nome = limparNome(nomeOriginal);
    const tipo = identificarArquivo(bytes, nome);
    if (!tipo) throw new BadRequestException('Tipo de arquivo não aceito. Envie imagem (PNG, JPG, WEBP, GIF), PDF, TXT, MD, CSV, OFX ou JSON.');
    const id = randomUUID();
    const arquivo = `${id}.${tipo.extensao}`;
    gravarPrivado(this.caminho(conversaId, arquivo), bytes);
    const anexo = this.repo.criarAnexo({
      id, conversaId, nome, mime: tipo.mime, tipo: tipo.tipo, tamanho: bytes.length, arquivo, sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    if (tipo.tipo === 'imagem') {
      this.repo.atualizarAnexo(id, { situacao: 'pronto' });
      return { ...anexo, situacao: 'pronto' };
    }
    this.repo.atualizarAnexo(id, { situacao: 'indexando' });
    const tarefa = this.indexar(id, conversaId, tipo.tipo, bytes).finally(() => this.indexando.delete(id));
    this.indexando.set(id, tarefa);
    return { ...anexo, situacao: 'indexando' };
  }

  /**
   * Imagem criada pelo assistente: já nasce presa à resposta que a gerou (não aparece na caixa
   * de texto) e marcada como 'gerada'. Os bytes vêm de fora (a API do Gemini): só passa imagem.
   */
  gravarGerada(conversaId: string, mensagemId: string, nomeOriginal: string, bytes: Buffer): Anexo {
    if (!bytes.length || bytes.length > TAMANHO_MAXIMO_ANEXO) throw new Error('A imagem gerada veio vazia ou grande demais.');
    const tipo = identificarArquivo(bytes, 'imagem');
    if (tipo?.tipo !== 'imagem') throw new Error('A resposta do gerador não é uma imagem.');
    const id = randomUUID();
    const arquivo = `${id}.${tipo.extensao}`;
    gravarPrivado(this.caminho(conversaId, arquivo), bytes);
    this.repo.criarAnexo({
      id, conversaId, mensagemId, origem: 'gerada', nome: limparNome(nomeOriginal), mime: tipo.mime, tipo: 'imagem', tamanho: bytes.length, arquivo,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    this.repo.atualizarAnexo(id, { situacao: 'pronto' });
    return this.repo.anexo(id)!;
  }

  /** Onde está a imagem de um anexo, para servir à tela. Só imagem: PDF e texto nunca saem por aqui. */
  imagem(anexoId: string): { caminho: string; mime: string; nome: string } {
    const anexo = this.repo.anexo(anexoId);
    if (anexo?.tipo !== 'imagem') throw new NotFoundException('Imagem não encontrada.');
    return { caminho: this.caminho(anexo.conversaId, anexo.arquivo), mime: anexo.mime, nome: anexo.nome };
  }

  private async indexar(id: string, conversaId: string, tipo: 'pdf' | 'texto', bytes: Buffer): Promise<void> {
    try {
      const r = await this.indexador.indexarAnexo({ id, conversaId, tipo }, bytes);
      gravarPrivado(this.caminhoDoTexto(id), r.texto);
      this.repo.atualizarAnexo(id, { situacao: r.situacao });
    } catch (e) {
      this.log.warn(`Não consegui ler o anexo ${id}: ${(e as Error).message}`);
      this.repo.atualizarAnexo(id, { situacao: 'erro', erro: (e as Error).message });
    }
  }

  /** Espera a extração dos anexos que vão numa mensagem (o agente precisa do texto). */
  async aguardarIndexacao(ids: readonly string[]): Promise<void> {
    const pendentes = ids.map((id) => this.indexando.get(id)).filter((p): p is Promise<void> => Boolean(p));
    if (!pendentes.length) return;
    let relogio: NodeJS.Timeout | undefined;
    const limite = new Promise<void>((resolver) => {
      relogio = setTimeout(resolver, ESPERA_INDEXACAO_MS);
    });
    await Promise.race([Promise.all(pendentes), limite]);
    clearTimeout(relogio);
  }

  texto(anexoId: string): string | null {
    try {
      return readFileSync(this.caminhoDoTexto(anexoId), 'utf8');
    } catch {
      return null;
    }
  }

  /** Só o que ainda não foi enviado (o que foi enviado faz parte da conversa). */
  remover(anexoId: string): void {
    const anexo = this.repo.anexo(anexoId);
    if (!anexo) throw new NotFoundException('Anexo não encontrado.');
    if (anexo.mensagemId) throw new BadRequestException('Este anexo já foi enviado numa mensagem.');
    this.apagarArquivos(anexo.id, anexo.conversaId, anexo.arquivo);
    this.indexador.removerAnexo(anexo.id);
    this.repo.removerAnexo(anexo.id);
  }

  /** Apaga do disco e do índice tudo o que é da conversa (o banco apaga as linhas em cascata). */
  removerDaConversa(conversaId: string): void {
    for (const a of this.repo.anexosDaConversa(conversaId)) rmSync(this.caminhoDoTexto(a.id), { force: true });
    rmSync(this.pastaDaConversa(conversaId), { recursive: true, force: true });
    this.indexador.removerConversa(conversaId);
  }

  private apagarArquivos(id: string, conversaId: string, arquivo: string): void {
    rmSync(this.caminho(conversaId, arquivo), { force: true });
    rmSync(this.caminhoDoTexto(id), { force: true });
  }
}

/** O nome só aparece na tela e no prompt: sem caminho, sem caracteres de controle, tamanho razoável. */
export function limparNome(nome: string): string {
  // eslint-disable-next-line no-control-regex
  const limpo = (nome.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (limpo || 'arquivo').slice(0, TAMANHO_DO_NOME);
}

function gravarPrivado(caminho: string, conteudo: Buffer | string): void {
  mkdirSync(join(caminho, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(caminho, conteudo, { mode: 0o600 });
  chmodSync(caminho, 0o600);
}
