-- definido em 2026-11-24 (ADR-194, backoffice interno): o painel de uso do ADR-193 vira o backoffice da equipe do nod,
-- separado do futuro admin de workspace. Duas tabelas novas, só adição (o servidor antigo no ar não lê nenhuma delas).
--
-- 1) equipe_backoffice: quem da equipe interna entra no backoffice e com que papel ('dono' | 'leitura'). É global, acima
--    dos tenants (a equipe olha todos os espaços), como `contas`: exceção nomeada em tests/conformidade/gate-rls.ts.
--    nod_app só LÊ (a guarda confere a cada pedido); quem escreve é o nod_dono, à mão ou por migração. Enquanto estiver
--    vazia, NOD_ADMINS (env) diz quem é dono, para o primeiro deploy não trancar ninguém fora.
-- 2) acessos_backoffice: a auditoria de cada acesso (quem, seção, rota, alvo consultado, quando). Só metadados: nada de
--    texto, query string ou dado da pessoa consultada além dos ids. Escopada pela pessoa da equipe que acessou (RLS de
--    sempre); nod_app só insere e lê a própria, nunca muda nem apaga.
SET LOCAL lock_timeout = '5s';
CREATE TABLE equipe_backoffice (
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  papel text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, pessoa_id),
  CONSTRAINT equipe_backoffice_papel CHECK (papel IN ('dono', 'leitura')),
  FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id) ON DELETE CASCADE
);
REVOKE ALL ON equipe_backoffice FROM PUBLIC;
GRANT SELECT ON equipe_backoffice TO nod_app;

CREATE TABLE acessos_backoffice (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  secao text NOT NULL,
  rota text NOT NULL,
  alvo_tenant_id uuid,
  alvo_pessoa_id uuid,
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT acessos_backoffice_secao CHECK (secao ~ '^[a-z_]{1,40}$'),
  CONSTRAINT acessos_backoffice_rota CHECK (rota ~ '^/api/backoffice(/[A-Za-z0-9_-]+){0,6}$'),
  CONSTRAINT acessos_backoffice_alvo CHECK ((alvo_tenant_id IS NULL) = (alvo_pessoa_id IS NULL))
);
SELECT nod_escopar_tabela('acessos_backoffice');
ALTER TABLE acessos_backoffice ADD PRIMARY KEY (tenant_id, id);
CREATE INDEX acessos_backoffice_por_quando ON acessos_backoffice (tenant_id, owner_id, em DESC);
REVOKE UPDATE, DELETE ON acessos_backoffice FROM nod_app;
-- ROLLBACK:
-- DROP TABLE acessos_backoffice;
-- DROP TABLE equipe_backoffice;
