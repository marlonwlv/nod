-- definido em 2026-11-12 (servidor MCP do Nod): o token que um cliente MCP de fora (Claude Desktop, Cursor, o assistente
-- de mensagens da pessoa) usa para pilotar o Nod em nome dela pelo endpoint /api/mcp. Mesmo desenho da chave de máquina
-- (0007, ADR-031): o servidor guarda SÓ o SHA-256 do token inteiro; o escopo alegado viaja dentro do token para a busca
-- acontecer numa tx escopada. Tabela separada de `maquina_tokens` de propósito: aquela autoriza o motor (turnos,
-- computador), esta autoriza as rotas de pessoa, como a sessão da tela — revogar uma não derruba a outra.
-- A dona da linha é a pessoa que gerou; sem perna extra (ninguém além dela lista ou revoga).
-- `prefixo`: os 8 primeiros caracteres da metade aleatória, só para a lista dizer "…a1b2c3d4".
-- `cliente`: o nome que o cliente MCP anunciou no `initialize` (clientInfo.name), gravado no último uso, para a tela
-- dizer de onde veio. Só adição: o servidor de antes não lê nem grava a tabela.
SET LOCAL lock_timeout = '5s';

CREATE TABLE mcp_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  prefixo text NOT NULL,
  hash bytea NOT NULL,
  cliente text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultimo_uso_em timestamptz,
  revogado_em timestamptz,
  CONSTRAINT mcp_tokens_hash_tamanho CHECK (octet_length(hash) = 32),
  CONSTRAINT mcp_tokens_prefixo_curto CHECK (length(prefixo) = 8),
  CONSTRAINT mcp_tokens_nome CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  CONSTRAINT mcp_tokens_cliente CHECK (cliente IS NULL OR length(cliente) BETWEEN 1 AND 80)
);
SELECT nod_escopar_tabela('mcp_tokens');
ALTER TABLE mcp_tokens ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE mcp_tokens ADD CONSTRAINT mcp_tokens_hash_unico UNIQUE (tenant_id, hash);
CREATE INDEX mcp_tokens_da_pessoa ON mcp_tokens (tenant_id, owner_id, criado_em DESC);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê a tabela: os tokens gerados deixam de valer.
-- DROP TABLE IF EXISTS mcp_tokens;
