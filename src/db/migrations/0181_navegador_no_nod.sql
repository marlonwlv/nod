-- definido em 2026-11-20 (ADR-190, quadro N): "Volta para o nod" é uma escolha explícita do bot, diferente de "nenhuma
-- máquina escolhida" (maquina_id nulo = a mesma do computador do bot, ou a primeira que a pessoa conectou). Com no_nod, o
-- navegador do bot que continua com o Mac desligado roda no servidor mesmo com uma máquina sempre ligada na conta.
-- Só adição: o servidor antigo no ar não lê esta coluna.
SET LOCAL lock_timeout = '5s';
ALTER TABLE navegador_preferencias ADD COLUMN no_nod boolean NOT NULL DEFAULT false;
-- ROLLBACK:
-- ALTER TABLE navegador_preferencias DROP COLUMN no_nod;
