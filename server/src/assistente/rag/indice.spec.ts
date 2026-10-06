import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, type Banco } from '../../db/conexao';
import { IndiceDeTrechos } from './indice';
import { normalizado } from './testing/vetorizador-falso';

const v = (...valores: number[]) => normalizado(valores);

function contarVetores(banco: Banco): number {
  return (banco.$client.prepare('select count(*) as n from trechos_vec').get() as { n: number }).n;
}

function idDoMovimento(banco: Banco, refId: string): number {
  return (banco.$client.prepare("select id from trechos where fonte = 'movimento' and ref_id = ?").get(refId) as { id: number }).id;
}

describe('IndiceDeTrechos', () => {
  let banco: Banco;
  let indice: IndiceDeTrechos;

  beforeEach(() => {
    banco = abrirBanco(':memory:');
    indice = new IndiceDeTrechos(banco);
  });

  afterEach(() => {
    banco.$client.close();
  });

  describe('movimentos', () => {
    it('insere, pula o que não mudou (hash), atualiza e remove', () => {
      expect(indice.sincronizarMovimentos([
        { refId: 'm1', texto: 'Uber viagem' },
        { refId: 'm2', texto: 'iFood pizza' },
        { refId: 'm3', texto: 'Conta de luz' },
      ])).toEqual({ inseridos: 3, atualizados: 0, removidos: 0 });

      expect(indice.sincronizarMovimentos([
        { refId: 'm1', texto: 'Uber viagem' },
        { refId: 'm2', texto: 'iFood pizza' },
        { refId: 'm3', texto: 'Conta de luz' },
      ])).toEqual({ inseridos: 0, atualizados: 0, removidos: 0 });

      expect(indice.sincronizarMovimentos([
        { refId: 'm1', texto: 'Uber viagem' },
        { refId: 'm2', texto: 'iFood pizza grande' },
        { refId: 'm4', texto: 'Farmácia' },
      ])).toEqual({ inseridos: 1, atualizados: 1, removidos: 1 });

      expect(indice.estatisticas()).toMatchObject({ movimentos: 3, trechosDeAnexos: 0 });
      expect(indice.buscar('luz', null, { escopos: ['movimentos'], limite: 5 })).toEqual([]);
      expect(indice.buscar('grande', null, { escopos: ['movimentos'], limite: 5 })[0]).toMatchObject({
        refId: 'm2', fonte: 'movimento', escopo: 'movimentos', texto: 'iFood pizza grande',
      });
    });

    it('movimento alterado perde o vetor e volta a ficar pendente', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([{ refId: 'm1', texto: 'Uber viagem' }]);
      const id = idDoMovimento(banco, 'm1');
      expect(indice.gravarVetores([{ id, escopo: 'movimentos', vetor: v(1, 0, 0) }])).toBe(1);
      expect(indice.estatisticas()).toMatchObject({ movimentosVetorizados: 1, pendentes: 0 });

      indice.sincronizarMovimentos([{ refId: 'm1', texto: 'Uber viagem noturna' }]);
      expect(contarVetores(banco)).toBe(0);
      expect(indice.pendentes(10)).toEqual([{ id, escopo: 'movimentos', texto: 'Uber viagem noturna' }]);
    });

    it('movimento removido leva o vetor junto (gatilho)', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([{ refId: 'm1', texto: 'Uber' }, { refId: 'm2', texto: 'Luz' }]);
      indice.gravarVetores(indice.pendentes(10).map((p) => ({ ...p, vetor: v(1, 0, 0) })));
      expect(contarVetores(banco)).toBe(2);
      indice.sincronizarMovimentos([{ refId: 'm2', texto: 'Luz' }]);
      expect(contarVetores(banco)).toBe(1);
    });
  });

  describe('anexos', () => {
    it('troca os trechos do anexo e remove por anexo e por conversa', () => {
      indice.definirTrechosDoAnexo('a1', 'c1', ['um', 'dois', 'tres']);
      indice.definirTrechosDoAnexo('a1', 'c1', ['quatro', 'cinco']);
      indice.definirTrechosDoAnexo('a2', 'c1', ['seis']);
      indice.definirTrechosDoAnexo('a3', 'c2', ['sete']);
      const linhas = banco.$client
        .prepare("select ref_id as refId, escopo, ordem, texto from trechos where fonte = 'anexo' order by id")
        .all();
      expect(linhas).toEqual([
        { refId: 'a1', escopo: 'conversa:c1', ordem: 0, texto: 'quatro' },
        { refId: 'a1', escopo: 'conversa:c1', ordem: 1, texto: 'cinco' },
        { refId: 'a2', escopo: 'conversa:c1', ordem: 0, texto: 'seis' },
        { refId: 'a3', escopo: 'conversa:c2', ordem: 0, texto: 'sete' },
      ]);
      indice.removerAnexo('a2');
      expect(indice.estatisticas().trechosDeAnexos).toBe(3);
      indice.removerConversa('c1');
      expect(indice.estatisticas().trechosDeAnexos).toBe(1);
    });

    it('remover anexo apaga os vetores dele', () => {
      indice.ativarVetores(3);
      indice.definirTrechosDoAnexo('a1', 'c1', ['um', 'dois']);
      indice.gravarVetores(indice.pendentes(10).map((p) => ({ ...p, vetor: v(0, 1, 0) })));
      expect(contarVetores(banco)).toBe(2);
      indice.removerAnexo('a1');
      expect(contarVetores(banco)).toBe(0);
    });
  });

  describe('busca por palavra', () => {
    beforeEach(() => {
      indice.sincronizarMovimentos([
        { refId: 'pizza-e-ifood', texto: 'iFood pizzaria Bella pizza' },
        { refId: 'so-ifood', texto: 'iFood mercado' },
        { refId: 'acai', texto: 'Açaí da Esquina' },
        { refId: 'super', texto: 'Supermercado Pão de Açúcar' },
      ]);
    });

    it('quem tem mais palavras da consulta vem primeiro', () => {
      const r = indice.buscar('ifood pizza', null, { escopos: ['movimentos'], limite: 10 });
      expect(r.map((x) => x.refId)).toEqual(['pizza-e-ifood', 'so-ifood']);
      expect(r[0]!.origem).toEqual(['palavra']);
      expect(r[0]!.pontuacao).toBeGreaterThan(r[1]!.pontuacao);
    });

    it('ignora acento e caixa: "acai" acha "Açaí"', () => {
      expect(indice.buscar('acai', null, { escopos: ['movimentos'], limite: 5 }).map((x) => x.refId)).toEqual(['acai']);
      expect(indice.buscar('AÇAÍ', null, { escopos: ['movimentos'], limite: 5 }).map((x) => x.refId)).toEqual(['acai']);
    });

    it('acha pelo começo da palavra', () => {
      expect(indice.buscar('supermerc', null, { escopos: ['movimentos'], limite: 5 }).map((x) => x.refId)).toEqual(['super']);
    });

    it('respeita o limite', () => {
      expect(indice.buscar('ifood', null, { escopos: ['movimentos'], limite: 1 })).toHaveLength(1);
    });

    it('filtra pelo escopo', () => {
      indice.definirTrechosDoAnexo('a1', 'c1', ['Contrato de aluguel']);
      expect(indice.buscar('aluguel', null, { escopos: ['movimentos'], limite: 5 })).toEqual([]);
      expect(indice.buscar('aluguel', null, { escopos: ['conversa:c2'], limite: 5 })).toEqual([]);
      expect(indice.buscar('aluguel', null, { escopos: ['conversa:c1', 'movimentos'], limite: 5 })[0]).toMatchObject({
        fonte: 'anexo', refId: 'a1', escopo: 'conversa:c1',
      });
      expect(indice.buscar('aluguel', null, { escopos: [], limite: 5 })).toEqual([]);
    });

    it.each([
      '"', '""', '"pizza', '*', 'pizza*', 'NEAR(', 'NEAR(pizza ifood)', 'OR', 'pizza OR', 'AND NOT', '-', '-pizza',
      ':', 'texto:pizza', '(', ')', '((pizza)', '^pizza', '{texto}: pizza', "'; drop table trechos; --", '\u0000', '   ',
    ])('consulta maliciosa não quebra: %j', (consulta) => {
      expect(() => indice.buscar(consulta, null, { escopos: ['movimentos'], limite: 5 })).not.toThrow();
    });

    it('consulta só com sintaxe ainda acha a palavra que houver', () => {
      expect(indice.buscar('NEAR("pizza"*)', null, { escopos: ['movimentos'], limite: 5 })[0]!.refId).toBe('pizza-e-ifood');
    });
  });

  describe('vetores', () => {
    it('busca pelo vizinho mais próximo, dentro do escopo', () => {
      expect(indice.ativarVetores(3)).toEqual({ ok: true, erro: null });
      expect(indice.vetoresAtivos).toBe(true);
      indice.sincronizarMovimentos([{ refId: 'x', texto: 'alfa' }, { refId: 'y', texto: 'beta' }]);
      indice.definirTrechosDoAnexo('a1', 'c1', ['gama']);
      const vetores: Record<string, Float32Array> = { alfa: v(1, 0, 0), beta: v(0, 1, 0), gama: v(0.9, 0.1, 0) };
      indice.gravarVetores(indice.pendentes(10).map((p) => ({ ...p, vetor: vetores[p.texto]! })));

      const movimentos = indice.buscar('', v(1, 0.05, 0), { escopos: ['movimentos'], limite: 5 });
      expect(movimentos.map((r) => r.refId)).toEqual(['x', 'y']);
      expect(movimentos[0]!.origem).toEqual(['vetor']);

      const tudo = indice.buscar('', v(0.9, 0.12, 0), { escopos: ['movimentos', 'conversa:c1'], limite: 5 });
      expect(tudo.map((r) => r.refId)).toEqual(['a1', 'x', 'y']);
      expect(indice.buscar('', v(1, 0, 0), { escopos: ['conversa:c9'], limite: 5 })).toEqual([]);
    });

    it('RRF: quem aparece nas duas buscas fica acima de quem aparece numa só', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([
        { refId: 'so-palavra', texto: 'pizza pizza pizza' },
        { refId: 'as-duas', texto: 'pizza margherita com borda recheada de catupiry' },
        { refId: 'so-vetor', texto: 'lasanha' },
      ]);
      const ids = Object.fromEntries(['so-palavra', 'as-duas', 'so-vetor'].map((r) => [r, idDoMovimento(banco, r)]));
      indice.gravarVetores([
        { id: ids['as-duas']!, escopo: 'movimentos', vetor: v(0.8, 0.2, 0) },
        { id: ids['so-vetor']!, escopo: 'movimentos', vetor: v(1, 0, 0) },
      ]);
      const r = indice.buscar('pizza', v(1, 0, 0), { escopos: ['movimentos'], limite: 5 });
      expect(r.map((x) => x.refId)).toEqual(['as-duas', 'so-palavra', 'so-vetor']);
      expect(r[0]!.origem).toEqual(['palavra', 'vetor']);
    });

    it('sem vetores ativos, a busca com vetor cai só nas palavras', () => {
      indice.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      const r = indice.buscar('pizza', v(1, 0, 0), { escopos: ['movimentos'], limite: 5 });
      expect(r.map((x) => x.origem)).toEqual([['palavra']]);
      expect(indice.pendentes(10)).toEqual([]);
      expect(() => indice.gravarVetores([{ id: 1, escopo: 'movimentos', vetor: v(1, 0, 0) }])).toThrow(/não estão ativos/);
    });

    it('ativar de novo com a mesma dimensão não perde nada', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      indice.gravarVetores(indice.pendentes(10).map((p) => ({ ...p, vetor: v(1, 0, 0) })));
      expect(indice.ativarVetores(3)).toEqual({ ok: true, erro: null });
      expect(indice.estatisticas()).toMatchObject({ movimentosVetorizados: 1, pendentes: 0 });
      expect(contarVetores(banco)).toBe(1);
    });

    it('mudou a dimensão: recria a tabela e marca tudo como não vetorizado', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      indice.gravarVetores(indice.pendentes(10).map((p) => ({ ...p, vetor: v(1, 0, 0) })));
      expect(indice.ativarVetores(4)).toEqual({ ok: true, erro: null });
      expect(contarVetores(banco)).toBe(0);
      expect(indice.estatisticas()).toMatchObject({ movimentosVetorizados: 0, pendentes: 1 });
      expect(() => indice.gravarVetores([{ id: 1, escopo: 'movimentos', vetor: v(1, 0, 0) }])).toThrow(/dimensão/);
      expect(indice.gravarVetores([{ id: 1, escopo: 'movimentos', vetor: v(1, 0, 0, 0) }])).toBe(1);
    });

    it('reiniciarVetores apaga todos os vetores e deixa tudo pendente', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      indice.gravarVetores(indice.pendentes(10).map((p) => ({ ...p, vetor: v(1, 0, 0) })));
      indice.reiniciarVetores();
      expect(contarVetores(banco)).toBe(0);
      expect(indice.pendentes(10)).toHaveLength(1);
    });

    it('não grava vetor de trecho que sumiu, mudou de escopo ou de texto', () => {
      indice.ativarVetores(3);
      indice.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      const [p] = indice.pendentes(10);
      expect(indice.gravarVetores([
        { id: 999, escopo: 'movimentos', vetor: v(1, 0, 0) },
        { id: p!.id, escopo: 'conversa:c1', vetor: v(1, 0, 0) },
        { id: p!.id, escopo: 'movimentos', vetor: v(1, 0, 0), texto: 'texto antigo' },
      ])).toBe(0);
      expect(contarVetores(banco)).toBe(0);
      expect(indice.gravarVetores([{ ...p!, vetor: v(1, 0, 0) }])).toBe(1);
    });

    it('a extensão não carrega: devolve o erro, não lança, e a busca por palavra segue', () => {
      const semExtensao = new IndiceDeTrechos(banco, () => {
        throw new Error('vec0.so: cannot open shared object file');
      });
      expect(semExtensao.ativarVetores(3)).toEqual({ ok: false, erro: expect.stringContaining('cannot open shared object') });
      expect(semExtensao.vetoresAtivos).toBe(false);
      semExtensao.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      expect(semExtensao.buscar('pizza', v(1, 0, 0), { escopos: ['movimentos'], limite: 5 })).toHaveLength(1);
    });

    it('dimensão inválida é recusada sem lançar', () => {
      expect(indice.ativarVetores(0)).toMatchObject({ ok: false });
      expect(indice.ativarVetores(1.5)).toMatchObject({ ok: false });
      expect(indice.vetoresAtivos).toBe(false);
    });
  });

  describe('banco em arquivo, entre uma subida e outra', () => {
    let pasta: string;

    beforeEach(() => {
      pasta = mkdtempSync(join(tmpdir(), 'fluxo-indice-'));
    });

    afterEach(() => {
      rmSync(pasta, { recursive: true, force: true });
    });

    it('sem a extensão na próxima subida, apagar trecho continua funcionando e os vetores são refeitos depois', () => {
      const caminho = join(pasta, 'fluxo.db');
      const b1 = abrirBanco(caminho);
      const i1 = new IndiceDeTrechos(b1);
      i1.ativarVetores(3);
      i1.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }, { refId: 'y', texto: 'luz' }]);
      i1.gravarVetores(i1.pendentes(10).map((p) => ({ ...p, vetor: v(1, 0, 0) })));
      b1.$client.close();

      const b2 = abrirBanco(caminho);
      const i2 = new IndiceDeTrechos(b2, () => {
        throw new Error('sem extensão');
      });
      expect(() => i2.sincronizarMovimentos([{ refId: 'y', texto: 'luz' }])).not.toThrow();
      b2.$client.close();

      const b3 = abrirBanco(caminho);
      const i3 = new IndiceDeTrechos(b3);
      expect(i3.ativarVetores(3).ok).toBe(true);
      expect(i3.estatisticas()).toMatchObject({ movimentos: 1, movimentosVetorizados: 0, pendentes: 1 });
      expect(contarVetores(b3)).toBe(0);
      b3.$client.close();
    });

    it('com a extensão, os vetores sobrevivem a uma nova subida', () => {
      const caminho = join(pasta, 'fluxo.db');
      const b1 = abrirBanco(caminho);
      const i1 = new IndiceDeTrechos(b1);
      i1.ativarVetores(3);
      i1.sincronizarMovimentos([{ refId: 'x', texto: 'pizza' }]);
      i1.gravarVetores(i1.pendentes(10).map((p) => ({ ...p, vetor: v(1, 0, 0) })));
      b1.$client.close();

      const b2 = abrirBanco(caminho);
      const i2 = new IndiceDeTrechos(b2);
      expect(i2.ativarVetores(3).ok).toBe(true);
      expect(i2.estatisticas()).toMatchObject({ movimentosVetorizados: 1, pendentes: 0 });
      expect(i2.buscar('', v(1, 0, 0), { escopos: ['movimentos'], limite: 5 })[0]!.refId).toBe('x');
      b2.$client.close();
    });
  });
});
