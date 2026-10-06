import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { CATEGORIA_POR_ID, categoriaExiste } from '../domain/categorias';

/** Valida e converte a entrada com um esquema zod; erro vira 400 com mensagem legível. */
export class Validar<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodType<T>) {}

  transform(valor: unknown): T {
    const r = this.esquema.safeParse(valor);
    if (r.success) return r.data;
    const motivo = r.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
    throw new BadRequestException(motivo);
  }
}

export const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM');
export const categoria = z.string().refine(categoriaExiste, 'categoria desconhecida');
export const natureza = z.enum(['DESPESA', 'RECEITA', 'ESTORNO', 'PAGAMENTO_FATURA', 'TRANSFERENCIA', 'INVESTIMENTO']);
/** Centavos: inteiro, sem negativo, até R$ 100 milhões — o suficiente e ainda longe de estourar número. */
export const centavos = z.number().int().min(0).max(10_000_000_000);
export const id = z.string().min(1).max(200).regex(/^[\w:.\-]+$/, 'identificador inválido');

export const consultaMes = z.object({ mes: mes.optional() });

export const filtroMovimentos = z.object({
  mes: mes.optional(),
  por: z.enum(['data', 'competencia']).optional(),
  contaId: id.optional(),
  categoriaId: categoria.optional(),
  natureza: natureza.optional(),
  busca: z.string().max(100).optional(),
  editados: z.enum(['1', 'true']).transform(() => true).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).optional(),
  tamanho: z.coerce.number().int().min(1).max(500).optional(),
});

export const ajusteMovimento = z
  .object({
    natureza: natureza.nullable().optional(),
    categoriaId: categoria.nullable().optional(),
    nota: z.string().trim().max(500).nullable().optional(),
    ignorar: z.boolean().optional(),
    /** Aplica a mesma categoria em tudo que tiver este trecho no nome, daqui para frente e para trás. */
    regra: z.object({ texto: z.string().trim().min(2).max(80) }).optional(),
  })
  .refine((a) => !a.regra || a.categoriaId, { message: 'para criar regra, informe a categoria', path: ['regra'] });

export const novaRegra = z.object({
  texto: z.string().trim().min(2).max(80),
  categoriaId: categoria,
  sentido: z.enum(['ENTRADA', 'SAIDA']).nullable().default(null),
});

export const limiteOrcamento = z.object({ limite: centavos });

export const meta = z.object({
  nome: z.string().trim().min(1).max(60),
  alvo: centavos.min(1),
  prazo: mes.nullable().default(null),
  caixinhaId: id.nullable().default(null),
  valorManual: centavos.default(0),
  icone: z.string().regex(/^[a-z-]{2,20}$/).default('alvo'),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8B5CF6'),
});

export const configuracoes = z.object({ caixinhasNoSaldo: z.boolean().optional() });

/** Ids da Pluggy são UUID; a demonstração tem o seu. Nada de "..", barras ou afins indo para a URL da API. */
export const idPluggy = z.uuid('identificador de conexão inválido');
export const idConexao = z.union([z.literal('demo-nubank'), idPluggy]);
export const tokenConexao = z.object({ itemId: idPluggy.optional() });
export const novaConexao = z.object({ itemId: idPluggy });
export const sincronizar = z.object({ pedirAoBanco: z.boolean().default(false) }).default({ pedirAoBanco: false });
export const remocao = z.object({ revogar: z.enum(['0', '1']).default('0') });

// ------------------------------------------------------------ contas a pagar

const MENSAGEM_DIA = 'data no formato AAAA-MM-DD';
/** Dia de calendário que existe de verdade (nada de 31/02). */
export const diaValido = z
  .string({ error: MENSAGEM_DIA })
  .regex(/^\d{4}-\d{2}-\d{2}$/, MENSAGEM_DIA)
  .refine((d) => {
    const [a, m, dia] = d.split('-').map(Number) as [number, number, number];
    const data = new Date(a, m - 1, dia);
    return data.getFullYear() === a && data.getMonth() === m - 1 && data.getDate() === dia;
  }, 'essa data não existe no calendário');

const textoOpcional = (maximo: number, rotulo: string) =>
  z.string({ error: `${rotulo} em texto` }).trim().max(maximo, `${rotulo} com até ${maximo} letras`)
    .nullable().transform((t) => t || null);

/** Campos de uma conta a pagar, sem valores padrão (o PATCH usa todos opcionais). */
const camposContaAPagar = {
  descricao: z.string({ error: 'informe a descrição' }).trim().min(1, 'informe a descrição').max(80, 'descrição com até 80 letras'),
  valor: z
    .number({ error: 'valor em centavos (número inteiro)' })
    .int('valor em centavos (número inteiro)')
    .min(1, 'o valor precisa ser maior que zero')
    .max(10_000_000_000, 'valor alto demais'),
  vencimento: diaValido,
  repete: z.enum(['nao', 'mensal', 'anual'], { error: "repete: use 'nao', 'mensal' ou 'anual'" }),
  categoriaId: z
    .string({ error: 'categoria desconhecida' })
    .refine((c) => CATEGORIA_POR_ID.get(c)?.grupo === 'DESPESA', 'categoria de gasto desconhecida')
    .nullable(),
  textoNoExtrato: textoOpcional(60, 'texto do extrato')
    .refine((t) => t === null || t.length >= 2, 'texto do extrato com pelo menos 2 letras'),
  nota: textoOpcional(500, 'nota'),
  origem: z.enum(['pessoa', 'assistente'], { error: "origem: use 'pessoa' ou 'assistente'" }),
};

export const dadosContaAPagar = z.object({
  ...camposContaAPagar,
  repete: camposContaAPagar.repete.default('nao'),
  categoriaId: camposContaAPagar.categoriaId.default(null),
  textoNoExtrato: camposContaAPagar.textoNoExtrato.default(null),
  nota: camposContaAPagar.nota.default(null),
  origem: camposContaAPagar.origem.default('pessoa'),
});

export const parcialContaAPagar = z.object(camposContaAPagar).partial();

export const filtroContasAPagar = z.object({
  de: diaValido.optional(),
  ate: diaValido.optional(),
  situacao: z.enum(['aberta', 'paga', 'atrasada'], { error: "situação: use 'aberta', 'paga' ou 'atrasada'" }).optional(),
});

export const pagamentoConta = z
  .object({ movimentoId: id.nullable().optional(), data: diaValido.optional() })
  .default({});
