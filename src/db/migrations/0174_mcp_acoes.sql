-- definido em 2026-11-12 (servidor MCP do Nod, revisão do PR #22; critério 4 da NOD-152): o que um cliente MCP mudou
-- em nome da pessoa (mandou mensagem, aprovou, criou ou moveu tarefa, rodou rotina), para a Atividade do bot dizer
-- "Pelo MCP · Grok Bot". Uma linha por ferramenta que terminou sem erro; nunca os argumentos inteiros (ADR-004): só o
-- resumo de uma linha que a ferramenta monta (o código da tarefa, a coluna, a frase do pedido cortada).
-- `agente_id` nulo = a ação não é de um bot (nod_chamar_rota numa rota fora de /agentes/:id): fica só no registro.
-- `cliente`: o nome que o cliente anunciou no initialize (ou o nome do token), copiado na hora para a linha não mudar
-- quando o token for usado por outro app depois. Só adição: o servidor de antes não lê nem grava a tabela.
SET LOCAL lock_timeout = '5s';

CREATE TABLE mcp_acoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL,
  agente_id uuid,
  ferramenta text NOT NULL,
  resumo text NOT NULL,
  cliente text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mcp_acoes_ferramenta CHECK (length(ferramenta) BETWEEN 1 AND 60),
  CONSTRAINT mcp_acoes_resumo CHECK (length(resumo) BETWEEN 1 AND 200),
  CONSTRAINT mcp_acoes_cliente CHECK (length(cliente) BETWEEN 1 AND 80)
);
SELECT nod_escopar_tabela('mcp_acoes');
ALTER TABLE mcp_acoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE mcp_acoes ADD CONSTRAINT mcp_acoes_token FOREIGN KEY (tenant_id, token_id) REFERENCES mcp_tokens (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX mcp_acoes_do_bot ON mcp_acoes (tenant_id, agente_id, criado_em DESC) WHERE agente_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê a tabela: a Atividade deixa de mostrar o que veio pelo MCP.
-- DROP TABLE IF EXISTS mcp_acoes;
