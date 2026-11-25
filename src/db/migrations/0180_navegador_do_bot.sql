-- definido em 2026-11-20 (ADR-190, "O navegador do bot"): o que o navegador do bot guarda além da memória do processo.
-- 1) navegador_preferencias: uma linha por bot. Onde ele continua com o Mac desligado (N: continua_sem_mac, a máquina
--    sempre ligada e o "Só na <máquina>") e as respostas de antemão do quadro A (A2: teto para pagar num site; A3:
--    destinos de envio liberados), lidas pelo portão (src/adapters/fundo/navegadores.ts).
-- 2) navegador_tarefas: o que a pessoa ensinou com "Ensinar uma tarefa" (T): o nome e os passos em frases (nunca o que
--    ela digitou). `navegador_tarefa_ensinada` devolve daqui.
-- 3) cofre_logins: o cofre do nod (L). A senha só entra cifrada pelo `cifrar` do servidor (formato v1:iv:tag:dados,
--    conferido pelo CHECK: texto em claro não grava). Da pessoa, nunca da equipe: as três ficam `privado`.
-- Só adição: três tabelas novas; o servidor antigo não lê nenhuma delas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE navegador_preferencias (
  agente_id uuid NOT NULL,
  continua_sem_mac boolean NOT NULL DEFAULT false,
  maquina_id uuid,
  so_na_maquina boolean NOT NULL DEFAULT false,
  liberacoes jsonb NOT NULL DEFAULT '{"pagar":[],"enviar":[]}'::jsonb
    CONSTRAINT navegador_preferencias_liberacoes CHECK (jsonb_typeof(liberacoes) = 'object' AND octet_length(liberacoes::text) <= 65536),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('navegador_preferencias');
ALTER TABLE navegador_preferencias ADD PRIMARY KEY (tenant_id, agente_id);
ALTER TABLE navegador_preferencias ADD CHECK (visibility = 'privado');
ALTER TABLE navegador_preferencias ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE navegador_preferencias ADD CONSTRAINT navegador_preferencias_maquina_id_fkey
  FOREIGN KEY (tenant_id, maquina_id) REFERENCES maquina_tokens (tenant_id, id) ON DELETE SET NULL (maquina_id);

CREATE TABLE navegador_tarefas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  nome text NOT NULL CONSTRAINT navegador_tarefas_nome CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  -- Até 200 passos (MAX_PASSOS_GRAVACAO), cada um uma frase.
  passos jsonb NOT NULL
    CONSTRAINT navegador_tarefas_passos CHECK (jsonb_typeof(passos) = 'array' AND jsonb_array_length(passos) <= 200 AND octet_length(passos::text) <= 65536),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('navegador_tarefas');
ALTER TABLE navegador_tarefas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE navegador_tarefas ADD CHECK (visibility = 'privado');
ALTER TABLE navegador_tarefas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX navegador_tarefas_do_bot ON navegador_tarefas (tenant_id, agente_id, criada_em DESC);

CREATE TABLE cofre_logins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site text NOT NULL CONSTRAINT cofre_logins_site CHECK (char_length(site) BETWEEN 1 AND 253),
  usuario text NOT NULL CONSTRAINT cofre_logins_usuario CHECK (char_length(usuario) <= 320),
  senha_cifrada text NOT NULL
    CONSTRAINT cofre_logins_senha_cifrada CHECK (char_length(senha_cifrada) <= 8192 AND senha_cifrada ~ '^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('cofre_logins');
ALTER TABLE cofre_logins ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE cofre_logins ADD CHECK (visibility = 'privado');
CREATE INDEX cofre_logins_por_site ON cofre_logins (tenant_id, owner_id, site);

-- ROLLBACK:
-- -- As três tabelas são novas e nada de antes as referencia: apagá-las desfaz a migração (perde as preferências, as
-- -- tarefas ensinadas e os logins do cofre do nod; as senhas cifradas não voltam).
-- DROP TABLE cofre_logins;
-- DROP TABLE navegador_tarefas;
-- DROP TABLE navegador_preferencias;
