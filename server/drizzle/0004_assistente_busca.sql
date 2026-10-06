-- Busca por palavra dos trechos do assistente (BM25). Conteúdo externo: o texto mora só em
-- `trechos`; os gatilhos mantêm o índice igual à tabela. `remove_diacritics 2`: "acai" acha "Açaí".
-- O índice de vetores (sqlite-vec) não está aqui: depende de uma extensão nativa e é criado na
-- subida, se ela carregar — sem ela o Fluxo continua abrindo, só sem a busca por significado.
CREATE VIRTUAL TABLE `trechos_fts` USING fts5(texto, content='trechos', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `trechos_fts_insercao` AFTER INSERT ON `trechos` BEGIN
  INSERT INTO `trechos_fts`(rowid, texto) VALUES (new.id, new.texto);
END;
--> statement-breakpoint
CREATE TRIGGER `trechos_fts_exclusao` AFTER DELETE ON `trechos` BEGIN
  INSERT INTO `trechos_fts`(`trechos_fts`, rowid, texto) VALUES ('delete', old.id, old.texto);
END;
--> statement-breakpoint
CREATE TRIGGER `trechos_fts_atualizacao` AFTER UPDATE OF texto ON `trechos` BEGIN
  INSERT INTO `trechos_fts`(`trechos_fts`, rowid, texto) VALUES ('delete', old.id, old.texto);
  INSERT INTO `trechos_fts`(rowid, texto) VALUES (new.id, new.texto);
END;
