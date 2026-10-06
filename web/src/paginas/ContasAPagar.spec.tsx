import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import type { CandidatoAPagamento, ContaAPagar, VencimentoDeCartao } from '../api/tipos';
import { renderizar } from '../testes/ambiente';
import estado from '../testes/fixtures/estado.json';
import recorrencias from '../testes/fixtures/recorrencias.json';
import { ContasAPagar } from './ContasAPagar';
import { Recorrencias } from './Recorrencias';

// O estado da demonstração tem hoje = 2026-09-24.
const conta = (p: Partial<ContaAPagar>): ContaAPagar => ({
  id: 'luz', descricao: 'Conta de luz', valor: 15000, vencimento: '2026-09-26', repete: 'mensal', categoriaId: null,
  textoNoExtrato: 'ENEL', situacao: 'aberta', pagaEm: null, movimentoId: null, origem: 'assistente', nota: null,
  criadaEm: '', atualizadaEm: '', movimento: null, ...p,
});

const CONTAS: ContaAPagar[] = [
  conta({}),
  conta({ id: 'ipva', descricao: 'IPVA', valor: 98000, vencimento: '2026-09-20', repete: 'anual', situacao: 'atrasada', origem: 'pessoa' }),
  conta({
    id: 'agua', descricao: 'Água', valor: 9000, vencimento: '2026-09-20', repete: 'nao', situacao: 'paga', pagaEm: '2026-09-19', movimentoId: 'm1',
    movimento: { id: 'm1', data: '2026-09-19', descricao: 'Sabesp', valor: 9120, conta: 'Nubank' },
  }),
];

const FATURAS: VencimentoDeCartao[] = [
  { contaId: 'nu', cartao: 'Nubank Ultravioleta', mes: '2026-10', fechamento: '2026-10-03', vencimento: '2026-10-10', valor: 123456, situacao: 'ABERTA' },
];

const CANDIDATOS: CandidatoAPagamento[] = [
  { id: 'enel-1', data: '2026-09-25', descricao: 'ENEL DISTRIBUICAO SP', estabelecimento: null, valor: 15230, conta: 'Nubank', tipoConta: 'CONTA', forte: true },
];

const api = (contas: ContaAPagar[] = CONTAS) => ({
  '/api/estado': estado,
  '/api/contas-a-pagar/faturas': FATURAS,
  '/api/contas-a-pagar/luz/candidatos': CANDIDATOS,
  '/api/contas-a-pagar': contas,
});

describe('Contas a pagar', () => {
  it('agrupa por situação e mostra o que pagou, a repetição e as faturas do cartão', async () => {
    renderizar(<ContasAPagar />, api());
    const atrasadas = await screen.findByRole('region', { name: 'Atrasadas' });
    expect(within(atrasadas).getByText('IPVA')).toBeInTheDocument();
    expect(within(atrasadas).getByText('Todo ano')).toBeInTheDocument();
    expect(within(atrasadas).getByText(/Venceu há 4 dias/)).toBeInTheDocument();
    const semana = screen.getByRole('region', { name: 'Esta semana' });
    expect(within(semana).getByText('Conta de luz')).toBeInTheDocument();
    expect(within(semana).getByText('Em 2 dias')).toBeInTheDocument();
    expect(within(semana).getByTitle('Criada pelo Assistente')).toBeInTheDocument();
    const pagas = screen.getByRole('region', { name: 'Pagas recentemente' });
    expect(within(pagas).getByText(/Paga em 19\/09\/26/)).toBeInTheDocument();
    expect(within(pagas).getByText(/Sabesp/)).toBeInTheDocument();
    expect(screen.getByText('Nubank Ultravioleta · fatura de outubro')).toBeInTheDocument();
    expect(screen.getByText(/Fecha 3 out · vence 10 out/)).toBeInTheDocument();
  });

  it('sem contas, explica que o Assistente também cria', async () => {
    renderizar(<ContasAPagar />, api([]));
    expect(await screen.findByText('Nenhuma conta a pagar')).toBeInTheDocument();
    expect(screen.getByText(/a conta de luz de R\$ 150 vence dia 10/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pedir ao Assistente/ })).toHaveAttribute('href', '/assistente');
  });

  it('nova conta: valor com máscara, vencimento no calendário, repete no seletor', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = renderizar(<ContasAPagar />, api([]));
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar conta' }));
    const dialogo = (await screen.findByText('Nova conta a pagar')).closest<HTMLElement>('[role="dialog"]')!;
    await usuario.type(within(dialogo).getByPlaceholderText('Ex.: Conta de luz'), 'Internet');
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Valor' }), '11990');
    await usuario.click(within(dialogo).getByRole('button', { name: /Vencimento:/ }));
    await usuario.click(await screen.findByRole('button', { name: 'Próximo mês' }));
    await usuario.click(await screen.findByRole('button', { name: 'Quinta, 1 de outubro de 2026' }));
    await usuario.click(within(dialogo).getByRole('combobox', { name: 'Repete' }));
    await usuario.click(await screen.findByRole('option', { name: /Todo mês/ }));
    await usuario.type(within(dialogo).getByPlaceholderText('Ex.: ENEL'), 'vivo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Criar conta' }));
    const envio = chamadas.find((c) => c.metodo === 'POST');
    expect(envio).toMatchObject({
      url: '/api/contas-a-pagar',
      corpo: { descricao: 'Internet', valor: 11990, vencimento: '2026-10-01', repete: 'mensal', categoriaId: null, textoNoExtrato: 'vivo', nota: null },
    });
  });

  it('paguei: sugere o débito provável e liga a conta a ele', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = renderizar(<ContasAPagar />, api());
    const semana = await screen.findByRole('region', { name: 'Esta semana' });
    await usuario.click(within(semana).getByRole('button', { name: 'Paguei' }));
    const opcao = await screen.findByRole('radio', { name: /ENEL DISTRIBUICAO SP/ });
    expect(opcao).toHaveAttribute('aria-checked', 'true');
    expect(within(opcao).getByText('Provável')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Marcar paga' }));
    expect(chamadas.find((c) => c.metodo === 'POST')).toMatchObject({ url: '/api/contas-a-pagar/luz/paga', corpo: { movimentoId: 'enel-1' } });
  });

  it('reabrir uma paga e apagar com confirmação', async () => {
    const usuario = userEvent.setup();
    const { chamadas } = renderizar(<ContasAPagar />, api());
    const pagas = await screen.findByRole('region', { name: 'Pagas recentemente' });
    await usuario.click(within(pagas).getByRole('button', { name: 'Reabrir (não foi paga)' }));
    expect(chamadas.some((c) => c.metodo === 'POST' && c.url === '/api/contas-a-pagar/agua/reabrir')).toBe(true);
    const atrasadas = screen.getByRole('region', { name: 'Atrasadas' });
    await usuario.click(within(atrasadas).getByRole('button', { name: 'Apagar' }));
    const confirmacao = (await screen.findByText('Apagar conta?')).closest<HTMLElement>('[role="dialog"]')!;
    await usuario.click(within(confirmacao).getByRole('button', { name: /^Apagar$/ }));
    expect(chamadas.some((c) => c.metodo === 'DELETE' && c.url === '/api/contas-a-pagar/ipva')).toBe(true);
  });

  it('das Recorrências: "Transformar em conta a pagar" abre o cadastro já preenchido', async () => {
    const usuario = userEvent.setup();
    renderizar(
      <Routes>
        <Route path="/" element={<Recorrencias />} />
        <Route path="/contas-a-pagar" element={<ContasAPagar />} />
      </Routes>,
      { ...api([]), '/api/recorrencias': recorrencias },
    );
    const [primeiro] = await screen.findAllByRole('button', { name: 'Transformar em conta a pagar' });
    const ativa = recorrencias.itens.find((r) => r.ativa)!;
    await usuario.click(primeiro!);
    const dialogo = (await screen.findByText('Nova conta a pagar')).closest<HTMLElement>('[role="dialog"]')!;
    expect(within(dialogo).getByPlaceholderText('Ex.: Conta de luz')).toHaveValue(ativa.nome);
    expect(within(dialogo).getByRole('combobox', { name: 'Repete' })).toHaveTextContent('Todo mês');
  });
});
