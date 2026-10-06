CREATE TABLE `contas_a_pagar` (
	`id` text PRIMARY KEY NOT NULL,
	`descricao` text NOT NULL,
	`valor` integer NOT NULL,
	`vencimento` text NOT NULL,
	`dia_do_vencimento` integer NOT NULL,
	`repete` text DEFAULT 'nao' NOT NULL,
	`categoria_id` text,
	`texto_no_extrato` text,
	`paga_em` text,
	`movimento_id` text,
	`recusados` text DEFAULT '[]' NOT NULL,
	`anterior_id` text,
	`origem` text DEFAULT 'pessoa' NOT NULL,
	`nota` text,
	`criada_em` text NOT NULL,
	`atualizada_em` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contas_a_pagar_vencimento` ON `contas_a_pagar` (`vencimento`);--> statement-breakpoint
CREATE INDEX `contas_a_pagar_anterior` ON `contas_a_pagar` (`anterior_id`);