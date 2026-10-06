import { screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { Ajustes } from '../paginas/Ajustes';
import { Assistente } from '../paginas/assistente/Assistente';
import { Caixinhas } from '../paginas/Caixinhas';
import { Cartao } from '../paginas/Cartao';
import { Conexoes } from '../paginas/Conexoes';
import { Extrato } from '../paginas/Extrato';
import { Fluxo } from '../paginas/Fluxo';
import { Insights } from '../paginas/Insights';
import { Metas } from '../paginas/Metas';
import { Orcamento } from '../paginas/Orcamento';
import { Recorrencias } from '../paginas/Recorrencias';
import { VisaoGeral } from '../paginas/VisaoGeral';
import { renderizar } from './ambiente';
import caixinhas from './fixtures/caixinhas.json';
import cartoes from './fixtures/cartoes.json';
import categorias from './fixtures/categorias.json';
import estado from './fixtures/estado.json';
import fatura from './fixtures/fatura.json';
import fluxo from './fixtures/fluxo.json';
import insights from './fixtures/insights.json';
import metas from './fixtures/metas.json';
import movimentos from './fixtures/movimentos.json';
import orcamento from './fixtures/orcamento.json';
import recorrencias from './fixtures/recorrencias.json';
import regras from './fixtures/regras.json';
import sincronizacoes from './fixtures/sincronizacoes.json';
import visaoGeral from './fixtures/visao-geral.json';
import { config as configAssistente } from './fixtures/assistente';

// Respostas reais da API no modo demonstração (capturadas do servidor).
const API = {
  '/api/estado': estado,
  '/api/categorias': categorias,
  '/api/visao-geral': visaoGeral,
  '/api/fluxo': fluxo,
  '/api/movimentos': movimentos,
  '/api/cartoes/': fatura,
  '/api/cartoes': cartoes,
  '/api/caixinhas': caixinhas,
  '/api/orcamento': orcamento,
  '/api/metas': metas,
  '/api/recorrencias': recorrencias,
  '/api/insights': insights,
  '/api/regras': regras,
  '/api/sincronizacoes': sincronizacoes,
  '/api/assistente/config': configAssistente(),
  '/api/assistente/conversas': [],
};

const TELAS: [string, ComponentType, RegExp][] = [
  ['Visão geral', VisaoGeral, /Patrimônio líquido/],
  ['Fluxo', Fluxo, /De onde veio e para onde foi/],
  ['Extrato', Extrato, /movimentos?/],
  ['Cartão', Cartao, /Compras parceladas/],
  ['Caixinhas', Caixinhas, /Guardado nas caixinhas/],
  ['Orçamento', Orcamento, /Limites por categoria/],
  ['Metas', Metas, /Nova meta/],
  ['Recorrências', Recorrencias, /Custo fixo por mês/],
  ['Insights', Insights, /O que chama atenção/],
  ['Conexões', Conexoes, /Conecte seu Nubank/],
  ['Ajustes', Ajustes, /Regras de categoria/],
  ['Assistente', Assistente, /O que você quer entender/],
];

describe('todas as telas renderizam com dados reais da API', () => {
  it.each(TELAS)('%s', async (_nome, Tela, marca) => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderizar(<Tela />, API);
    await waitFor(() => expect(screen.getAllByText(marca).length).toBeGreaterThan(0), { timeout: 3000 });
    const reais = erro.mock.calls.filter((c) => !String(c[0]).includes('not wrapped in act'));
    expect(reais).toEqual([]);
    erro.mockRestore();
  });
});
