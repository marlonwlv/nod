-- definido em 2026-11-11 (NOD-412): pausar uma rotina até uma data. `retomar_em` é o instante absoluto (UTC) em que o
-- agendador a reativa sozinho; null = pausa sem data (a de sempre). Só existe na pausada: ativar sempre limpa.
-- Aditiva: coluna nula, sem backfill; o servidor antigo não lê nem escreve a coluna, e o CHECK aceita todas as linhas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE rotinas ADD COLUMN retomar_em timestamptz;
ALTER TABLE rotinas ADD CONSTRAINT rotinas_retomar_so_pausada CHECK (retomar_em IS NULL OR estado = 'pausada');
-- O tick procura, por pessoa, as pausadas cuja data chegou.
CREATE INDEX rotinas_a_retomar ON rotinas (tenant_id, owner_id, retomar_em)
  WHERE estado = 'pausada' AND retomar_em IS NOT NULL AND excluido_em IS NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS rotinas_a_retomar;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_retomar_so_pausada;
-- ALTER TABLE rotinas DROP COLUMN retomar_em;
