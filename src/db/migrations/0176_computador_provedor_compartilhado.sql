-- NOD-498: a máquina é uma alocação por pessoa e cada bot ocupa um display do provedor.
-- A referência é opaca (id de screen no Orgo; no Docker o supervisor usa o agente_id) e fica na tela,
-- nunca no agente nem no computador. Nula durante o reconcile e para providers que não precisam persistir id externo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE computador_telas ADD COLUMN provedor_ref text
  CONSTRAINT computador_telas_provedor_ref_tamanho CHECK (char_length(provedor_ref) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX computador_telas_provedor_ref_unica
  ON computador_telas (tenant_id, computador_id, provedor_ref) WHERE provedor_ref IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX computador_telas_provedor_ref_unica;
-- ALTER TABLE computador_telas DROP COLUMN provedor_ref;
