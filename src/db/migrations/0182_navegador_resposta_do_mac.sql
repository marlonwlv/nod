-- definido em 2026-11-20 (ADR-190, quadros M, J e K): a pergunta "Continuar com o Mac desligado" vem UMA vez por bot, e
-- a linha de navegador_preferencias não diz se ela foi respondida (as liberações de A2/A3 também criam a linha, e "Só com
-- o Mac ligado" grava o mesmo `false` do padrão). `lugar_perguntado_em` marca que o cartão já foi à conversa (vem uma
-- vez) e `lugar_respondido_em`, a resposta. `retomar_turno_id` guarda o
-- pedido que a pessoa mandou esperar ("Quando o Mac ligar", K1): quando o app do Mac volta a puxar o navegador, o turno
-- continua. Só adição: o servidor antigo no ar não lê estas colunas.
SET LOCAL lock_timeout = '5s';
ALTER TABLE navegador_preferencias ADD COLUMN lugar_perguntado_em timestamptz;
ALTER TABLE navegador_preferencias ADD COLUMN lugar_respondido_em timestamptz;
ALTER TABLE navegador_preferencias ADD COLUMN retomar_turno_id uuid;
-- ROLLBACK:
-- ALTER TABLE navegador_preferencias DROP COLUMN retomar_turno_id;
-- ALTER TABLE navegador_preferencias DROP COLUMN lugar_respondido_em;
-- ALTER TABLE navegador_preferencias DROP COLUMN lugar_perguntado_em;
