-- NOD-498: a máquina é uma alocação por pessoa e cada bot ocupa um display do provedor.
-- A referência é opaca (id de screen no Orgo; no Docker o supervisor usa o agente_id) e fica na tela,
-- nunca no agente nem no computador. Nula durante o reconcile e para providers que não precisam persistir id externo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE computador_telas ADD COLUMN provedor_ref text
  CONSTRAINT computador_telas_provedor_ref_tamanho CHECK (char_length(provedor_ref) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX computador_telas_provedor_ref_unica
  ON computador_telas (tenant_id, computador_id, provedor_ref) WHERE provedor_ref IS NOT NULL;

-- O legado por bot só pode ser arquivado depois de o volume ter sido copiado. Estas colunas são o recibo idempotente
-- do passo externo: mantêm origem, bot e destino auditáveis, sem apagar os volumes antigos.
ALTER TABLE computadores
  ADD COLUMN legado_migrado_para uuid,
  ADD COLUMN legado_migrado_agente_id uuid,
  ADD COLUMN legado_migrado_em timestamptz;
ALTER TABLE computadores ADD CONSTRAINT computadores_legado_migrado_completo CHECK (
  (legado_migrado_em IS NULL) = (legado_migrado_para IS NULL)
  AND (legado_migrado_em IS NULL) = (legado_migrado_agente_id IS NULL)
);
ALTER TABLE computadores ADD CONSTRAINT computadores_legado_migrado_para_fkey
  FOREIGN KEY (tenant_id, legado_migrado_para) REFERENCES computadores (tenant_id, id);

-- ROLLBACK:
-- ALTER TABLE computadores DROP CONSTRAINT computadores_legado_migrado_para_fkey;
-- ALTER TABLE computadores DROP CONSTRAINT computadores_legado_migrado_completo;
-- ALTER TABLE computadores DROP COLUMN legado_migrado_em, DROP COLUMN legado_migrado_agente_id, DROP COLUMN legado_migrado_para;
-- DROP INDEX computador_telas_provedor_ref_unica;
-- ALTER TABLE computador_telas DROP COLUMN provedor_ref;
