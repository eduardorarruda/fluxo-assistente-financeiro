import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RELOGIO, type Relogio } from '../../relogio';
import { Anexos } from '../anexos/anexos';
import { identificarArquivo } from '../anexos/tipo-arquivo';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { ErroDeFerramenta, type EntradaGerarImagem, type GeradorDeImagens, type ImagemCriada } from '../ferramentas/catalogo';
import type { ConfigImagens } from '../tipos-api';
import { CofreChaveGemini } from './chave-gemini';
import { ErroDoGemini, gerarComGemini } from './cliente-gemini';
import { CUSTO_POR_IMAGEM_USD, modeloParaQualidade, type ModeloImagem } from './modelos-imagem';
import { RepositorioImagens } from './repositorio-imagens';

/** O `fetch` usado para falar com o Google (troca nos testes: nada de rede de verdade). */
export const BUSCAR_GEMINI = Symbol('BUSCAR_GEMINI');

const TAMANHO_DO_ALT = 120;
const TAMANHO_DO_NOME = 60;
const EXTENSAO: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export const SEM_CHAVE = 'Configure a chave do Gemini em Ajustes para gerar imagens (Ajustes → Assistente de IA → Imagens com Nano Banana).';

/**
 * Imagens com Nano Banana: a configuração (chave no cofre, modelo e limite no
 * banco) e a geração pedida pelo agente. A imagem vira anexo da própria
 * conversa, preso à resposta que está sendo gerada.
 */
@Injectable()
export class ServicoDeImagens implements GeradorDeImagens {
  private readonly log = new Logger('Imagens');

  constructor(
    private readonly preferencias: RepositorioImagens,
    private readonly cofre: CofreChaveGemini,
    private readonly anexos: Anexos,
    private readonly assistente: RepositorioAssistente,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Optional() @Inject(BUSCAR_GEMINI) private readonly buscar?: typeof fetch,
  ) {}

  config(): ConfigImagens {
    const p = this.preferencias.ler();
    return {
      configurada: this.cofre.configurada(),
      final: this.cofre.final(),
      modelo: p.modelo,
      limiteDiario: p.limiteDiario,
      geradasHoje: this.preferencias.geradasEm(this.relogio.hoje()),
    };
  }

  mudar(m: { chave?: string; modelo?: ModeloImagem; limiteDiario?: number }): ConfigImagens {
    if (m.chave !== undefined) this.cofre.salvar(m.chave);
    if (m.modelo !== undefined || m.limiteDiario !== undefined) {
      const atual = this.preferencias.ler();
      this.preferencias.salvar({ ...atual, modelo: m.modelo ?? atual.modelo, limiteDiario: m.limiteDiario ?? atual.limiteDiario });
    }
    return this.config();
  }

  removerChave(): ConfigImagens {
    this.cofre.remover();
    return this.config();
  }

  async gerar(conversaId: string, e: EntradaGerarImagem): Promise<ImagemCriada> {
    const chave = this.cofre.ler();
    if (!chave) throw new ErroDeFerramenta(SEM_CHAVE);
    const mensagemId = this.assistente.respostaGerando(conversaId);
    if (!mensagemId) throw new ErroDeFerramenta('Só dá para gerar imagem durante uma resposta desta conversa.');
    const prefs = this.preferencias.ler();
    const modelo = modeloParaQualidade(prefs.modelo, e.qualidade);
    const hoje = this.relogio.hoje();
    if (this.preferencias.geradasEm(hoje) >= prefs.limiteDiario) {
      throw new ErroDeFerramenta(`O limite de ${prefs.limiteDiario} imagens por dia já foi atingido. Dá para aumentar em Ajustes → Assistente de IA.`);
    }
    // Reserva a vaga antes de chamar (duas chamadas ao mesmo tempo não passam do limite); devolve se falhar.
    this.preferencias.contar(hoje, 1);
    try {
      const imagem = await gerarComGemini({ chave, modelo, descricao: e.descricao, proporcao: e.proporcao ?? '1:1' }, { buscar: this.buscar });
      if (identificarArquivo(imagem.bytes, 'imagem')?.tipo !== 'imagem') throw new ErroDeFerramenta('O Gemini devolveu um arquivo que não é imagem. Tente de novo.');
      const nome = `${resumir(e.descricao, TAMANHO_DO_NOME)}.${EXTENSAO[imagem.mime] ?? 'png'}`;
      const anexo = this.anexos.gravarGerada(conversaId, mensagemId, nome, imagem.bytes);
      return {
        anexoId: anexo.id,
        markdown: `![${resumir(e.descricao, TAMANHO_DO_ALT).replace(/[[\]()]/g, '')}](anexo:${anexo.id})`,
        custoEstimadoUsd: CUSTO_POR_IMAGEM_USD[modelo],
        modelo,
      };
    } catch (erro) {
      this.preferencias.contar(hoje, -1);
      if (erro instanceof ErroDoGemini) {
        this.log.warn(`Geração de imagem falhou (${erro.motivo}).`);
        throw new ErroDeFerramenta(erro.message);
      }
      throw erro;
    }
  }
}

function resumir(texto: string, limite: number): string {
  // eslint-disable-next-line no-control-regex
  const linha = texto.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return linha.length > limite ? `${linha.slice(0, limite - 1).trimEnd()}…` : linha || 'Imagem';
}
