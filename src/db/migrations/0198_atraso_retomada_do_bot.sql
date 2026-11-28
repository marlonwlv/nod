-- definido em 2026-11-26 (ADR-198): o atraso em minutos que `aposLimiteNoFundo` soma à retomada depois de uma
-- pausa por limite de cota (assentar-turno.ts) — para bots da mesma dona cujas janelas de 5 h resetam juntas não
-- acordarem todos no mesmo minuto. Nulo (o default de todo bot hoje) = sem atraso, igual ao comportamento atual.
--
-- Só adição, nula, sem default e sem backfill: o ADD COLUMN é só catálogo e o insert do código anterior continua
-- passando. Os valores por bot (ex.: Gilda 0, Hiring 5, Hub 10, KR5 20, Avulso 25) são operacionais, gravados depois do
-- merge — não há tela ainda; ver a issue da ADR-198 sobre a tela de ajuste.
-- lock_timeout de 5 s: se a trava não vier, a migração falha e o deploy para limpo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agentes ADD COLUMN atraso_retomada_min integer CONSTRAINT agentes_atraso_retomada_min CHECK (atraso_retomada_min BETWEEN 0 AND 180);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE agentes DROP COLUMN IF EXISTS atraso_retomada_min;
