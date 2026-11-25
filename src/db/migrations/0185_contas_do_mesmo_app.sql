-- definido em 2026-11-25 (ADR-196, duas contas do mesmo app): cada conta a mais de um app do Composio é um conector
-- `<app>--<conta>` com a sua sessão. `composio_sessoes` deixa de ser uma linha por pessoa e app e passa a uma por
-- pessoa, app e conta: `conta` nula é a primeira (a de sempre, todas as linhas de hoje), e o índice único usa
-- coalesce para a nula não repetir. `email` é só para a tela ("Gmail (pessoal) · e-mail"). `conectores.removido_em`
-- marca a conta tirada pela pessoa: o conector fica (as regras permanentes apontam para ele e a revogação delas é
-- marca, ADR-004), sai das listas e volta se a pessoa conectar de novo com o mesmo nome. Só adição: o servidor antigo
-- no ar não lê as colunas, e o índice novo aceita tudo o que o UNIQUE antigo aceitava.
SET LOCAL lock_timeout = '5s';
ALTER TABLE composio_sessoes ADD COLUMN conta text CHECK (conta ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(conta) <= 20);
ALTER TABLE composio_sessoes ADD COLUMN email text CHECK (length(email) <= 254);
ALTER TABLE composio_sessoes DROP CONSTRAINT composio_sessoes_tenant_id_owner_id_toolkit_key;
CREATE UNIQUE INDEX composio_sessoes_conta_unica ON composio_sessoes (tenant_id, owner_id, toolkit, coalesce(conta, ''));
CREATE INDEX composio_sessoes_por_conector ON composio_sessoes (tenant_id, conector_id);
ALTER TABLE conectores ADD COLUMN removido_em timestamptz;
-- ROLLBACK:
-- ALTER TABLE conectores DROP COLUMN removido_em;
-- DROP INDEX composio_sessoes_por_conector;
-- DROP INDEX composio_sessoes_conta_unica;
-- ALTER TABLE composio_sessoes ADD CONSTRAINT composio_sessoes_tenant_id_owner_id_toolkit_key UNIQUE (tenant_id, owner_id, toolkit);
-- ALTER TABLE composio_sessoes DROP COLUMN email;
-- ALTER TABLE composio_sessoes DROP COLUMN conta;
