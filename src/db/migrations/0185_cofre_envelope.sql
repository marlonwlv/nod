-- definido em 2026-11-24 (ADR-195 §2 e §3, "Um cofre só, cifrado por tenant"): as quatro tabelas do cofre em envelope.
-- 1) cofre_chaves_tenant: a chave de cada tenant (32 bytes) embrulhada pela chave mestra (Cloud KMS ou a local por HKDF),
--    com a versão e a referência da mestra usada. Visível ao tenant ('equipe'); só o reembrulho e a aposentadoria mudam a
--    linha, e nod_app nunca a apaga.
-- 2) cofre_itens: um segredo por versão. O valor sai cifrado pela chave do item (formato v2 de src/db/cifra-envelope.ts) e
--    a chave do item sai embrulhada pela chave do tenant; o cartão não guarda nenhuma das duas (só os dados públicos).
-- 3) cofre_concessoes: qual bot usa qual item, 'sempre' ou 'perguntar'.
-- 4) cofre_eventos: guardado, trocado, pedido, aprovado, negado, entregue, revogado, reembrulhado. Nunca o valor.
-- Só adição: quatro tabelas novas e duas funções de trigger; o servidor antigo não lê nenhuma delas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE cofre_chaves_tenant (
  versao integer NOT NULL CONSTRAINT cofre_chaves_tenant_versao CHECK (versao >= 1),
  -- O texto que o provedor da mestra devolve (base64 do KMS, ou v2:… da mestra local). Nunca a chave crua.
  chave_embrulhada text NOT NULL CONSTRAINT cofre_chaves_tenant_embrulhada CHECK (char_length(chave_embrulhada) BETWEEN 16 AND 4096),
  -- O nome da versão da chave no KMS (projects/…/cryptoKeyVersions/N) ou 'local:v1'.
  mestra_ref text NOT NULL CONSTRAINT cofre_chaves_tenant_mestra_ref CHECK (char_length(mestra_ref) BETWEEN 1 AND 512),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  reembrulhada_em timestamptz,
  aposentada_em timestamptz
);
SELECT nod_escopar_tabela('cofre_chaves_tenant');
-- A PK é o UNIQUE (tenant_id, versao): duas criações concorrentes da versão 1 viram uma (ON CONFLICT no repositório).
ALTER TABLE cofre_chaves_tenant ADD PRIMARY KEY (tenant_id, versao);
ALTER TABLE cofre_chaves_tenant ADD CONSTRAINT cofre_chaves_tenant_visibility CHECK (visibility = 'equipe');
CREATE UNIQUE INDEX cofre_chaves_tenant_uma_ativa ON cofre_chaves_tenant (tenant_id) WHERE aposentada_em IS NULL;
-- Apagar a chave do tenant deixa o cofre do tenant inteiro ilegível: nod_app nunca apaga (a purga da conta roda como
-- nod_dono pela policy nod_purga e continua apagando).
REVOKE DELETE ON cofre_chaves_tenant FROM nod_app;

-- A 0004 dá UPDATE só para a dona (quem criou a chave do tenant, por acaso a primeira pessoa a usar o cofre). O reembrulho
-- da mestra roda no escopo de qualquer pessoa do tenant, então o UPDATE precisa valer para o tenant todo. Mesma forma da
-- nod_equipe_update da 0017: PERMISSIVE, só FOR UPDATE, USING e WITH CHECK pela perna do tenant; INSERT segue da dona e
-- DELETE foi revogado acima. Registrada por NOME em POLICIES_EXTRAS (tests/conformidade/gate-rls.ts).
CREATE POLICY nod_equipe_update ON cofre_chaves_tenant AS PERMISSIVE FOR UPDATE TO nod_app
  USING (tenant_id = current_setting('nod.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid);

-- A policy FOR UPDATE concede UPDATE de QUALQUER coluna (medido em 2026-09-16 na 0003). Aqui a lista fechada vale para
-- TODOS, inclusive a dona ("só o reembrulho muda a linha", ADR-195 §3): chave_embrulhada, mestra_ref e reembrulhada_em
-- (o reembrulho) e aposentada_em, que só vai de nula a preenchida. Lista de colunas: coluna nova nasce travada.
CREATE FUNCTION nod_cofre_chave_tenant_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  livres text[] := ARRAY['chave_embrulhada', 'mestra_ref', 'reembrulhada_em', 'aposentada_em'];
BEGIN
  IF (to_jsonb(OLD) - livres) <> (to_jsonb(NEW) - livres) THEN
    RAISE EXCEPTION 'a chave do tenant só muda pelo reembrulho ou pela aposentadoria (ADR-195)' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.aposentada_em IS NOT NULL AND NEW.aposentada_em IS DISTINCT FROM OLD.aposentada_em THEN
    RAISE EXCEPTION 'chave do tenant aposentada não volta (ADR-195)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_cofre_chave_tenant_imutavel
  BEFORE UPDATE ON cofre_chaves_tenant
  FOR EACH ROW EXECUTE FUNCTION nod_cofre_chave_tenant_imutavel();

CREATE TABLE cofre_itens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tipo text NOT NULL CONSTRAINT cofre_itens_tipo CHECK (tipo IN ('chave', 'login', 'contato', 'cartao')),
  -- ORGO_API_KEY, o site, "Visa •••• 4242".
  nome text NOT NULL CONSTRAINT cofre_itens_nome CHECK (char_length(btrim(nome)) BETWEEN 1 AND 200 AND nome = btrim(nome)),
  app text CONSTRAINT cofre_itens_app CHECK (app IS NULL OR char_length(app) BETWEEN 1 AND 120),
  -- Os dados públicos (usuário, final, bandeira, aparelho): o que o bot e a tela podem ver. Pequeno de propósito.
  publico jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT cofre_itens_publico CHECK (jsonb_typeof(publico) = 'object' AND octet_length(publico::text) <= 4096),
  dono text NOT NULL CONSTRAINT cofre_itens_dono CHECK (dono IN ('pessoa', 'time')),
  -- Formato v2:<versão da chave do tenant>:<iv>:<tag>:<dados> (src/db/cifra-envelope.ts): texto em claro não grava.
  valor_cifrado text
    CONSTRAINT cofre_itens_valor_cifrado CHECK (valor_cifrado IS NULL OR (char_length(valor_cifrado) <= 65536 AND valor_cifrado ~ '^v2:[0-9]{1,9}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$')),
  chave_item_embrulhada text
    CONSTRAINT cofre_itens_chave_item CHECK (chave_item_embrulhada IS NULL OR (char_length(chave_item_embrulhada) <= 256 AND chave_item_embrulhada ~ '^v2:[0-9]{1,9}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$')),
  chave_tenant_versao integer,
  versao integer NOT NULL CONSTRAINT cofre_itens_versao CHECK (versao >= 1),
  revogado_em timestamptz,
  ultimo_uso_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- O cartão mora no aparelho da pessoa (ADR-195 §1): sem valor e sem chave. Os outros tipos têm as três, e a versão da
  -- chave do tenant na chave embrulhada é a da coluna (quem desembrulha lê a coluna, não o texto).
  CONSTRAINT cofre_itens_cifra_por_tipo CHECK (
    CASE WHEN tipo = 'cartao'
      THEN valor_cifrado IS NULL AND chave_item_embrulhada IS NULL AND chave_tenant_versao IS NULL
      ELSE valor_cifrado IS NOT NULL AND chave_item_embrulhada IS NOT NULL AND chave_tenant_versao IS NOT NULL
        AND CASE WHEN split_part(chave_item_embrulhada, ':', 2) ~ '^[0-9]{1,9}$'
              THEN split_part(chave_item_embrulhada, ':', 2)::integer = chave_tenant_versao
              ELSE false END
    END)
);
SELECT nod_escopar_tabela('cofre_itens');
ALTER TABLE cofre_itens ADD PRIMARY KEY (tenant_id, id);
-- Item do time é lido pelo tenant todo ('equipe' abre a leitura na nod_pessoa_select); o da pessoa, só por ela.
ALTER TABLE cofre_itens ADD CONSTRAINT cofre_itens_dono_visibility CHECK ((dono = 'time') = (visibility = 'equipe'));
-- A chave do tenant que embrulha o item não some enquanto houver item embrulhado por ela.
ALTER TABLE cofre_itens ADD CONSTRAINT cofre_itens_chave_tenant_fkey
  FOREIGN KEY (tenant_id, chave_tenant_versao) REFERENCES cofre_chaves_tenant (tenant_id, versao);
-- Uma versão viva por (dono, tipo, nome): da pessoa, por pessoa; do time, uma só no tenant.
CREATE UNIQUE INDEX cofre_itens_um_vivo_da_pessoa ON cofre_itens (tenant_id, owner_id, tipo, nome) WHERE revogado_em IS NULL AND dono = 'pessoa';
CREATE UNIQUE INDEX cofre_itens_um_vivo_do_time ON cofre_itens (tenant_id, tipo, nome) WHERE revogado_em IS NULL AND dono = 'time';

-- Versão nova é linha nova: a cifra, o dono e o nome de uma versão não mudam. Mudam só o uso, a revogação (de nula a
-- preenchida, uma vez) e — para a troca da chave do tenant, ADR-195 §2 — a chave do item reembrulhada com a versão nova.
CREATE FUNCTION nod_cofre_item_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  livres text[] := ARRAY['revogado_em', 'ultimo_uso_em', 'atualizado_em', 'chave_item_embrulhada', 'chave_tenant_versao'];
BEGIN
  IF (to_jsonb(OLD) - livres) <> (to_jsonb(NEW) - livres) THEN
    RAISE EXCEPTION 'versão do cofre não muda: guarde uma versão nova (ADR-195)' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.revogado_em IS NOT NULL AND NEW.revogado_em IS DISTINCT FROM OLD.revogado_em THEN
    RAISE EXCEPTION 'item revogado não volta (ADR-195)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_cofre_item_imutavel
  BEFORE UPDATE ON cofre_itens
  FOR EACH ROW EXECUTE FUNCTION nod_cofre_item_imutavel();

CREATE TABLE cofre_concessoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  -- Cartão é sempre 'perguntar' (ADR-195 §3): conferido no repositório (cofreRepo.conceder), não aqui — um CHECK não
  -- olha outra tabela, e um trigger que lesse cofre_itens rodaria sob a RLS de quem concede.
  modo text NOT NULL CONSTRAINT cofre_concessoes_modo CHECK (modo IN ('sempre', 'perguntar')),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('cofre_concessoes');
ALTER TABLE cofre_concessoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE cofre_concessoes ADD CONSTRAINT cofre_concessoes_visibility CHECK (visibility = 'privado');
ALTER TABLE cofre_concessoes ADD CONSTRAINT cofre_concessoes_uma_por_bot UNIQUE (tenant_id, item_id, agente_id);
ALTER TABLE cofre_concessoes ADD FOREIGN KEY (tenant_id, item_id) REFERENCES cofre_itens (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE cofre_concessoes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX cofre_concessoes_do_bot ON cofre_concessoes (tenant_id, agente_id);

CREATE TABLE cofre_eventos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- Nulo só no 'reembrulhado', que é da chave do tenant, não de um item.
  item_id uuid,
  agente_id uuid,
  tipo text NOT NULL CONSTRAINT cofre_eventos_tipo
    CHECK (tipo IN ('guardado', 'trocado', 'pedido', 'aprovado', 'negado', 'entregue', 'revogado', 'reembrulhado')),
  -- Versões, motivo, id do turno. Nunca o valor: pequeno de propósito.
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT cofre_eventos_detalhe CHECK (jsonb_typeof(detalhe) = 'object' AND octet_length(detalhe::text) <= 1024),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cofre_eventos_item CHECK (item_id IS NOT NULL OR tipo = 'reembrulhado')
);
SELECT nod_escopar_tabela('cofre_eventos');
ALTER TABLE cofre_eventos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE cofre_eventos ADD FOREIGN KEY (tenant_id, item_id) REFERENCES cofre_itens (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE cofre_eventos ADD CONSTRAINT cofre_eventos_agente_id_fkey
  FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE SET NULL (agente_id);
CREATE INDEX cofre_eventos_do_item ON cofre_eventos (tenant_id, item_id, criado_em DESC);
-- Só acrescenta: nod_app não reescreve nem apaga a história (o CASCADE do item roda como dona da FK).
REVOKE UPDATE, DELETE ON cofre_eventos FROM nod_app;

-- ROLLBACK:
-- -- As quatro tabelas são novas e nada de antes as referencia: apagá-las desfaz a migração (perde os itens do cofre em
-- -- envelope e as chaves de tenant embrulhadas; as cifras não voltam). As funções de trigger saem depois das tabelas.
-- DROP TABLE cofre_eventos;
-- DROP TABLE cofre_concessoes;
-- DROP TABLE cofre_itens;
-- DROP TABLE cofre_chaves_tenant;
-- DROP FUNCTION nod_cofre_item_imutavel();
-- DROP FUNCTION nod_cofre_chave_tenant_imutavel();
