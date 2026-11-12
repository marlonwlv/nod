-- definido em 2026-11-12 (ADR-164, frente "Aprovações e revisor"; decisões 2 e 4 do Marlon no comparativo com o Grok Bot):
-- regras_revisor: as frases que a pessoa ensina ao revisor do Automático, em duas listas ("Pode fazer sem perguntar" =
--   'permitir', "Sempre me pergunte" = 'perguntar'), até 20 em cada e 1000 caracteres cada. agente_id nulo = o padrão da
--   pessoa (vale para todos os bots); com agente_id, só para aquele bot (somam-se ao padrão).
-- niveis_ferramenta: o nível por app (conector) e tipo (leitura/escrita), com a ferramenta opcional: sempre permitir,
--   sempre pedir, bloqueado ou o revisor decide (o padrão, sem linha). agente_id nulo = o padrão da pessoa.
-- tetos_modo: o teto do modo que o admin do time define para o tenant (linha 'equipe': todos leem, só quem gravou muda).
-- agentes.so_leitura: o bot só lê; a escrita é barrada sem cartão.
-- acoes_pelo_modo ganha a regra que liberou (regra_id), a regra sugerida pelo revisor (sugestao) e o gatilho
--   'regra_da_pessoa' (a escrita que só foi ao revisor porque a pessoa tem "Sempre me pergunte").
-- Só adição: o servidor antigo no ar não lê estas tabelas nem as colunas novas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE regras_revisor (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid,
  lista text NOT NULL CHECK (lista IN ('permitir', 'perguntar')),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 1000),
  origem text NOT NULL DEFAULT 'pessoa' CHECK (origem IN ('pessoa', 'sugestao')),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('regras_revisor');
ALTER TABLE regras_revisor ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE regras_revisor ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX regras_revisor_da_dona ON regras_revisor (tenant_id, owner_id, agente_id, lista);

CREATE TABLE niveis_ferramenta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid,
  conector_slug text NOT NULL CHECK (conector_slug ~ '^[a-z0-9_-]{1,64}$'),
  -- '' = o app inteiro naquele tipo; senão o nome da capacidade (a parte depois de slug__).
  ferramenta text NOT NULL DEFAULT '' CHECK (char_length(ferramenta) <= 128),
  tipo text NOT NULL CHECK (tipo IN ('leitura', 'escrita')),
  nivel text NOT NULL CHECK (nivel IN ('sempre_permitir', 'sempre_pedir', 'bloqueado', 'revisor')),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('niveis_ferramenta');
ALTER TABLE niveis_ferramenta ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE niveis_ferramenta ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
-- Um nível por dona, bot (ou padrão), app, ferramenta e tipo. O padrão (agente_id nulo) entra pelo coalesce.
CREATE UNIQUE INDEX niveis_ferramenta_um ON niveis_ferramenta (tenant_id, owner_id, coalesce(agente_id, '00000000-0000-0000-0000-000000000000'::uuid), conector_slug, ferramenta, tipo);

CREATE TABLE tetos_modo (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  teto text NOT NULL CHECK (teto IN ('so_leitura', 'manual', 'automatico')),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('tetos_modo');
ALTER TABLE tetos_modo ADD PRIMARY KEY (tenant_id, id);
CREATE UNIQUE INDEX tetos_modo_um_por_admin ON tetos_modo (tenant_id, owner_id);

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS so_leitura boolean NOT NULL DEFAULT false;

ALTER TABLE acoes_pelo_modo ADD COLUMN regra_id uuid;
ALTER TABLE acoes_pelo_modo ADD COLUMN sugestao text CONSTRAINT acoes_pelo_modo_sugestao CHECK (char_length(sugestao) <= 200);
ALTER TABLE acoes_pelo_modo DROP CONSTRAINT acoes_pelo_modo_gatilho;
ALTER TABLE acoes_pelo_modo ADD CONSTRAINT acoes_pelo_modo_gatilho CHECK (gatilho IN ('arriscado', 'envio_apos_fora', 'credencial', 'fora_da_pasta', 'comum', 'regra_da_pessoa'));

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- -- A linha com o gatilho novo faz o CHECK antigo falhar: o bloco volta inteiro (psql -1). Apague-as antes, se houver.
-- ALTER TABLE acoes_pelo_modo DROP CONSTRAINT acoes_pelo_modo_gatilho;
-- ALTER TABLE acoes_pelo_modo ADD CONSTRAINT acoes_pelo_modo_gatilho CHECK (gatilho IN ('arriscado', 'envio_apos_fora', 'credencial', 'fora_da_pasta', 'comum'));
-- ALTER TABLE acoes_pelo_modo DROP COLUMN sugestao;
-- ALTER TABLE acoes_pelo_modo DROP COLUMN regra_id;
-- ALTER TABLE agentes DROP COLUMN so_leitura;
-- DROP TABLE tetos_modo;
-- DROP TABLE niveis_ferramenta;
-- DROP TABLE regras_revisor;
