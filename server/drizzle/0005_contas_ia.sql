PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessoes_cli` (
	`conversa_id` text NOT NULL,
	`provedor` text NOT NULL,
	`conta_id` text NOT NULL,
	`sessao_id` text NOT NULL,
	`atualizada_em` text NOT NULL,
	PRIMARY KEY(`conversa_id`, `conta_id`),
	FOREIGN KEY (`conversa_id`) REFERENCES `conversas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Antes as sessões eram por CLI; as contas padrão têm id igual ao do CLI, então nada se perde.
INSERT INTO `__new_sessoes_cli`("conversa_id", "provedor", "conta_id", "sessao_id", "atualizada_em") SELECT "conversa_id", "provedor", "provedor", "sessao_id", "atualizada_em" FROM `sessoes_cli`;--> statement-breakpoint
DROP TABLE `sessoes_cli`;--> statement-breakpoint
ALTER TABLE `__new_sessoes_cli` RENAME TO `sessoes_cli`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `conversas` ADD `conta_id` text;--> statement-breakpoint
ALTER TABLE `mensagens` ADD `conta_id` text;