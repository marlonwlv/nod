-- definido em 2026-11-12 (frente "Comportamento igual ao Grok"): a persistência que os PRs #732 (ADR-169 e ADR-172) e
-- #735 (ADR-177) deixaram só no domínio puro. Quatro peças, todas escopadas por pessoa com nod_escopar_tabela:
--
-- vms_do_nod: o pedido da VM do Nod (opção 3 da decisão 1), UMA por pessoa (o Grok Bot também tem uma box por usuário).
--   Guarda o plano, o nome estável `nod-box-…` (nomeDaVmDoNod), o requestId idempotente, o driver (seco = só previsão) e
--   o estado do ciclo. O aceite da cobrança fica com hora; sem ele o domínio já recusa o pedido.
-- vez_na_sala: a vez por membro na sala (vez-na-sala.ts): quem fala agora e a fila. Uma linha por pedido de vez; o
--   estado diz se está na vez, na fila ou como terminou (entregou, passou, vencida, saiu). Quem é membro da sala lê,
--   como em `salas` (a mesma perna de leitura).
-- itens_memoria_time e memorias_time: a memória de TIME revisada por gente (memoria-de-time.ts). O bot propõe, uma
--   pessoa do time aprova ou recusa; a memória aprovada nasce 'equipe' (todo o tenant lê). A consolidação ("sonho")
--   propõe fusões que voltam à mesma fila, com `substitui`.
-- passkeys e desafios_gasto: a passkey da pessoa (chave pública JWK, contador) e o desafio de uso único de cada gasto
--   (compra, valor, moeda, nonce). O desafio usado ganha `usado_em` e não serve de novo.
-- Só adição: o servidor antigo no ar não lê estas tabelas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE vms_do_nod (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plano_id text NOT NULL CHECK (plano_id IN ('essencial', 'pro')),
  nome text NOT NULL CHECK (nome ~ '^nod-box-[a-f0-9]{12,20}$'),
  projeto text NOT NULL CHECK (projeto ~ '^[a-z][-a-z0-9]{4,28}[a-z0-9]$'),
  zona text NOT NULL CHECK (zona ~ '^[a-z]+-[a-z]+[0-9]+-[a-z]$'),
  request_id text NOT NULL CHECK (char_length(request_id) <= 64),
  driver text NOT NULL DEFAULT 'seco' CHECK (driver IN ('seco', 'gcp')),
  estado text NOT NULL DEFAULT 'pedida' CHECK (estado IN ('pedida', 'prevista', 'criando', 'pronta', 'dormindo', 'falhou', 'encerrada')),
  custo_mensal_centavos integer NOT NULL CHECK (custo_mensal_centavos > 0),
  aceitou_cobranca_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('vms_do_nod');
ALTER TABLE vms_do_nod ADD PRIMARY KEY (tenant_id, id);
-- Uma VM viva por pessoa: a encerrada não conta, e a pessoa pode pedir outra depois.
CREATE UNIQUE INDEX vms_do_nod_uma_por_pessoa ON vms_do_nod (tenant_id, owner_id) WHERE estado <> 'encerrada';

CREATE TABLE vez_na_sala (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sala_id uuid NOT NULL,
  pedido_id uuid NOT NULL,
  membro_id uuid NOT NULL,
  membro_tipo text NOT NULL CHECK (membro_tipo IN ('bot', 'pessoa')),
  estado text NOT NULL CHECK (estado IN ('na_vez', 'na_fila', 'entregou', 'passou', 'vencida', 'saiu')),
  pedido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  desde timestamptz,
  fechado_em timestamptz
);
SELECT nod_escopar_tabela('vez_na_sala', $p$EXISTS (
  SELECT 1 FROM sala_membros m
  WHERE m.tenant_id = vez_na_sala.tenant_id AND m.sala_id = vez_na_sala.sala_id
    AND m.pessoa_leitora_id = current_setting('nod.pessoa_id')::uuid AND m.removido_em IS NULL)$p$);
ALTER TABLE vez_na_sala ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE vez_na_sala ADD FOREIGN KEY (tenant_id, sala_id) REFERENCES salas (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX vez_na_sala_pedido ON vez_na_sala (tenant_id, pedido_id);
-- Uma vez de cada vez (a regra 1 de vez-na-sala.ts), garantida pelo banco; e o membro entra na fila uma vez só.
CREATE UNIQUE INDEX vez_na_sala_uma_vez ON vez_na_sala (tenant_id, sala_id) WHERE estado = 'na_vez';
CREATE UNIQUE INDEX vez_na_sala_membro_aberto ON vez_na_sala (tenant_id, sala_id, membro_id) WHERE estado IN ('na_vez', 'na_fila');

CREATE TABLE memorias_time (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 2000),
  -- O item da fila que a aprovou (a trilha de quem propôs e quem revisou fica lá).
  item_id uuid,
  substituida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('memorias_time');
ALTER TABLE memorias_time ADD PRIMARY KEY (tenant_id, id);
CREATE INDEX memorias_time_vivas ON memorias_time (tenant_id) WHERE substituida_em IS NULL;

CREATE TABLE itens_memoria_time (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('memoria', 'skill', 'memoria_de_pasta')),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 2000),
  proposto_por_agente_id uuid NOT NULL,
  origem text CHECK (char_length(origem) <= 200),
  estado text NOT NULL CHECK (estado IN ('proposta', 'aprovada', 'recusada', 'duplicada')),
  revisado_por uuid,
  revisado_em timestamptz,
  substitui uuid[] NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Quem revisa é uma pessoa e a revisão tem hora; a proposta aberta não tem nenhum dos dois.
  CONSTRAINT itens_memoria_time_revisao CHECK ((estado IN ('aprovada', 'recusada')) = (revisado_por IS NOT NULL AND revisado_em IS NOT NULL))
);
SELECT nod_escopar_tabela('itens_memoria_time');
ALTER TABLE itens_memoria_time ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE itens_memoria_time ADD FOREIGN KEY (tenant_id, proposto_por_agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX itens_memoria_time_fila ON itens_memoria_time (tenant_id, estado, criado_em);

CREATE TABLE passkeys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- base64url de 16 a 1366 caracteres (o Postgres não repete mais de 255 numa regex: o tamanho vai à parte).
  credencial_id text NOT NULL CHECK (credencial_id ~ '^[A-Za-z0-9_-]+$' AND char_length(credencial_id) BETWEEN 16 AND 1366),
  -- A chave pública ES256 em JWK (verificar-assercao.ts usa a guardada, nunca a que vem com a asserção).
  chave_publica jsonb NOT NULL CHECK (chave_publica ->> 'kty' = 'EC' AND chave_publica ->> 'crv' = 'P-256'),
  rp_id text NOT NULL CHECK (char_length(rp_id) BETWEEN 3 AND 253),
  contador bigint NOT NULL DEFAULT 0 CHECK (contador >= 0),
  nome text CHECK (char_length(nome) <= 80),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  usada_em timestamptz,
  revogada_em timestamptz
);
SELECT nod_escopar_tabela('passkeys');
ALTER TABLE passkeys ADD PRIMARY KEY (tenant_id, id);
CREATE UNIQUE INDEX passkeys_credencial ON passkeys (tenant_id, credencial_id);

CREATE TABLE desafios_gasto (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  compra_id text NOT NULL CHECK (char_length(compra_id) BETWEEN 1 AND 128),
  centavos integer NOT NULL CHECK (centavos > 0),
  moeda text NOT NULL CHECK (moeda ~ '^[A-Z]{3}$'),
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{16,128}$'),
  -- base64url de textoDoDesafio(...): o clientDataJSON.challenge tem de bater exatamente.
  desafio text NOT NULL CHECK (char_length(desafio) <= 512),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  passkey_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('desafios_gasto');
ALTER TABLE desafios_gasto ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE desafios_gasto ADD FOREIGN KEY (tenant_id, passkey_id) REFERENCES passkeys (tenant_id, id);
CREATE UNIQUE INDEX desafios_gasto_nonce ON desafios_gasto (tenant_id, nonce);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TABLE desafios_gasto;
-- DROP TABLE passkeys;
-- DROP TABLE itens_memoria_time;
-- DROP TABLE memorias_time;
-- DROP TABLE vez_na_sala;
-- DROP TABLE vms_do_nod;
