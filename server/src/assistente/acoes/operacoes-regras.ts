import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CATEGORIA_POR_ID } from '../../domain/categorias';
import type { Regra } from '../../domain/categorizacao';
import { montarMovimentos } from '../../domain/movimentos';
import { normalizar } from '../../domain/texto';
import type { Movimento } from '../../domain/types';
import { contextoDoTitular } from '../../servicos/financas';
import { brl, exigirCategoria, grupoDaNatureza, nomeDaCategoria, operacao, plural, type ContextoOperacoes, type Operacao, type Previa } from './operacoes';
import { exemplos, periodo, somaDe } from './operacoes-movimentos';
import { ErroDeAcao } from './tipos-acoes';

/**
 * Regras de categoria valem para o passado inteiro e para o futuro (são
 * aplicadas na leitura): por isso são sempre proposta, e a proposta mostra o
 * efeito de verdade — os movimentos de hoje classificados com e sem a regra.
 */

export interface Simulacao {
  /** Movimentos que mudam de categoria (como ficam depois). */
  mudam: { antes: Movimento; depois: Movimento }[];
  /** Casam com o texto mas têm categoria escolhida à mão: não mudam. */
  protegidos: number;
  /** Casam, mas uma regra mais antiga vem antes e continua valendo. */
  sombreados: { regra: Regra; quantos: number }[];
  /** Quantos movimentos têm o texto (e o tipo certo), mudando ou não. */
  casam: number;
}

function casa(m: Movimento, regra: Pick<Regra, 'texto' | 'sentido' | 'categoriaId'>): boolean {
  if (regra.sentido && regra.sentido !== m.sentido) return false;
  const grupo = CATEGORIA_POR_ID.get(regra.categoriaId)?.grupo;
  if (!grupo || grupoDaNatureza(m.natureza) !== grupo) return false;
  const trecho = normalizar(regra.texto);
  return Boolean(trecho) && normalizar(`${m.descricao} ${m.estabelecimento ?? ''} ${m.contraparteNome ?? ''}`).includes(trecho);
}

/** O que muda trocando o conjunto de regras de `antes` para `depois`. `alvo` é a regra criada/removida. */
export function simular(ctx: ContextoOperacoes, antes: readonly Regra[], depois: readonly Regra[], alvo: Regra): Simulacao {
  // Os movimentos de hoje classificados com e sem a mudança — o mesmo cálculo das telas.
  const inst = ctx.repositorio.instantaneo();
  const classificar = (regras: readonly Regra[]) => montarMovimentos(inst.transacoes, contextoDoTitular(inst), regras, inst.ajustes);
  const com = classificar(depois);
  const sem = new Map(classificar(antes).map((m) => [m.id, m]));
  const s: Simulacao = { mudam: [], protegidos: 0, sombreados: [], casam: 0 };
  const sombra = new Map<string, number>();
  const ordenadas = [...antes].sort((a, b) => a.prioridade - b.prioridade);
  for (const m of com) {
    const anterior = sem.get(m.id);
    if (!anterior) continue;
    if (anterior.categoriaId !== m.categoriaId) s.mudam.push({ antes: anterior, depois: m });
    if (!casa(anterior, alvo)) continue;
    s.casam++;
    if (anterior.categoriaId !== m.categoriaId || anterior.categoriaId === alvo.categoriaId) continue;
    if (inst.ajustes.get(m.id)?.categoriaId) s.protegidos++;
    else {
      const vence = ordenadas.find((r) => r.id !== alvo.id && casa(anterior, r));
      if (vence) sombra.set(vence.id, (sombra.get(vence.id) ?? 0) + 1);
    }
  }
  s.sombreados = [...sombra].map(([id, quantos]) => ({ regra: ordenadas.find((r) => r.id === id)!, quantos }));
  return s;
}

function efeitoDaSimulacao(s: Simulacao, futuro: string): string {
  const depois = s.mudam.map((x) => x.depois);
  const partes = [
    depois.length
      ? `Muda ${plural(depois.length, 'movimento', 'movimentos')} (${brl(somaDe(depois))}), ${periodo(depois)}.`
      : 'Hoje não muda nenhum movimento.',
    futuro,
    s.protegidos ? `${plural(s.protegidos, 'movimento com categoria escolhida à mão fica', 'movimentos com categoria escolhida à mão ficam')} como ${s.protegidos === 1 ? 'está' : 'estão'}.` : '',
    ...s.sombreados.map(({ regra, quantos }) =>
      `A regra “${regra.texto}” (${nomeDaCategoria(regra.categoriaId)}) vem antes e continua valendo para ${plural(quantos, 'movimento', 'movimentos')}.`),
  ];
  return partes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- criar

const novaRegra = z.object({
  texto: z.string().trim().min(2).max(80),
  categoriaId: z.string().min(1).max(60),
  sentido: z.enum(['ENTRADA', 'SAIDA']).nullable(),
});
type PayloadNovaRegra = z.output<typeof novaRegra>;

function conferirNova(ctx: ContextoOperacoes, p: PayloadNovaRegra): Regra[] {
  exigirCategoria(p.categoriaId);
  if (normalizar(p.texto).length < 2) throw new ErroDeAcao('O texto da regra precisa ter pelo menos 2 letras.');
  const atuais = ctx.leitura.regras();
  const igual = atuais.find((r) => normalizar(r.texto) === normalizar(p.texto) && r.categoriaId === p.categoriaId && r.sentido === p.sentido);
  if (igual) throw new ErroDeAcao(`Essa regra já existe: “${igual.texto}” → ${nomeDaCategoria(igual.categoriaId)}.`);
  return atuais;
}

function previaNovaRegra(ctx: ContextoOperacoes, p: PayloadNovaRegra): Previa {
  const atuais = conferirNova(ctx, p);
  const prioridade = Math.max(0, ...atuais.map((r) => r.prioridade)) + 1;
  const simulada: Regra = { id: 'simulada', texto: p.texto, categoriaId: p.categoriaId, sentido: p.sentido, prioridade };
  const s = simular(ctx, atuais, [...atuais, simulada], simulada);
  const categoria = nomeDaCategoria(p.categoriaId);
  const sentido = p.sentido === 'SAIDA' ? ' (só nas saídas)' : p.sentido === 'ENTRADA' ? ' (só nas entradas)' : '';
  return {
    titulo: 'Criar regra de categoria',
    descricao: `Tudo que tiver “${p.texto}” na descrição${sentido} vai para ${categoria} — nos movimentos de antes e nos próximos.`,
    efeito: efeitoDaSimulacao(s, 'Vale também para os próximos.'),
    exemplos: exemplos(s.mudam.map((x) => x.antes), () => categoria),
  };
}

export function criarRegra(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'criar_regra',
    modo: 'proposta',
    payload: novaRegra,
    prever: (p) => previaNovaRegra(ctx, p),
    executar: (p) => {
      conferirNova(ctx, p);
      const regra = ctx.repositorio.criarRegra({ id: randomUUID(), texto: p.texto, categoriaId: p.categoriaId, sentido: p.sentido });
      return { inverso: { tipo: 'regra_criada', regra } };
    },
  });
}

// ---------------------------------------------------------------- remover

const remocao = z.object({ regraId: z.string().min(1).max(200) });

function exigirRegra(ctx: ContextoOperacoes, id: string): Regra {
  const regra = ctx.leitura.regra(id);
  if (!regra) throw new ErroDeAcao('Regra não encontrada. Veja as regras com a ferramenta regras_de_categoria.');
  return regra;
}

export function removerRegra(ctx: ContextoOperacoes): Operacao {
  return operacao({
    tipo: 'remover_regra',
    modo: 'proposta',
    payload: remocao,
    prever: (p) => {
      const regra = exigirRegra(ctx, p.regraId);
      const atuais = ctx.leitura.regras();
      const s = simular(ctx, atuais, atuais.filter((r) => r.id !== regra.id), regra);
      const n = s.mudam.length;
      return {
        titulo: 'Remover regra de categoria',
        descricao: `Remover a regra “${regra.texto}” → ${nomeDaCategoria(regra.categoriaId)}.`,
        efeito: n
          ? `${plural(n, 'movimento volta', 'movimentos voltam')} para a categoria automática (${brl(somaDe(s.mudam.map((x) => x.depois)))}).`
          : 'Nenhum movimento muda hoje.',
        exemplos: exemplos(s.mudam.map((x) => x.antes), (m) => nomeDaCategoria(s.mudam.find((x) => x.antes.id === m.id)?.depois.categoriaId)),
      };
    },
    executar: (p) => {
      const regra = exigirRegra(ctx, p.regraId);
      ctx.repositorio.removerRegra(regra.id);
      return { inverso: { tipo: 'regra_removida', regra } };
    },
  });
}
