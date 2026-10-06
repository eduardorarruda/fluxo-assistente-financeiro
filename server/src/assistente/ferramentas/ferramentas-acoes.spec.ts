import { randomUUID } from 'node:crypto';
import { abrirBanco } from '../../db/conexao';
import { Repositorio } from '../../dados/repositorio';
import { gerarDadosDemo, ID_CONEXAO_DEMO } from '../../provedores/provedor-demo';
import { relogioFixo } from '../../relogio';
import { ContasAPagar } from '../../servicos/contas-a-pagar';
import { Financas } from '../../servicos/financas';
import type { Sincronizador } from '../../servicos/sincronizador';
import { RepositorioDeAcoes } from '../acoes/repositorio-acoes';
import { ServicoDeAcoes } from '../acoes/servico-acoes';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { Ferramentas } from './ferramentas';
import { categoriaPorTexto } from './formato';

const HOJE = '2026-09-24';

// Cada mudança refaz o cálculo dos movimentos da demonstração: em máquina ocupada passa dos 5 s padrão.
vi.setConfig({ testTimeout: 30_000 });

function montar(comAcoes = true) {
  const relogio = relogioFixo(HOJE);
  const banco = abrirBanco(':memory:');
  const repositorio = new Repositorio(banco, relogio);
  repositorio.criarConexao(ID_CONEXAO_DEMO, 'demo', 'Nubank');
  repositorio.aplicarSincronizacao(gerarDadosDemo(HOJE));
  const financas = new Financas(repositorio, relogio);
  const assistente = new RepositorioAssistente(banco, relogio);
  const contas = new ContasAPagar(repositorio, financas, { aoTerminar: () => () => undefined } as unknown as Sincronizador, relogio);
  const acoes = new ServicoDeAcoes(new RepositorioDeAcoes(banco), assistente, repositorio, financas, relogio, contas);
  const ferramentas = new Ferramentas(financas, assistente, { buscar: async () => [], modo: () => 'palavras' }, { texto: () => null }, undefined, comAcoes ? acoes : undefined);
  assistente.criarConversa({ id: 'c1', titulo: 't', provedor: 'claude', modelo: null });
  const turno = (texto: string) => {
    const gerando = assistente.respostaGerando('c1');
    if (gerando) assistente.atualizarMensagem(gerando, { situacao: 'ok', texto: 'ok' });
    assistente.adicionarMensagem({ id: randomUUID(), conversaId: 'c1', papel: 'usuario', texto, situacao: 'ok', provedor: null, modelo: null });
    assistente.adicionarMensagem({ id: randomUUID(), conversaId: 'c1', papel: 'assistente', texto: '', situacao: 'gerando', provedor: 'claude', modelo: null });
  };
  const chamar = async (nome: string, entrada: unknown = {}) => {
    const r = await ferramentas.executar(nome, entrada, { conversaId: 'c1' });
    return { ...r, dados: r.ok ? (JSON.parse(r.texto) as Record<string, any>) : null };
  };
  return { ferramentas, financas, repositorio, contas, turno, chamar };
}

describe('categoriaPorTexto', () => {
  it('aceita id, nome, apelido e a palavra que só um nome tem', () => {
    expect(categoriaPorTexto('mercado')).toBe('mercado');
    expect(categoriaPorTexto('Contas da casa')).toBe('contas');
    expect(categoriaPorTexto('Combustível')).toBe('carro');
    expect(categoriaPorTexto('gasolina')).toBe('carro');
    expect(categoriaPorTexto('luz')).toBe('contas');
    expect(categoriaPorTexto('pix')).toBeNull();
    expect(categoriaPorTexto('xyz')).toBeNull();
  });
});

describe('ferramentas de ação', () => {
  it('estão no catálogo com o efeito certo (vira readOnlyHint/destructiveHint na ponte)', () => {
    const { ferramentas } = montar();
    const efeito = Object.fromEntries(ferramentas.lista().map((f) => [f.nome, f.efeito]));
    expect(efeito).toMatchObject({
      panorama: 'leitura', regras_de_categoria: 'leitura', contas_a_pagar: 'leitura', acoes_da_conversa: 'leitura',
      gerar_imagem: 'escrita', criar_regra_de_categoria: 'escrita', recategorizar_movimentos: 'escrita', definir_orcamento: 'escrita',
      criar_conta_a_pagar: 'escrita', remover_conta_a_pagar: 'escrita', recusar_proposta: 'escrita',
      ajustar_movimento: 'destrutiva', confirmar_proposta: 'destrutiva', desfazer_acao: 'destrutiva', editar_conta_a_pagar: 'destrutiva',
      marcar_conta_paga: 'destrutiva',
    });
    for (const f of ferramentas.lista()) expect(f.inputSchema.type).toBe('object');
  });

  it('criar_regra_de_categoria só propõe; "sim" da pessoa confirma; "desfaz" desfaz', async () => {
    const { chamar, turno, repositorio } = montar();
    turno('Baratão é posto, coloca todos os Posto Shell em Combustível');
    const r = await chamar('criar_regra_de_categoria', { texto: 'posto shell', categoria: 'Combustível' });
    expect(r.ok).toBe(true);
    expect(r.dados!.proposta).toMatchObject({ titulo: 'Criar regra de categoria', descricao: expect.stringContaining('Carro e combustível') });
    expect(r.dados!.proximoPasso).toContain('NADA mudou ainda');
    expect(repositorio.instantaneo().regras).toHaveLength(0);

    // Na mesma resposta, nem com a mensagem certa: a pessoa ainda não viu.
    const cedo = await chamar('confirmar_proposta', {});
    expect(cedo).toMatchObject({ ok: false, texto: expect.stringContaining('resposta que a pessoa viu') });

    turno('pode fazer');
    const ok = await chamar('confirmar_proposta', {});
    expect(ok.dados).toMatchObject({ feito: true, situacao: 'aprovada', acaoId: r.dados!.proposta.id });
    expect(repositorio.instantaneo().regras).toHaveLength(1);

    turno('desfaz, por favor');
    expect((await chamar('desfazer_acao', {})).dados).toMatchObject({ desfeito: true });
    expect(repositorio.instantaneo().regras).toHaveLength(0);
  });

  it('ajustar_movimento age na hora e fala em reais/categoria por nome', async () => {
    const { chamar, turno, financas } = montar();
    const m = financas.todosOsMovimentos().find((x) => x.descricao === 'Starbucks')!;
    turno('esse Starbucks foi presente para a minha mãe');
    const r = await chamar('ajustar_movimento', { movimentoId: m.id, categoria: 'Presentes e doações', nota: 'presente da mãe' });
    expect(r.dados).toMatchObject({ feito: true, oQueMudou: expect.stringContaining('Restaurantes → Presentes e doações'), comoDesfazer: expect.any(String) });
    expect(financas.movimento(m.id)).toMatchObject({ categoriaId: 'presentes', nota: 'presente da mãe' });
    expect((await chamar('ajustar_movimento', { movimentoId: m.id, categoria: 'inexistente' })).texto).toContain('Categoria desconhecida');
  });

  it('recategorizar por filtro resolve os ids e propõe', async () => {
    const { chamar, turno } = montar();
    turno('os ifood de agosto eram restaurante');
    const r = await chamar('recategorizar_movimentos', { categoria: 'restaurantes', filtro: { texto: 'ifood', mes: '2026-08' } });
    expect(r.dados!.proposta.efeito).toMatch(/^Muda \d+ movimentos/);
    expect((await chamar('recategorizar_movimentos', { categoria: 'restaurantes' })).texto).toContain('`movimentoIds` OU `filtro`');
  });

  it('contas a pagar: criar em reais, listar, marcar como paga', async () => {
    const { chamar, turno } = montar();
    turno('a conta de luz de R$ 150 vence dia 15');
    const criada = await chamar('criar_conta_a_pagar', { descricao: 'Conta de luz', valor: 150, vencimento: '2026-10-15', repete: 'mensal', categoria: 'luz' });
    expect(criada.dados).toMatchObject({ feito: true, oQueMudou: '“Conta de luz” (R$ 150,00, vence em 15/10/2026, todo mês) · Contas da casa.' });
    const lista = await chamar('contas_a_pagar', { situacao: 'aberta' });
    expect(lista.dados).toMatchObject({ total: 1, somaEmAberto: 150, contas: [{ descricao: 'Conta de luz', valor: 150, criadaPor: 'assistente' }] });
    turno('já paguei a luz');
    const paga = await chamar('marcar_conta_paga', { contaId: lista.dados!.contas[0].id });
    expect(paga.dados).toMatchObject({ feito: true, aviso: 'A próxima (15/11/2026) já está na lista.' });
  });

  it('sem o serviço de ações, as ferramentas de ação dizem que só dá para ler', async () => {
    const { chamar, turno } = montar(false);
    turno('cria a regra');
    expect(await chamar('criar_regra_de_categoria', { texto: 'posto', categoria: 'carro' })).toMatchObject({ ok: false, texto: expect.stringContaining('só consigo ler') });
  });
});
