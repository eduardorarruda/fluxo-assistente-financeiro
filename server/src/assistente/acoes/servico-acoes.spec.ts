import { randomUUID } from 'node:crypto';
import { abrirBanco } from '../../db/conexao';
import { Repositorio } from '../../dados/repositorio';
import { gerarDadosDemo, ID_CONEXAO_DEMO } from '../../provedores/provedor-demo';
import type { Relogio } from '../../relogio';
import { ContasAPagar } from '../../servicos/contas-a-pagar';
import { Financas } from '../../servicos/financas';
import type { Sincronizador } from '../../servicos/sincronizador';
import { RepositorioAssistente } from '../dados/repositorio-assistente';
import { RepositorioDeAcoes } from './repositorio-acoes';
import { MAXIMO_DIRETAS_POR_RESPOSTA, ServicoDeAcoes, VALIDADE_PROPOSTA_MS } from './servico-acoes';
import { AcaoJaDecidida, ErroDeAcao } from './tipos-acoes';

const HOJE = '2026-09-24';

// Cada mudança refaz o cálculo dos movimentos da demonstração: em máquina ocupada passa dos 5 s padrão.
vi.setConfig({ testTimeout: 30_000 });

function montar() {
  let agora = new Date(`${HOJE}T15:00:00`).getTime();
  const relogio: Relogio = { agora: () => new Date(agora), hoje: () => HOJE };
  const banco = abrirBanco(':memory:');
  const repositorio = new Repositorio(banco, relogio);
  repositorio.criarConexao(ID_CONEXAO_DEMO, 'demo', 'Nubank');
  repositorio.aplicarSincronizacao(gerarDadosDemo(HOJE));
  const financas = new Financas(repositorio, relogio);
  const assistente = new RepositorioAssistente(banco, relogio);
  const sincronizador = { aoTerminar: () => () => undefined } as unknown as Sincronizador;
  const contas = new ContasAPagar(repositorio, financas, sincronizador, relogio);
  const repoAcoes = new RepositorioDeAcoes(banco);
  const acoes = new ServicoDeAcoes(repoAcoes, assistente, repositorio, financas, relogio, contas);

  /** Uma rodada da conversa: fecha a resposta anterior, a pessoa fala, o assistente começa a responder. */
  const turno = (conversaId: string, texto: string) => {
    const gerando = assistente.respostaGerando(conversaId);
    if (gerando) assistente.atualizarMensagem(gerando, { situacao: 'ok', texto: 'ok' });
    assistente.adicionarMensagem({ id: randomUUID(), conversaId, papel: 'usuario', texto, situacao: 'ok', provedor: null, modelo: null });
    return assistente.adicionarMensagem({ id: randomUUID(), conversaId, papel: 'assistente', texto: '', situacao: 'gerando', provedor: 'claude', modelo: null }).id;
  };
  for (const id of ['c1', 'c2']) assistente.criarConversa({ id, titulo: 't', provedor: 'claude', modelo: null });
  const categoriaDe = (texto: string) => financas.todosOsMovimentos().filter((m) => m.descricao.includes(texto)).map((m) => [m.id, m.categoriaId] as const);
  return { acoes, financas, repositorio, assistente, contas, turno, categoriaDe, avancar: (ms: number) => (agora += ms) };
}

describe('ServicoDeAcoes — proposta de regra', () => {
  it('propor não muda nada e mostra quantos movimentos mudam, com exemplos', () => {
    const { acoes, financas, turno, categoriaDe } = montar();
    turno('c1', 'Padaria Real é mercado, coloca tudo lá');
    const antes = categoriaDe('Padaria Real');
    const padarias = antes.filter(([, c]) => c !== 'mercado');
    expect(padarias.length).toBeGreaterThan(3);

    const { acao, repetida } = acoes.propor('c1', 'criar_regra', { texto: 'padaria real', categoriaId: 'mercado', sentido: null });

    expect(repetida).toBe(false);
    expect(acao).toMatchObject({ situacao: 'pendente', modo: 'proposta', titulo: 'Criar regra de categoria', inverso: null });
    expect(acao.efeito).toContain(`Muda ${padarias.length} movimentos`);
    expect(acao.exemplos.length).toBe(5);
    expect(acao.exemplos[0]).toMatchObject({ de: 'Restaurantes', para: 'Mercado' });
    expect(categoriaDe('Padaria Real')).toEqual(antes);
    expect(financas.todosOsMovimentos().length).toBeGreaterThan(0);
    // A mesma proposta de novo devolve a que já existe.
    expect(acoes.propor('c1', 'criar_regra', { texto: 'padaria real', categoriaId: 'mercado', sentido: null })).toMatchObject({ repetida: true, acao: { id: acao.id } });
  });

  it('aprovar pela tela executa uma vez só; desfazer volta exatamente como estava', () => {
    const { acoes, repositorio, turno, categoriaDe } = montar();
    turno('c1', 'coloca padaria em mercado');
    const antes = categoriaDe('Padaria Real');
    const { acao } = acoes.propor('c1', 'criar_regra', { texto: 'padaria real', categoriaId: 'mercado', sentido: null });

    const aprovada = acoes.aprovar(acao.id);
    const deNovo = acoes.aprovar(acao.id);

    expect(aprovada).toMatchObject({ situacao: 'aprovada', podeDesfazer: true, decididaEm: expect.any(String) });
    expect(deNovo).toEqual(aprovada);
    expect(repositorio.instantaneo().regras).toHaveLength(1);
    expect(categoriaDe('Padaria Real').every(([, c]) => c === 'mercado')).toBe(true);

    const desfeita = acoes.desfazer(acao.id);
    expect(desfeita).toMatchObject({ desfeitaEm: expect.any(String), podeDesfazer: false });
    expect(repositorio.instantaneo().regras).toHaveLength(0);
    expect(categoriaDe('Padaria Real')).toEqual(antes);
    expect(acoes.desfazer(acao.id)).toEqual(desfeita);
  });

  it('recusar fecha a proposta; depois disso aprovar é recusado', () => {
    const { acoes, turno, repositorio } = montar();
    turno('c1', 'padaria é mercado');
    const { acao } = acoes.propor('c1', 'criar_regra', { texto: 'padaria', categoriaId: 'mercado', sentido: null });
    expect(acoes.recusar(acao.id)).toMatchObject({ situacao: 'recusada' });
    expect(() => acoes.aprovar(acao.id)).toThrow(AcaoJaDecidida);
    expect(repositorio.instantaneo().regras).toHaveLength(0);
  });

  it('valida de novo na hora de aprovar: se mudou, vira "falhou" com o motivo', () => {
    const { acoes, turno, repositorio } = montar();
    turno('c1', 'cria a regra');
    const regra = repositorio.criarRegra({ id: 'r1', texto: 'starbucks', categoriaId: 'lazer', sentido: null });
    const { acao } = acoes.propor('c1', 'remover_regra', { regraId: regra.id });
    repositorio.removerRegra(regra.id);
    const r = acoes.aprovar(acao.id);
    expect(r).toMatchObject({ situacao: 'falhou', erro: expect.stringContaining('Regra não encontrada') });
    expect(() => acoes.aprovar(acao.id)).toThrow(AcaoJaDecidida);
  });

  it('remover regra e desfazer devolve a mesma regra, com a mesma prioridade', () => {
    const { acoes, turno, repositorio } = montar();
    repositorio.criarRegra({ id: 'r1', texto: 'starbucks', categoriaId: 'lazer', sentido: null });
    repositorio.criarRegra({ id: 'r2', texto: 'coco bambu', categoriaId: 'lazer', sentido: 'SAIDA' });
    turno('c1', 'tira a regra do starbucks');
    const { acao } = acoes.propor('c1', 'remover_regra', { regraId: 'r1' });
    expect(acao.efeito).toMatch(/movimentos? volta/);
    acoes.aprovar(acao.id);
    expect(repositorio.instantaneo().regras.map((r) => r.id)).toEqual(['r2']);
    acoes.desfazer(acao.id);
    expect(repositorio.instantaneo().regras.sort((a, b) => a.prioridade - b.prioridade)).toMatchObject([{ id: 'r1', prioridade: 1 }, { id: 'r2', prioridade: 2 }]);
  });

  it('a simulação conta movimentos com categoria escolhida à mão e regras antigas que vencem', () => {
    const { acoes, turno, financas, repositorio } = montar();
    const padarias = financas.todosOsMovimentos().filter((m) => m.descricao === 'Padaria Real');
    repositorio.salvarAjuste(padarias[0]!.id, { categoriaId: 'lazer' });
    repositorio.criarRegra({ id: 'antiga', texto: 'padaria', categoriaId: 'presentes', sentido: null });
    turno('c1', 'padaria real é mercado');
    const { acao } = acoes.propor('c1', 'criar_regra', { texto: 'padaria real', categoriaId: 'mercado', sentido: null });
    expect(acao.efeito).toContain('Hoje não muda nenhum movimento');
    expect(acao.efeito).toContain('1 movimento com categoria escolhida à mão fica como está');
    expect(acao.efeito).toContain(`A regra “padaria” (Presentes e doações) vem antes e continua valendo para ${padarias.length - 1} movimentos`);
  });
});

describe('ServicoDeAcoes — "sim" pela conversa', () => {
  it('só confirma com a mensagem da pessoa, respondendo à resposta que mostrou a proposta', () => {
    const { acoes, turno, repositorio } = montar();
    turno('c1', 'Padaria Real é mercado');
    const { acao } = acoes.propor('c1', 'criar_regra', { texto: 'padaria real', categoriaId: 'mercado', sentido: null });

    // Ainda na mesma resposta: a pessoa nem viu o cartão.
    expect(() => acoes.confirmarPelaConversa('c1', acao.id)).toThrow(/não está na resposta que a pessoa acabou de ver/);
    expect(() => acoes.confirmarPelaConversa('c1', undefined)).toThrow(/resposta que a pessoa viu/);
    turno('c1', 'quanto gastei com mercado?');
    expect(() => acoes.confirmarPelaConversa('c1', acao.id)).toThrow(/não é uma confirmação/);
    turno('c1', 'não, espera');
    // A proposta ficou duas respostas para trás: um "sim" agora não pode pegá-la.
    expect(() => acoes.confirmarPelaConversa('c1', acao.id)).toThrow(/não está na resposta/);
    // De outra conversa, nem com "sim".
    turno('c2', 'sim');
    expect(() => acoes.confirmarPelaConversa('c2', acao.id)).toThrow(/nesta conversa/);
    expect(repositorio.instantaneo().regras).toHaveLength(0);

    // O assistente mostra de novo (a mesma proposta passa para esta resposta) e a pessoa confirma.
    expect(acoes.propor('c1', 'criar_regra', { texto: 'padaria real', categoriaId: 'mercado', sentido: null })).toMatchObject({ repetida: true, acao: { id: acao.id } });
    turno('c1', 'Sim, pode criar');
    expect(acoes.confirmarPelaConversa('c1', acao.id)).toMatchObject({ situacao: 'aprovada' });
    expect(repositorio.instantaneo().regras).toHaveLength(1);
  });

  it('um "sim" não aprova uma proposta antiga que ainda estava pendente (só a da resposta anterior)', () => {
    const { acoes, turno, repositorio } = montar();
    turno('c1', 'limite de lazer 300');
    const antiga = acoes.propor('c1', 'definir_orcamento', { categoriaId: 'lazer', limite: 30000 }).acao;
    turno('c1', 'e padaria é mercado');
    const nova = acoes.propor('c1', 'criar_regra', { texto: 'padaria', categoriaId: 'mercado', sentido: null }).acao;
    turno('c1', 'sim');
    expect(() => acoes.confirmarPelaConversa('c1', antiga.id)).toThrow(/não está na resposta/);
    expect(repositorio.instantaneo().orcamentos.has('lazer')).toBe(false);
    expect(acoes.confirmarPelaConversa('c1', undefined)).toMatchObject({ id: nova.id, situacao: 'aprovada' });
  });

  it('sem id confirma a única pendente; proposta já decidida não volta', () => {
    const { acoes, turno } = montar();
    turno('c1', 'padaria é mercado');
    const { acao } = acoes.propor('c1', 'criar_regra', { texto: 'padaria', categoriaId: 'mercado', sentido: null });
    turno('c1', 'pode');
    expect(acoes.confirmarPelaConversa('c1', undefined)).toMatchObject({ id: acao.id, situacao: 'aprovada' });
    turno('c1', 'outra coisa');
    const { acao: outra } = acoes.propor('c1', 'definir_orcamento', { categoriaId: 'mercado', limite: 80000 });
    acoes.recusar(outra.id);
    turno('c1', 'sim');
    expect(() => acoes.confirmarPelaConversa('c1', outra.id)).toThrow(/recusada/);
  });

  it('proposta velha expira (um "sim" de amanhã não aprova a de ontem)', () => {
    const { acoes, turno, avancar } = montar();
    turno('c1', 'limite de mercado 800');
    const { acao } = acoes.propor('c1', 'definir_orcamento', { categoriaId: 'mercado', limite: 80000 });
    avancar(VALIDADE_PROPOSTA_MS + 1000);
    turno('c1', 'sim');
    expect(acoes.listar('c1')[0]).toMatchObject({ situacao: 'expirada' });
    expect(() => acoes.confirmarPelaConversa('c1', acao.id)).toThrow(/expirada/);
    expect(() => acoes.aprovar(acao.id)).toThrow(AcaoJaDecidida);
  });

  it('proposta de uma resposta apagada (refeita) expira', () => {
    const { acoes, turno, assistente } = montar();
    const resposta = turno('c1', 'limite de mercado 800');
    const { acao } = acoes.propor('c1', 'definir_orcamento', { categoriaId: 'mercado', limite: 80000 });
    assistente.removerMensagem(resposta);
    expect(acoes.listar('c1').find((a) => a.id === acao.id)).toMatchObject({ situacao: 'expirada' });
  });

  it('desfazer pela conversa exige o pedido da pessoa', () => {
    const { acoes, turno, financas } = montar();
    const m = financas.todosOsMovimentos().find((x) => x.descricao === 'Starbucks')!;
    turno('c1', 'esse starbucks foi presente');
    const feita = acoes.agir('c1', 'ajustar_movimento', { movimentoId: m.id, categoriaId: 'presentes' });
    turno('c1', 'obrigado');
    expect(() => acoes.desfazerPelaConversa('c1', undefined)).toThrow(/pede na mensagem dela/);
    turno('c1', 'não desfaz');
    expect(() => acoes.desfazerPelaConversa('c1', undefined)).toThrow(/pede na mensagem dela/);
    turno('c1', 'desfaz isso');
    expect(acoes.desfazerPelaConversa('c1', undefined)).toMatchObject({ id: feita.id, desfeitaEm: expect.any(String) });
    expect(financas.movimento(m.id)!.categoriaId).toBe(m.categoriaId);
  });
});

describe('ServicoDeAcoes — ações diretas', () => {
  it('ajustar um movimento e desfazer volta o ajuste anterior exatamente', () => {
    const { acoes, turno, financas, repositorio } = montar();
    const m = financas.todosOsMovimentos().find((x) => x.descricao === 'Posto Shell Select')!;
    repositorio.salvarAjuste(m.id, { nota: 'abasteci', categoriaId: 'transporte' });
    turno('c1', 'esse posto é carro');
    const a = acoes.agir('c1', 'ajustar_movimento', { movimentoId: m.id, categoriaId: 'carro' });
    expect(a).toMatchObject({ situacao: 'aprovada', modo: 'direta', descricao: expect.stringContaining('Transporte → Carro e combustível') });
    expect(financas.movimento(m.id)).toMatchObject({ categoriaId: 'carro', nota: 'abasteci' });
    acoes.desfazer(a.id);
    expect(financas.movimento(m.id)).toMatchObject({ categoriaId: 'transporte', nota: 'abasteci' });
  });

  it('não desfaz por cima de uma mudança feita depois', () => {
    const { acoes, turno, financas, repositorio } = montar();
    const m = financas.todosOsMovimentos().find((x) => x.descricao === 'Starbucks')!;
    turno('c1', 'starbucks é lazer');
    const a = acoes.agir('c1', 'ajustar_movimento', { movimentoId: m.id, categoriaId: 'lazer' });
    repositorio.salvarAjuste(m.id, { categoriaId: 'presentes' });
    expect(() => acoes.desfazer(a.id)).toThrow(ErroDeAcao);
    expect(financas.movimento(m.id)!.categoriaId).toBe('presentes');
  });

  it('recusa categoria do grupo errado e pedido vazio', () => {
    const { acoes, turno, financas } = montar();
    const m = financas.todosOsMovimentos().find((x) => x.natureza === 'DESPESA')!;
    turno('c1', 'muda');
    expect(() => acoes.agir('c1', 'ajustar_movimento', { movimentoId: m.id, categoriaId: 'salario' })).toThrow(/categoria de receita/);
    expect(() => acoes.agir('c1', 'ajustar_movimento', { movimentoId: m.id })).toThrow(/Diga o que mudar/);
    expect(() => acoes.agir('c1', 'ajustar_movimento', { movimentoId: 'nao-existe', categoriaId: 'lazer' })).toThrow(/não encontrado/);
  });

  it(`limita a ${MAXIMO_DIRETAS_POR_RESPOSTA} mudanças diretas por resposta`, () => {
    const { acoes, turno, financas } = montar();
    turno('c1', 'muda tudo');
    const gastos = financas.todosOsMovimentos().filter((m) => m.natureza === 'DESPESA' && m.categoriaId !== 'lazer');
    for (const m of gastos.slice(0, MAXIMO_DIRETAS_POR_RESPOSTA)) acoes.agir('c1', 'ajustar_movimento', { movimentoId: m.id, categoriaId: 'lazer' });
    expect(() => acoes.agir('c1', 'ajustar_movimento', { movimentoId: gastos[MAXIMO_DIRETAS_POR_RESPOSTA]!.id, categoriaId: 'lazer' }))
      .toThrow(/recategorizar_movimentos/);
  });
});

describe('ServicoDeAcoes — recategorizar, orçamento e metas', () => {
  it('recategorizar guarda só o que muda; desfazer pula o que foi mudado depois e avisa', () => {
    const { acoes, turno, financas, repositorio } = montar();
    const ifood = financas.todosOsMovimentos().filter((m) => m.descricao === 'iFood').slice(0, 4);
    turno('c1', 'esses ifood eram restaurante');
    const { acao } = acoes.propor('c1', 'recategorizar_movimentos', { movimentoIds: [...ifood.map((m) => m.id), 'sumiu'], categoriaId: 'restaurantes' });
    expect(acao.payload.movimentoIds).toEqual(ifood.map((m) => m.id));
    expect(acao.efeito).toContain('Muda 4 movimentos');
    acoes.aprovar(acao.id);
    repositorio.salvarAjuste(ifood[0]!.id, { categoriaId: 'lazer' });
    const desfeita = acoes.desfazer(acao.id);
    expect(desfeita.aviso).toBe('1 movimento foi mudado depois e ficou como está.');
    expect(ifood.slice(1).map((m) => financas.movimento(m.id)!.categoriaId)).toEqual(['delivery', 'delivery', 'delivery']);
    expect(financas.movimento(ifood[0]!.id)!.categoriaId).toBe('lazer');
  });

  it('orçamento: proposta com o gasto do mês, aprovar e desfazer', () => {
    const { acoes, turno, repositorio } = montar();
    repositorio.definirOrcamento('mercado', 50000);
    turno('c1', 'sobe o limite do mercado para mil');
    const { acao } = acoes.propor('c1', 'definir_orcamento', { categoriaId: 'mercado', limite: 100000 });
    expect(acao.descricao).toBe('Limite de Mercado: R$ 500,00 → R$ 1.000,00 por mês.');
    expect(acao.efeito).toMatch(/^Em set\/2026, Mercado já tem R\$ [\d.,]+ de gastos\.$/);
    acoes.aprovar(acao.id);
    expect(repositorio.instantaneo().orcamentos.get('mercado')).toBe(100000);
    acoes.desfazer(acao.id);
    expect(repositorio.instantaneo().orcamentos.get('mercado')).toBe(50000);
    expect(() => acoes.propor('c1', 'definir_orcamento', { categoriaId: 'salario', limite: 1 })).toThrow(/só para categorias de gasto/);
  });

  it('metas: criar, editar e apagar, cada uma desfeita de volta', () => {
    const { acoes, turno, repositorio } = montar();
    turno('c1', 'quero juntar 5 mil para viajar até março');
    const criar = acoes.propor('c1', 'criar_meta', { nome: 'Viagem', alvo: 500000, prazo: '2027-03', caixinhaId: null, valorManual: 100000 }).acao;
    expect(criar.descricao).toBe('Meta “Viagem”: juntar R$ 5.000,00, até mar/2027, começando com R$ 1.000,00.');
    expect(criar.efeito).toBe('Faltam R$ 4.000,00: dá R$ 666,67 por mês em 6 meses.');
    acoes.aprovar(criar.id);
    const meta = repositorio.instantaneo().metas[0]!;

    const editar = acoes.propor('c1', 'editar_meta', { metaId: meta.id, alvo: 600000 }).acao;
    expect(editar.descricao).toBe('Meta “Viagem”: alvo R$ 5.000,00 → R$ 6.000,00.');
    acoes.aprovar(editar.id);
    expect(repositorio.instantaneo().metas[0]!.alvo).toBe(600000);

    const apagar = acoes.propor('c1', 'remover_meta', { metaId: meta.id }).acao;
    acoes.aprovar(apagar.id);
    expect(repositorio.instantaneo().metas).toHaveLength(0);

    acoes.desfazer(apagar.id);
    acoes.desfazer(editar.id);
    expect(repositorio.instantaneo().metas[0]).toMatchObject({ id: meta.id, alvo: 500000 });
    acoes.desfazer(criar.id);
    expect(repositorio.instantaneo().metas).toHaveLength(0);
  });
});

describe('ServicoDeAcoes — contas a pagar', () => {
  it('criar é direta (origem assistente) e desfazer apaga; repetir a mesma conta é recusado', () => {
    const { acoes, turno, contas } = montar();
    turno('c1', 'a conta de luz de 150 vence dia 15');
    const a = acoes.agir('c1', 'criar_conta_a_pagar', { descricao: 'Conta de luz', valor: 15000, vencimento: '2026-10-15', repete: 'mensal', categoriaId: 'contas' });
    expect(a.descricao).toBe('“Conta de luz” (R$ 150,00, vence em 15/10/2026, todo mês) · Contas da casa.');
    expect(contas.listar()).toMatchObject([{ descricao: 'Conta de luz', valor: 15000, origem: 'assistente', situacao: 'aberta' }]);
    expect(() => acoes.agir('c1', 'criar_conta_a_pagar', { descricao: 'conta de luz', valor: 15000, vencimento: '2026-10-15' })).toThrow(/Já existe essa conta/);
    acoes.desfazer(a.id);
    expect(contas.listar()).toEqual([]);
  });

  it('desfazer a criação não apaga uma conta que foi paga depois', () => {
    const { acoes, turno, contas } = montar();
    turno('c1', 'a internet de 99,90 vence dia 10');
    const a = acoes.agir('c1', 'criar_conta_a_pagar', { descricao: 'Internet', valor: 9990, vencimento: '2026-10-10' });
    const conta = contas.listar()[0]!;
    contas.marcarPaga(conta.id, { data: '2026-09-24' });
    expect(() => acoes.desfazer(a.id)).toThrow(/paga\) depois/);
    expect(contas.obter(conta.id)).toMatchObject({ situacao: 'paga' });
  });

  it('marcar como paga e desfazer reabre (e some a próxima ocorrência gerada)', () => {
    const { acoes, turno, contas } = montar();
    const conta = contas.criar({ descricao: 'Aluguel', valor: 200000, vencimento: '2026-10-05', repete: 'mensal' });
    turno('c1', 'paguei o aluguel');
    const a = acoes.agir('c1', 'marcar_conta_paga', { contaId: conta.id, data: '2026-09-24' });
    expect(a.aviso).toBe('A próxima (05/11/2026) já está na lista.');
    expect(contas.listar().map((c) => c.situacao).sort()).toEqual(['aberta', 'paga']);
    acoes.desfazer(a.id);
    expect(contas.listar()).toMatchObject([{ id: conta.id, situacao: 'aberta', pagaEm: null }]);
  });

  it('apagar é proposta; aprovar apaga e desfazer devolve a mesma conta (mesmo id)', () => {
    const { acoes, turno, contas } = montar();
    const conta = contas.criar({ descricao: 'Internet', valor: 9990, vencimento: '2026-10-10' });
    turno('c1', 'apaga a internet');
    const { acao } = acoes.propor('c1', 'remover_conta_a_pagar', { contaId: conta.id });
    expect(contas.listar()).toHaveLength(1);
    acoes.aprovar(acao.id);
    expect(contas.listar()).toHaveLength(0);
    acoes.desfazer(acao.id);
    expect(contas.listar()).toMatchObject([{ id: conta.id, descricao: 'Internet', valor: 9990 }]);
  });

  it('editar é direta e desfazer volta os campos', () => {
    const { acoes, turno, contas } = montar();
    const conta = contas.criar({ descricao: 'Internet', valor: 9990, vencimento: '2026-10-10' });
    turno('c1', 'a internet subiu para 119,90');
    const a = acoes.agir('c1', 'editar_conta_a_pagar', { contaId: conta.id, valor: 11990 });
    expect(a.descricao).toBe('“Internet”: valor R$ 99,90 → R$ 119,90.');
    expect(contas.obter(conta.id)!.valor).toBe(11990);
    acoes.desfazer(a.id);
    expect(contas.obter(conta.id)!.valor).toBe(9990);
  });
});
