-- definido em 2026-11-23 (ADR-193, painel admin de uso): `pessoas` não guardava quando a pessoa entrou. O painel
-- conta cadastros por dia e o tempo até o primeiro bot a partir daqui. As linhas antigas ficam nulas (o painel cai
-- para `conta_pessoas.criada_em` e, sem ela, para o primeiro sinal de uso); as novas recebem a hora do INSERT pelo
-- default, sem mexer em quem insere. Só adição: o servidor antigo no ar não lê a coluna.
SET LOCAL lock_timeout = '5s';
ALTER TABLE pessoas ADD COLUMN criada_em timestamptz;
ALTER TABLE pessoas ALTER COLUMN criada_em SET DEFAULT clock_timestamp();
-- ROLLBACK:
-- ALTER TABLE pessoas DROP COLUMN criada_em;
