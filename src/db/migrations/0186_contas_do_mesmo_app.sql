-- definido em 2026-11-25 (ADR-196, duas contas do mesmo app): cada conta a mais de um app do Composio é um conector
-- `<app>--<conta>` com a sua sessão. A sessão da conta a mais guarda em `composio_sessoes.toolkit` a chave do conector
-- ("gmail--pessoal"), e a primeira segue com o slug do app ("gmail"): o UNIQUE (tenant_id, owner_id, toolkit) da 0009
-- fica como está, e o `on conflict` do servidor antigo continua casando com ele (revisão do PR: trocar a constraint
-- quebraria todo "Conectar" na janela do deploy e no rollback de imagem). `email` é só para a tela ("Gmail (pessoal) ·
-- e-mail"). `conectores.removido_em` marca a conta tirada pela pessoa: o conector fica (as regras permanentes apontam
-- para ele e a revogação delas é marca, ADR-004), sai das listas e volta se a pessoa conectar de novo com o mesmo nome.
-- Só adição: o servidor antigo no ar não lê as colunas novas.
SET LOCAL lock_timeout = '5s';
ALTER TABLE composio_sessoes ADD COLUMN email text CHECK (length(email) <= 254);
CREATE INDEX composio_sessoes_por_conector ON composio_sessoes (tenant_id, conector_id);
ALTER TABLE conectores ADD COLUMN removido_em timestamptz;
-- ROLLBACK:
-- ALTER TABLE conectores DROP COLUMN removido_em;
-- DROP INDEX composio_sessoes_por_conector;
-- ALTER TABLE composio_sessoes DROP COLUMN email;
