import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * O banco local. Dinheiro em centavos (integer), datas em texto 'AAAA-MM-DD',
 * instantes em texto ISO. O que vem do provedor é substituível a cada
 * sincronização; o que o usuário cria (ajustes, regras, orçamento, metas)
 * nunca é apagado pela sincronização.
 */

export const conexoes = sqliteTable('conexoes', {
  id: text('id').primaryKey(),
  provedor: text('provedor', { enum: ['pluggy', 'demo'] }).notNull(),
  conectorId: integer('conector_id'),
  nome: text('nome').notNull(),
  logoUrl: text('logo_url'),
  cor: text('cor'),
  situacao: text('situacao').notNull(),
  erro: text('erro'),
  criadaEm: text('criada_em').notNull(),
  atualizadaNoBanco: text('atualizada_no_banco'),
  ultimaSincronizacao: text('ultima_sincronizacao'),
  consentimentoExpira: text('consentimento_expira'),
});

export const contas = sqliteTable('contas', {
  id: text('id').primaryKey(),
  conexaoId: text('conexao_id').notNull().references(() => conexoes.id, { onDelete: 'cascade' }),
  tipo: text('tipo', { enum: ['CONTA', 'POUPANCA', 'CARTAO'] }).notNull(),
  nome: text('nome').notNull(),
  numero: text('numero'),
  instituicao: text('instituicao').notNull(),
  saldo: integer('saldo').notNull(),
  titular: text('titular'),
  documentoTitular: text('documento_titular'),
  limite: integer('limite'),
  limiteDisponivel: integer('limite_disponivel'),
  fechamento: text('fechamento'),
  vencimento: text('vencimento'),
  atualizadaEm: text('atualizada_em').notNull(),
});

export const caixinhas = sqliteTable('caixinhas', {
  id: text('id').primaryKey(),
  contaId: text('conta_id').notNull().references(() => contas.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  valor: integer('valor').notNull(),
  indexador: text('indexador'),
  percentualIndexador: real('percentual_indexador'),
  atualizadaEm: text('atualizada_em').notNull(),
});

export const investimentos = sqliteTable('investimentos', {
  id: text('id').primaryKey(),
  conexaoId: text('conexao_id').notNull().references(() => conexoes.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  tipo: text('tipo').notNull(),
  subtipo: text('subtipo'),
  saldo: integer('saldo').notNull(),
  valorAplicado: integer('valor_aplicado'),
  rendimento: integer('rendimento'),
  vencimento: text('vencimento'),
  taxa: real('taxa'),
  indexador: text('indexador'),
  atualizadaEm: text('atualizada_em').notNull(),
});

export const transacoes = sqliteTable(
  'transacoes',
  {
    id: text('id').primaryKey(),
    contaId: text('conta_id').notNull().references(() => contas.id, { onDelete: 'cascade' }),
    tipoConta: text('tipo_conta', { enum: ['CONTA', 'POUPANCA', 'CARTAO'] }).notNull(),
    data: text('data').notNull(),
    descricao: text('descricao').notNull(),
    descricaoOriginal: text('descricao_original'),
    valor: integer('valor').notNull(),
    sentido: text('sentido', { enum: ['ENTRADA', 'SAIDA'] }).notNull(),
    pendente: integer('pendente', { mode: 'boolean' }).notNull(),
    categoriaProvedor: text('categoria_provedor'),
    categoriaProvedorId: text('categoria_provedor_id'),
    estabelecimento: text('estabelecimento'),
    cnpjEstabelecimento: text('cnpj_estabelecimento'),
    contraparteNome: text('contraparte_nome'),
    contraparteDocumento: text('contraparte_documento'),
    meioPagamento: text('meio_pagamento'),
    parcelaNumero: integer('parcela_numero'),
    parcelaTotal: integer('parcela_total'),
    parcelaValorTotal: integer('parcela_valor_total'),
    parcelaDataCompra: text('parcela_data_compra'),
    parcelaInstanteCompra: text('parcela_instante_compra'),
    faturaId: text('fatura_id'),
    faturaPrevista: text('fatura_prevista'),
    outroCredito: text('outro_credito', { enum: ['REVOLVING_CREDIT', 'BILL_INSTALLMENT', 'LOAN', 'OTHER'] }),
    impressao: text('impressao').notNull(),
  },
  (t) => [index('transacoes_conta_data').on(t.contaId, t.data), index('transacoes_impressao').on(t.impressao)],
);

export const faturas = sqliteTable('faturas', {
  id: text('id').primaryKey(),
  contaId: text('conta_id').notNull().references(() => contas.id, { onDelete: 'cascade' }),
  vencimento: text('vencimento').notNull(),
  fechamento: text('fechamento'),
  total: integer('total').notNull(),
  pagamentoMinimo: integer('pagamento_minimo'),
  pago: integer('pago').notNull(),
});

/** Edições manuais. Chave pela transação, com a impressão para sobreviver à troca de id. */
export const ajustes = sqliteTable('ajustes', {
  transacaoId: text('transacao_id').primaryKey(),
  impressao: text('impressao').notNull(),
  natureza: text('natureza'),
  categoriaId: text('categoria_id'),
  nota: text('nota'),
  ignorar: integer('ignorar', { mode: 'boolean' }).notNull().default(false),
  atualizadoEm: text('atualizado_em').notNull(),
});

export const regras = sqliteTable('regras', {
  id: text('id').primaryKey(),
  texto: text('texto').notNull(),
  categoriaId: text('categoria_id').notNull(),
  sentido: text('sentido', { enum: ['ENTRADA', 'SAIDA'] }),
  prioridade: integer('prioridade').notNull(),
  criadaEm: text('criada_em').notNull(),
});

export const orcamentos = sqliteTable('orcamentos', {
  categoriaId: text('categoria_id').primaryKey(),
  limite: integer('limite').notNull(),
});

export const metas = sqliteTable('metas', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  alvo: integer('alvo').notNull(),
  prazo: text('prazo'),
  caixinhaId: text('caixinha_id'),
  valorManual: integer('valor_manual').notNull().default(0),
  icone: text('icone').notNull(),
  cor: text('cor').notNull(),
  criadaEm: text('criada_em').notNull(),
});

/**
 * Contas a pagar que a pessoa (ou o assistente) cadastra: "a luz de R$ 150 vence
 * dia 10". Criadas só pelo usuário: a sincronização nunca toca. A conciliação
 * marca como paga quando o débito cai (`movimento_id` aponta a transação).
 */
export const contasAPagar = sqliteTable(
  'contas_a_pagar',
  {
    id: text('id').primaryKey(),
    descricao: text('descricao').notNull(),
    valor: integer('valor').notNull(),
    vencimento: text('vencimento').notNull(),
    /** Dia combinado (o 31 de "todo dia 31"), para a próxima ocorrência voltar a ele depois de fevereiro. */
    diaDoVencimento: integer('dia_do_vencimento').notNull(),
    repete: text('repete', { enum: ['nao', 'mensal', 'anual'] }).notNull().default('nao'),
    categoriaId: text('categoria_id'),
    textoNoExtrato: text('texto_no_extrato'),
    pagaEm: text('paga_em'),
    movimentoId: text('movimento_id'),
    /** Movimentos (JSON) que a pessoa desligou desta conta: a conciliação não os escolhe de novo. */
    recusados: text('recusados').notNull().default('[]'),
    /** A conta que gerou esta (ocorrência seguinte de uma conta que repete). */
    anteriorId: text('anterior_id'),
    origem: text('origem', { enum: ['pessoa', 'assistente'] }).notNull().default('pessoa'),
    nota: text('nota'),
    criadaEm: text('criada_em').notNull(),
    atualizadaEm: text('atualizada_em').notNull(),
  },
  (t) => [index('contas_a_pagar_vencimento').on(t.vencimento), index('contas_a_pagar_anterior').on(t.anteriorId)],
);

/** Foto diária de saldos, para os gráficos de evolução. Uma linha por (tipo, ref, dia). */
export const historico = sqliteTable(
  'historico',
  {
    tipo: text('tipo', { enum: ['conta', 'caixinha', 'investimento', 'patrimonio'] }).notNull(),
    refId: text('ref_id').notNull(),
    dia: text('dia').notNull(),
    valor: integer('valor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tipo, t.refId, t.dia] })],
);

export const sincronizacoes = sqliteTable('sincronizacoes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conexaoId: text('conexao_id').notNull(),
  inicio: text('inicio').notNull(),
  fim: text('fim'),
  situacao: text('situacao', { enum: ['RODANDO', 'OK', 'ERRO'] }).notNull(),
  novas: integer('novas').notNull().default(0),
  atualizadas: integer('atualizadas').notNull().default(0),
  removidas: integer('removidas').notNull().default(0),
  erro: text('erro'),
});

export const configuracoes = sqliteTable('configuracoes', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
});

// ------------------------------------------------------------ assistente

const PROVEDORES_IA = ['claude', 'gemini', 'codex'] as const;

/** Conversas com o assistente. Criadas só pelo usuário: a sincronização nunca toca. */
export const conversas = sqliteTable(
  'conversas',
  {
    id: text('id').primaryKey(),
    titulo: text('titulo').notNull(),
    provedor: text('provedor', { enum: PROVEDORES_IA }).notNull(),
    /** A conta (login de um CLI) da configuração do assistente; nula nas antigas = a padrão do provedor. */
    contaId: text('conta_id'),
    modelo: text('modelo'),
    fixada: integer('fixada', { mode: 'boolean' }).notNull().default(false),
    criadaEm: text('criada_em').notNull(),
    atualizadaEm: text('atualizada_em').notNull(),
  },
  (t) => [index('conversas_atualizada').on(t.atualizadaEm)],
);

export const mensagens = sqliteTable(
  'mensagens',
  {
    id: text('id').primaryKey(),
    conversaId: text('conversa_id').notNull().references(() => conversas.id, { onDelete: 'cascade' }),
    /** Posição na conversa: duas mensagens podem nascer no mesmo milissegundo. */
    ordem: integer('ordem').notNull(),
    papel: text('papel', { enum: ['usuario', 'assistente'] }).notNull(),
    texto: text('texto').notNull(),
    /** Chamadas de ferramenta do assistente, em JSON. */
    passos: text('passos').notNull().default('[]'),
    situacao: text('situacao', { enum: ['gerando', 'ok', 'erro', 'cancelada', 'interrompida'] }).notNull(),
    erro: text('erro'),
    contaId: text('conta_id'),
    provedor: text('provedor', { enum: PROVEDORES_IA }),
    modelo: text('modelo'),
    /** Tokens, custo e duração, em JSON. */
    uso: text('uso'),
    criadaEm: text('criada_em').notNull(),
  },
  (t) => [index('mensagens_conversa').on(t.conversaId, t.ordem)],
);

export const anexos = sqliteTable(
  'anexos',
  {
    id: text('id').primaryKey(),
    conversaId: text('conversa_id').notNull().references(() => conversas.id, { onDelete: 'cascade' }),
    /** Nulo enquanto o anexo está só na caixa de texto, ainda não enviado. */
    mensagemId: text('mensagem_id').references(() => mensagens.id, { onDelete: 'set null' }),
    nome: text('nome').notNull(),
    mime: text('mime').notNull(),
    tipo: text('tipo', { enum: ['imagem', 'pdf', 'texto'] }).notNull(),
    tamanho: integer('tamanho').notNull(),
    /** Nome do arquivo gravado (`<id>.<extensão>`); o nome original nunca vira caminho. */
    arquivo: text('arquivo').notNull(),
    sha256: text('sha256').notNull(),
    situacao: text('situacao', { enum: ['pendente', 'indexando', 'pronto', 'sem_texto', 'erro'] }).notNull(),
    erro: text('erro'),
    /** 'pessoa' = a pessoa anexou; 'gerada' = imagem criada pelo assistente (Nano Banana) nesta conversa. */
    origem: text('origem', { enum: ['pessoa', 'gerada'] }).notNull().default('pessoa'),
    criadoEm: text('criado_em').notNull(),
  },
  (t) => [index('anexos_conversa').on(t.conversaId)],
);

/**
 * Sessão de cada conta em cada conversa, para continuar de onde parou
 * (`--resume`). Por conta, não por CLI: contas diferentes guardam as
 * sessões em pastas de login diferentes.
 */
export const sessoesCli = sqliteTable(
  'sessoes_cli',
  {
    conversaId: text('conversa_id').notNull().references(() => conversas.id, { onDelete: 'cascade' }),
    provedor: text('provedor', { enum: PROVEDORES_IA }).notNull(),
    contaId: text('conta_id').notNull(),
    sessaoId: text('sessao_id').notNull(),
    atualizadaEm: text('atualizada_em').notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversaId, t.contaId] })],
);

/**
 * Trechos de texto para a busca do assistente (movimentos e anexos). O `id`
 * é o rowid compartilhado com o índice de palavras (`trechos_fts`, FTS5) e
 * com o de vetores (`trechos_vec`, sqlite-vec).
 */
export const trechos = sqliteTable(
  'trechos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fonte: text('fonte', { enum: ['movimento', 'anexo'] }).notNull(),
    /** Id da transação ou do anexo. */
    refId: text('ref_id').notNull(),
    /** 'movimentos' ou 'conversa:<id>' — o mesmo filtro nos dois índices. */
    escopo: text('escopo').notNull(),
    ordem: integer('ordem').notNull(),
    texto: text('texto').notNull(),
    /** Hash do texto: movimento que não mudou não é vetorizado de novo. */
    hash: text('hash').notNull(),
    vetorizado: integer('vetorizado', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('trechos_ref').on(t.fonte, t.refId), index('trechos_escopo').on(t.escopo, t.vetorizado)],
);
