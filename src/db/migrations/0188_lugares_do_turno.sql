-- definido em 2026-11-27 (ADR-199): a sessão do CLI só é retomada enquanto os lugares do bot não melhoraram.
-- - turnos.lugares: a marca dos lugares do bot no turno ("computador=fora_do_ar;navegador=no_plano;seuComputador=ausente",
--   src/domain/lugares-da-sessao.ts), gravada na emissão do plano. O turno seguinte da mesma sessão compara com ela pelo
--   índice turnos_por_sessao_cli (0035). Nasce nula: o turno de antes desta migração é "não se sabe" e retoma como antes.
-- - 'lugares_mudaram' entra nos motivos de recomeço: o turno de conversa que largou a sessão por isso mostra a marca
--   "recomeçou" como os outros.
-- ADD COLUMN sem default não reescreve a tabela. O CHECK é trocado NOT VALID, como na 0180. lock_timeout de 5 s: sem a
-- trava, o deploy para limpo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS lugares text;

ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_motivo_recomeco_valido;
ALTER TABLE turnos
  ADD CONSTRAINT turnos_motivo_recomeco_valido
    CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada', 'autocompactacao', 'instavel', 'erro_repetido', 'nod_atualizou', 'lugares_mudaram')) NOT VALID;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- UPDATE turnos SET motivo_recomeco = NULL WHERE motivo_recomeco = 'lugares_mudaram';
-- ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_motivo_recomeco_valido;
-- ALTER TABLE turnos
--   ADD CONSTRAINT turnos_motivo_recomeco_valido
--     CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada', 'autocompactacao', 'instavel', 'erro_repetido', 'nod_atualizou')) NOT VALID;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS lugares;
