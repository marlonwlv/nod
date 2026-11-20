-- definido em 2026-11-19 (desfazer a pausa em lote): "Pausar todas as rotinas" (⌘K e chat) marca cada rotina que pausou
-- com o MESMO lote. É o que deixa desfazer só aquela pausa: o Desfazer do aviso, o "Reativar as N" de Ajustes › Rotinas
-- e a ferramenta reativar_lote_rotinas voltam as rotinas do lote, e as que a pessoa já tinha pausado antes ficam como
-- estão (no caso que motivou isto, 38 do clique e 56 pausadas antes). null = pausada sozinha, ou ativa.
-- Aditiva: colunas nulas, sem backfill. O servidor antigo (a cor velha nos 10 min do deploy, ou o rollback de imagem) não
-- lê as colunas, mas ESCREVE estado: o trigger nod_rotina_limpa_lote apaga o lote quando a pausada vira ativa, senão o
-- "Ativar" dele bateria no CHECK (o mesmo desenho da 0167).
SET LOCAL lock_timeout = '5s';

ALTER TABLE rotinas ADD COLUMN pausa_lote_id uuid;
ALTER TABLE rotinas ADD COLUMN pausa_lote_em timestamptz;

CREATE FUNCTION nod_rotina_limpa_lote() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.pausa_lote_id := NULL;
  NEW.pausa_lote_em := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER nod_rotina_limpa_lote BEFORE UPDATE OF estado ON rotinas
  FOR EACH ROW WHEN (OLD.estado = 'pausada' AND NEW.estado = 'ativa') EXECUTE FUNCTION nod_rotina_limpa_lote();

ALTER TABLE rotinas ADD CONSTRAINT rotinas_lote_so_pausada CHECK (pausa_lote_id IS NULL OR estado = 'pausada');
ALTER TABLE rotinas ADD CONSTRAINT rotinas_lote_com_hora CHECK ((pausa_lote_id IS NULL) = (pausa_lote_em IS NULL));
-- Reativar o lote procura, por pessoa, as rotinas dele.
CREATE INDEX rotinas_por_lote_de_pausa ON rotinas (tenant_id, owner_id, pausa_lote_id) WHERE pausa_lote_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS rotinas_por_lote_de_pausa;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_lote_com_hora;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_lote_so_pausada;
-- DROP TRIGGER IF EXISTS nod_rotina_limpa_lote ON rotinas;
-- DROP FUNCTION IF EXISTS nod_rotina_limpa_lote();
-- ALTER TABLE rotinas DROP COLUMN pausa_lote_em;
-- ALTER TABLE rotinas DROP COLUMN pausa_lote_id;
