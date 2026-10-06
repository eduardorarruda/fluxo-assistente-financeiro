import { z } from 'zod';
import { id } from '../../http/validacao';
import { FORMATO_CHAVE_API } from '../apis/chaves-de-api';
import { comoObjeto } from '../cli/comum';
import { PROVEDORES } from '../cli/tipos';
import { FORMATO_CHAVE_GEMINI } from '../imagens/chave-gemini';
import { LIMITE_DIARIO_MAXIMO, MODELOS_IMAGEM } from '../imagens/modelos-imagem';

export const provedor = z.enum(PROVEDORES);

/**
 * Nome de modelo vai para a linha de comando do CLI: começa com letra ou
 * número (nunca "-", senão "--model --yolo" viraria uma opção) e só usa
 * caracteres de nome de modelo.
 */
export const modelo = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9][\w.:/@-]*$/, 'nome de modelo inválido')
  .nullable();

const textoOuNulo = (s: string | null | undefined) => (s === undefined ? undefined : s?.trim() ? s.trim() : null);
const opcionalOuNulo = z.string().max(500).nullable().optional().transform(textoOuNulo);
/** Modelo vazio ("") = voltar ao padrão. */
const modeloOpcional = z.union([modelo, z.literal('')]).optional().transform((m) => (m === '' ? null : m));

/**
 * Chave de API (Anthropic, Gemini, OpenAI): ASCII visível sem espaço, 20 a 300
 * caracteres, depois de tirar espaços das pontas. A mensagem de erro nunca
 * repete o valor (o zod só diz o motivo).
 */
export const chaveDeApi = z.string().trim().regex(FORMATO_CHAVE_API, 'formato de chave inválido: cole a chave inteira, sem espaços');

const nomeDaConta = z.string().trim().min(1).max(60);

export const dadosConta = z.object({
  nome: nomeDaConta.optional(),
  ativo: z.boolean().optional(),
  caminho: opcionalOuNulo,
  modelo: modeloOpcional,
  pastaLogin: opcionalOuNulo,
  /** Só contas por API: troca a chave. */
  chave: chaveDeApi.optional(),
});

const novaContaCli = dadosConta.omit({ chave: true }).extend({ tipo: z.literal('cli'), provedor, nome: nomeDaConta });
/** Conta por API: sem caminho nem pasta de login (se vierem, são ignorados). */
const novaContaApi = z.object({ tipo: z.literal('api'), provedor, nome: nomeDaConta, chave: chaveDeApi, modelo: modeloOpcional, ativo: z.boolean().optional() });

/** Sem `tipo`, é conta de CLI: o corpo de antes das contas por API continua valendo. */
export const novaConta = z.preprocess(
  (corpo) => {
    const objeto = comoObjeto(corpo);
    return objeto && objeto.tipo === undefined ? { ...objeto, tipo: 'cli' } : corpo;
  },
  z.discriminatedUnion('tipo', [novaContaCli, novaContaApi]),
);
export const contaPadrao = z.object({ contaPadrao: id });

export const novaConversa = z.object({ contaId: id.optional(), modelo: modeloOpcional });

export const alteracaoConversa = z.object({
  titulo: z.string().trim().min(1).max(120).optional(),
  fixada: z.boolean().optional(),
  contaId: id.optional(),
  modelo: modeloOpcional,
});

export const novaMensagem = z.object({
  texto: z.string().max(20_000),
  anexos: z.array(id).max(20).default([]),
  contaId: id.optional(),
  modelo: modeloOpcional,
  /** Veio do modo conversação (voz): a resposta vai ser falada. */
  voz: z.boolean().optional(),
});

export const buscaConversas = z.object({ busca: z.string().max(100).optional() });
export const nomeDoAnexo = z.object({ nome: z.string().min(1).max(255) });
export const desde = z.object({ desde: z.coerce.number().int().min(0).default(0) });
export const chamadaDeFerramenta = z.object({ entrada: z.record(z.string(), z.unknown()).default({}) });
export const nomeDeFerramenta = z.string().regex(/^[a-z_]{1,60}$/, 'ferramenta inválida');

/** A chave nunca volta na mensagem de erro (o zod só diz o motivo, não o valor). */
export const mudancaImagens = z.object({
  chave: z.string().trim().regex(FORMATO_CHAVE_GEMINI, 'formato de chave inválido: cole a chave inteira do Google AI Studio').optional(),
  modelo: z.enum(MODELOS_IMAGEM).optional(),
  limiteDiario: z.number().int().min(1).max(LIMITE_DIARIO_MAXIMO).optional(),
}).strict();
