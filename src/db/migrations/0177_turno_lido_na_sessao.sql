-- definido em 2026-11-16 (ADR-185): a fala da pessoa absorvida pelo turno vivo (ADR-067) ganha o momento em que o bot a
-- LEU. Escrita na sessão não é lida: o CLI só lê na fronteira seguinte (o fim de uma ferramenta ou da resposta). Com
-- isso a conversa mostra "lê ao fim do passo atual" × "Lida", e o Parar devolve à fila a que o bot não chegou a ler.
--
-- NULL = ainda não lida. O app que não informa leitura (versão antiga, Codex) grava a hora da absorção, como antes.
-- Só adição: o servidor antigo no ar não lê a coluna.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN lido_na_sessao_em timestamptz;

-- Os absorvidos que já existem foram lidos (era a regra até aqui).
UPDATE turnos SET lido_na_sessao_em = criado_em WHERE motivo_interrupcao = 'absorvido' AND absorvido_por IS NOT NULL;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN lido_na_sessao_em;
