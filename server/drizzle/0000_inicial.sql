CREATE TABLE `ajustes` (
	`transacao_id` text PRIMARY KEY NOT NULL,
	`impressao` text NOT NULL,
	`natureza` text,
	`categoria_id` text,
	`nota` text,
	`ignorar` integer DEFAULT false NOT NULL,
	`atualizado_em` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `caixinhas` (
	`id` text PRIMARY KEY NOT NULL,
	`conta_id` text NOT NULL,
	`nome` text NOT NULL,
	`valor` integer NOT NULL,
	`indexador` text,
	`percentual_indexador` real,
	`atualizada_em` text NOT NULL,
	FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conexoes` (
	`id` text PRIMARY KEY NOT NULL,
	`provedor` text NOT NULL,
	`conector_id` integer,
	`nome` text NOT NULL,
	`logo_url` text,
	`cor` text,
	`situacao` text NOT NULL,
	`erro` text,
	`criada_em` text NOT NULL,
	`atualizada_no_banco` text,
	`ultima_sincronizacao` text,
	`consentimento_expira` text
);
--> statement-breakpoint
CREATE TABLE `configuracoes` (
	`chave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contas` (
	`id` text PRIMARY KEY NOT NULL,
	`conexao_id` text NOT NULL,
	`tipo` text NOT NULL,
	`nome` text NOT NULL,
	`numero` text,
	`instituicao` text NOT NULL,
	`saldo` integer NOT NULL,
	`titular` text,
	`documento_titular` text,
	`limite` integer,
	`limite_disponivel` integer,
	`fechamento` text,
	`vencimento` text,
	`atualizada_em` text NOT NULL,
	FOREIGN KEY (`conexao_id`) REFERENCES `conexoes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `faturas` (
	`id` text PRIMARY KEY NOT NULL,
	`conta_id` text NOT NULL,
	`vencimento` text NOT NULL,
	`fechamento` text,
	`total` integer NOT NULL,
	`pagamento_minimo` integer,
	`pago` integer NOT NULL,
	FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `historico` (
	`tipo` text NOT NULL,
	`ref_id` text NOT NULL,
	`dia` text NOT NULL,
	`valor` integer NOT NULL,
	PRIMARY KEY(`tipo`, `ref_id`, `dia`)
);
--> statement-breakpoint
CREATE TABLE `investimentos` (
	`id` text PRIMARY KEY NOT NULL,
	`conexao_id` text NOT NULL,
	`nome` text NOT NULL,
	`tipo` text NOT NULL,
	`subtipo` text,
	`saldo` integer NOT NULL,
	`valor_aplicado` integer,
	`rendimento` integer,
	`vencimento` text,
	`taxa` real,
	`indexador` text,
	`atualizada_em` text NOT NULL,
	FOREIGN KEY (`conexao_id`) REFERENCES `conexoes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `metas` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`alvo` integer NOT NULL,
	`prazo` text,
	`caixinha_id` text,
	`valor_manual` integer DEFAULT 0 NOT NULL,
	`icone` text NOT NULL,
	`cor` text NOT NULL,
	`criada_em` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orcamentos` (
	`categoria_id` text PRIMARY KEY NOT NULL,
	`limite` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `regras` (
	`id` text PRIMARY KEY NOT NULL,
	`texto` text NOT NULL,
	`categoria_id` text NOT NULL,
	`sentido` text,
	`prioridade` integer NOT NULL,
	`criada_em` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sincronizacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conexao_id` text NOT NULL,
	`inicio` text NOT NULL,
	`fim` text,
	`situacao` text NOT NULL,
	`novas` integer DEFAULT 0 NOT NULL,
	`atualizadas` integer DEFAULT 0 NOT NULL,
	`removidas` integer DEFAULT 0 NOT NULL,
	`erro` text
);
--> statement-breakpoint
CREATE TABLE `transacoes` (
	`id` text PRIMARY KEY NOT NULL,
	`conta_id` text NOT NULL,
	`tipo_conta` text NOT NULL,
	`data` text NOT NULL,
	`descricao` text NOT NULL,
	`descricao_original` text,
	`valor` integer NOT NULL,
	`sentido` text NOT NULL,
	`pendente` integer NOT NULL,
	`categoria_provedor` text,
	`categoria_provedor_id` text,
	`estabelecimento` text,
	`cnpj_estabelecimento` text,
	`contraparte_nome` text,
	`contraparte_documento` text,
	`meio_pagamento` text,
	`parcela_numero` integer,
	`parcela_total` integer,
	`parcela_valor_total` integer,
	`parcela_data_compra` text,
	`fatura_id` text,
	`fatura_prevista` text,
	`impressao` text NOT NULL,
	FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transacoes_conta_data` ON `transacoes` (`conta_id`,`data`);--> statement-breakpoint
CREATE INDEX `transacoes_impressao` ON `transacoes` (`impressao`);