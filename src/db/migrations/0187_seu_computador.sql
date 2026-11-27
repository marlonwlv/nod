-- definido em 2026-11-26 (ADR-197, "O bot usa o computador da pessoa"): os apps do Mac ou do PC que cada bot pode usar.
-- Uma linha por bot e app: `app_id` é como o sistema identifica o app (bundle id no Mac, caminho do .exe no Windows) e
-- `app_nome` o nome que o sistema mostra (vai ao cartão e a Ajustes › Seu Mac). `ate` nulo = "Sempre no {app}"; com
-- data = "Permitir desta vez" (vale até lá). "Tirar" apaga a linha. Da pessoa, nunca da equipe: `privado`.
-- Só adição: tabela nova; o servidor antigo não a lê.
SET LOCAL lock_timeout = '5s';

CREATE TABLE seu_computador_apps (
  agente_id uuid NOT NULL,
  plataforma text NOT NULL CONSTRAINT seu_computador_apps_plataforma CHECK (plataforma IN ('darwin', 'win32')),
  app_id text NOT NULL CONSTRAINT seu_computador_apps_app_id CHECK (char_length(app_id) BETWEEN 3 AND 400),
  app_nome text NOT NULL CONSTRAINT seu_computador_apps_app_nome CHECK (char_length(app_nome) BETWEEN 1 AND 200),
  ate timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('seu_computador_apps');
ALTER TABLE seu_computador_apps ADD PRIMARY KEY (tenant_id, agente_id, plataforma, app_id);
ALTER TABLE seu_computador_apps ADD CHECK (visibility = 'privado');
ALTER TABLE seu_computador_apps ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX seu_computador_apps_da_pessoa ON seu_computador_apps (tenant_id, owner_id, agente_id);

-- ROLLBACK:
-- -- Tabela nova, nada a referencia: apagá-la desfaz a migração (os bots perdem os apps liberados e pedem de novo).
-- DROP TABLE seu_computador_apps;
