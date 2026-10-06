CREATE TABLE `anexos` (
	`id` text PRIMARY KEY NOT NULL,
	`conversa_id` text NOT NULL,
	`mensagem_id` text,
	`nome` text NOT NULL,
	`mime` text NOT NULL,
	`tipo` text NOT NULL,
	`tamanho` integer NOT NULL,
	`arquivo` text NOT NULL,
	`sha256` text NOT NULL,
	`situacao` text NOT NULL,
	`erro` text,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`conversa_id`) REFERENCES `conversas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mensagem_id`) REFERENCES `mensagens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `anexos_conversa` ON `anexos` (`conversa_id`);--> statement-breakpoint
CREATE TABLE `conversas` (
	`id` text PRIMARY KEY NOT NULL,
	`titulo` text NOT NULL,
	`provedor` text NOT NULL,
	`modelo` text,
	`fixada` integer DEFAULT false NOT NULL,
	`criada_em` text NOT NULL,
	`atualizada_em` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversas_atualizada` ON `conversas` (`atualizada_em`);--> statement-breakpoint
CREATE TABLE `mensagens` (
	`id` text PRIMARY KEY NOT NULL,
	`conversa_id` text NOT NULL,
	`ordem` integer NOT NULL,
	`papel` text NOT NULL,
	`texto` text NOT NULL,
	`passos` text DEFAULT '[]' NOT NULL,
	`situacao` text NOT NULL,
	`erro` text,
	`provedor` text,
	`modelo` text,
	`uso` text,
	`criada_em` text NOT NULL,
	FOREIGN KEY (`conversa_id`) REFERENCES `conversas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mensagens_conversa` ON `mensagens` (`conversa_id`,`ordem`);--> statement-breakpoint
CREATE TABLE `sessoes_cli` (
	`conversa_id` text NOT NULL,
	`provedor` text NOT NULL,
	`sessao_id` text NOT NULL,
	`atualizada_em` text NOT NULL,
	PRIMARY KEY(`conversa_id`, `provedor`),
	FOREIGN KEY (`conversa_id`) REFERENCES `conversas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trechos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fonte` text NOT NULL,
	`ref_id` text NOT NULL,
	`escopo` text NOT NULL,
	`ordem` integer NOT NULL,
	`texto` text NOT NULL,
	`hash` text NOT NULL,
	`vetorizado` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trechos_ref` ON `trechos` (`fonte`,`ref_id`);--> statement-breakpoint
CREATE INDEX `trechos_escopo` ON `trechos` (`escopo`,`vetorizado`);