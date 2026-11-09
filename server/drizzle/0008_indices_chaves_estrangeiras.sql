CREATE INDEX `anexos_mensagem` ON `anexos` (`mensagem_id`);--> statement-breakpoint
CREATE INDEX `caixinhas_conta` ON `caixinhas` (`conta_id`);--> statement-breakpoint
CREATE INDEX `contas_conexao` ON `contas` (`conexao_id`);--> statement-breakpoint
CREATE INDEX `conversas_conta` ON `conversas` (`conta_id`);--> statement-breakpoint
CREATE INDEX `faturas_conta` ON `faturas` (`conta_id`,`vencimento`);--> statement-breakpoint
CREATE INDEX `investimentos_conexao` ON `investimentos` (`conexao_id`);