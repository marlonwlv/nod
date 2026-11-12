-- definido em 2026-11-05 (ADA-228, emenda da ADR-150): o Canvas fiel ao protótipo v4 da ADA-13. Dois campos opcionais:
-- a rodada do comentário (a pessoa junta N pinos em rascunho e envia de uma vez: "Rodada 1 enviada", J5-1..3) e o resumo
-- da versão (o que mudou, numa linha, no histórico do ▾ da versão, J5-6). A tela em produção (`pendente`, J7-4) mora
-- dentro da estrutura (jsonb), sem coluna. Só adição: o servidor antigo no ar não lê nem escreve estas colunas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE canvas_comentarios ADD COLUMN rodada int CHECK (rodada IS NULL OR rodada BETWEEN 1 AND 100000);
ALTER TABLE canvas_versoes ADD COLUMN resumo text CHECK (resumo IS NULL OR length(resumo) BETWEEN 1 AND 600);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE canvas_versoes DROP COLUMN IF EXISTS resumo;
-- ALTER TABLE canvas_comentarios DROP COLUMN IF EXISTS rodada;
