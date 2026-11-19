-- definido em 2026-11-19 (QA-105): o padrão mudado com o app desligado só fica guardado, não chega aos bots. O nível
-- que os bots que seguem o padrão têm de fato ("em vigor") passa a ficar ao lado do padrão: é contra ele, e não contra
-- o padrão só guardado, que a próxima mudança reconhece quem segue o padrão. Nulo = igual a `nivel` (linhas antigas).
-- Só adição: o servidor antigo no ar não lê esta coluna.
SET LOCAL lock_timeout = '5s';
ALTER TABLE acessos_padrao ADD COLUMN nivel_em_vigor text CHECK (nivel_em_vigor IN ('nenhum', 'leitura', 'escrita'));
-- ROLLBACK:
-- ALTER TABLE acessos_padrao DROP COLUMN nivel_em_vigor;
