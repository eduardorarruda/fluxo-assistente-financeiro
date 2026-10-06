import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type AcaoAssistente, useAcoesDaConversa } from '../../../api/acoes-assistente';
import { montarComProvedores } from '../../../testes/ambiente';
import { passo, servidorFalso } from '../../../testes/fixtures/assistente';
import { Passos } from '../Passos';
import { CartoesAcao } from './CartaoAcao';

configure({ asyncUtilTimeout: 5000 });

const LISTA = '/api/assistente/conversas/c1/acoes';

function acao(p: Partial<AcaoAssistente> = {}): AcaoAssistente {
  return {
    id: 'a1', conversaId: 'c1', mensagemId: 'm1', tipo: 'criar_regra', modo: 'proposta', titulo: 'Criar regra de categoria',
    descricao: 'Tudo que tiver “baratao” na descrição vai para Carro e combustível — nos movimentos de antes e nos próximos.',
    efeito: 'Muda 14 movimentos (R$ 2.310,00), de 03/02/2026 a 22/09/2026. Vale também para os próximos.',
    exemplos: [
      { data: '2026-09-22', descricao: 'Baratão Combustíveis', valor: 21000, de: 'Mercado', para: 'Carro e combustível' },
      { data: '2026-09-08', descricao: 'Baratão Combustíveis', valor: 18050, de: 'Mercado', para: 'Carro e combustível' },
    ],
    situacao: 'pendente', erro: null, aviso: null, criadaEm: '2026-09-24T18:00:00Z', decididaEm: null, desfeitaEm: null, podeDesfazer: false,
    ...p,
  };
}

/** Como a tela usa: a lista vem da consulta e os cartões leem dela (a decisão atualiza o cache). */
function Cartoes() {
  const { data } = useAcoesDaConversa('c1');
  return <CartoesAcao acoes={data} />;
}

describe('cartões de ação do assistente', () => {
  it('proposta: mostra o efeito e os exemplos; Aprovar → feito com Desfazer → desfeito', async () => {
    const usuario = userEvent.setup();
    const aprovada = acao({ situacao: 'aprovada', decididaEm: '2026-09-24T18:01:00Z', podeDesfazer: true });
    const { chamadas } = servidorFalso({
      [`GET ${LISTA}`]: [acao()],
      'POST /api/assistente/propostas/a1/aprovar': aprovada,
      'POST /api/assistente/acoes/a1/desfazer': { ...aprovada, desfeitaEm: '2026-09-24T18:02:00Z', podeDesfazer: false },
    });
    montarComProvedores(<Cartoes />);
    const cartao = await screen.findByRole('group', { name: 'Criar regra de categoria: Precisa da sua aprovação' });
    expect(within(cartao).getByText(/Muda 14 movimentos/)).toBeInTheDocument();
    expect(within(cartao).getByText('ou responda “sim”')).toBeInTheDocument();

    await usuario.click(within(cartao).getByRole('button', { name: /Ver 2 exemplos/ }));
    expect(within(cartao).getAllByText('Baratão Combustíveis')).toHaveLength(2);
    expect(within(cartao).getByText('R$ 210,00')).toBeInTheDocument();

    await usuario.click(within(cartao).getByRole('button', { name: 'Aprovar' }));
    const feita = await screen.findByRole('group', { name: 'Criar regra de categoria: Aprovado e feito' });
    expect(within(feita).queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();

    await usuario.click(within(feita).getByRole('button', { name: 'Desfazer' }));
    const desfeita = await screen.findByRole('group', { name: 'Criar regra de categoria: Desfeito' });
    expect(within(desfeita).queryByRole('button', { name: /Aprovar|Recusar|Desfazer/ })).toBeNull();
    expect(chamadas.filter((c) => c.metodo === 'POST').map((c) => c.url)).toEqual([
      '/api/assistente/propostas/a1/aprovar', '/api/assistente/acoes/a1/desfazer',
    ]);
  });

  it('Recusar fecha a proposta', async () => {
    const usuario = userEvent.setup();
    servidorFalso({
      [`GET ${LISTA}`]: [acao()],
      'POST /api/assistente/propostas/a1/recusar': acao({ situacao: 'recusada', decididaEm: '2026-09-24T18:01:00Z' }),
    });
    montarComProvedores(<Cartoes />);
    await usuario.click(await screen.findByRole('button', { name: 'Recusar' }));
    const recusada = await screen.findByRole('group', { name: 'Criar regra de categoria: Recusada' });
    expect(within(recusada).queryByRole('button', { name: /Aprovar|Recusar|Desfazer/ })).toBeNull();
  });

  it('ação direta é uma linha com Desfazer; recusa do servidor aparece no cartão', async () => {
    const usuario = userEvent.setup();
    const direta = acao({
      tipo: 'ajustar_movimento', modo: 'direta', titulo: 'Movimento ajustado', situacao: 'aprovada', podeDesfazer: true, exemplos: [], efeito: null,
      descricao: '“Baratão” (22/09/2026, R$ 210,00): Mercado → Carro e combustível.',
    });
    servidorFalso({
      [`GET ${LISTA}`]: [direta],
      'POST /api/assistente/acoes/a1/desfazer': new Response(JSON.stringify({ erro: 'Esse movimento foi mudado depois; ajuste pelo Extrato.' }), { status: 409 }),
    });
    montarComProvedores(<Cartoes />);
    const linha = await screen.findByRole('group', { name: 'Movimento ajustado: Feito' });
    expect(linha).toHaveTextContent('Movimento ajustado: “Baratão” (22/09/2026, R$ 210,00): Mercado → Carro e combustível.');
    await usuario.click(within(linha).getByRole('button', { name: 'Desfazer' }));
    expect(await within(linha).findByRole('alert')).toHaveTextContent('Esse movimento foi mudado depois');
  });

  it('falhou e expirou: sem botões, com o motivo', async () => {
    servidorFalso({
      [`GET ${LISTA}`]: [acao({ situacao: 'falhou', erro: 'Regra não encontrada.' }), acao({ id: 'a2', situacao: 'expirada' })],
    });
    montarComProvedores(<Cartoes />);
    const falhou = await screen.findByRole('group', { name: 'Criar regra de categoria: Não deu certo' });
    expect(within(falhou).getByRole('alert')).toHaveTextContent('Regra não encontrada.');
    expect(screen.getByRole('group', { name: 'Criar regra de categoria: Expirou sem resposta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
  });
});

describe('Passos com ações', () => {
  it('o resumo separa consultas de ações', () => {
    render(<Passos passos={[passo(), passo({ id: 'p2', nome: 'criar_regra_de_categoria', rotulo: 'Propôs a regra' })]} />);
    expect(screen.getByRole('button', { name: /Consultou 1 fonte · 1 ação/ })).toBeInTheDocument();
  });
});
