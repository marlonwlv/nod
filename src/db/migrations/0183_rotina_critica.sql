-- definido em 2026-11-24 (emenda da ADR-044): `critica` é a marca EXPLÍCITA que a pessoa dá a uma rotina
-- (nunca inferida do texto do agente ou da instrução — a ADR rejeita classificar a fonte com o modelo).
-- Quando o varredor de expiração pausa uma rotina marcada assim por falta de acesso, o aviso é mais forte.
-- Aditiva: coluna com default, sem backfill condicional (toda rotina existente vira não-crítica).
SET LOCAL lock_timeout = '5s';

ALTER TABLE rotinas ADD COLUMN critica boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE rotinas DROP COLUMN critica;
