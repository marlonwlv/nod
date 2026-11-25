-- definido em 2026-11-22 (ADR-192, etapa 1 da especificação "Tarefa com Thread"): a Tarefa vira objetivo persistente, com
-- identidade própria, separada do runtime (`trabalhos`) e do Card do quadro (`quadro_tarefas`).
--
-- tarefas: o objetivo e o estado de negócio (nao_iniciada, em_andamento, entregue, resolvida, arquivada). Os carimbos da
--   linha são a projeção ATUAL — a última entrega, a resolução vigente, o arquivo —, e a história mora em tarefa_eventos
--   (reabrir limpa a resolução da linha sem apagar o evento). `versao` cresce a cada mutação: é o ETag de Resolver.
--   `chave_idempotencia` (por dona) faz o segundo pedido de criação com a mesma chave devolver a mesma Tarefa;
--   `origem_chave` é a chave do backfill da etapa 4 ("trabalho:<id>", "card:<id>"), única por tenant.
-- tarefa_eventos: a trilha tipada (criada, iniciada, entregue, resolvida, reaberta, arquivada, desarquivada), com autor e
--   turno. Sem prosa: `dados` leva ids e marcas curtas (teto de 2000 bytes); texto continua nas tabelas apagáveis (ADR-004).
--   `turno_id` sem FK de propósito: a limpeza dos testes de concorrência apaga turnos, e um evento não deve segurar isso
--   (a FK nova para turnos quebrou essa limpeza em 2026-09-28, 0036).
-- threads: a conversa/contexto durável da Tarefa. MVP 1:1 — no máximo uma 'primaria' por Tarefa (índice parcial) —, mas
--   sem UNIQUE(tarefa_id): 1:N futuro sem migração destrutiva. O trigger adiado garante que toda Tarefa termina a
--   transação com a Thread primária (invariante 1 do ADR-192: as duas nascem juntas ou nenhuma).
-- Vínculos aditivos, todos nulos: turnos.thread_id, trabalhos.tarefa_objetivo_id e quadro_tarefas.tarefa_objetivo_id.
--   Não reaproveita trabalhos.tarefa_id: ali é o Card do quadro (0164).
--
-- Só adição: o servidor antigo no ar não lê estas tabelas nem as colunas novas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE tarefas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  titulo text NOT NULL,
  estado text NOT NULL DEFAULT 'nao_iniciada',
  -- O estado de antes de arquivar: desarquivar volta a ele.
  estado_antes_de_arquivar text,
  entregue_em timestamptz,
  entregue_por_tipo text,
  entregue_por_id uuid,
  resolvida_em timestamptz,
  resolvida_por uuid,
  arquivada_em timestamptz,
  versao integer NOT NULL DEFAULT 1,
  chave_idempotencia text,
  origem_chave text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tarefa_titulo CHECK (char_length(titulo) BETWEEN 1 AND 200),
  CONSTRAINT tarefa_estado CHECK (estado IN ('nao_iniciada', 'em_andamento', 'entregue', 'resolvida', 'arquivada')),
  CONSTRAINT tarefa_estado_antes_de_arquivar CHECK (
    (estado = 'arquivada') = (estado_antes_de_arquivar IS NOT NULL)
    AND (estado_antes_de_arquivar IS NULL OR estado_antes_de_arquivar IN ('nao_iniciada', 'em_andamento', 'entregue', 'resolvida'))),
  CONSTRAINT tarefa_arquivada_em CHECK ((estado = 'arquivada') = (arquivada_em IS NOT NULL)),
  CONSTRAINT tarefa_entregue_por CHECK (
    (entregue_em IS NULL) = (entregue_por_tipo IS NULL)
    AND (entregue_por_tipo IS NULL OR entregue_por_tipo IN ('pessoa', 'agente', 'sistema'))
    AND (entregue_por_id IS NULL OR entregue_em IS NOT NULL)),
  CONSTRAINT tarefa_entregue_tem_entrega CHECK (estado <> 'entregue' OR entregue_em IS NOT NULL),
  -- A resolução é sempre de uma pessoa, com hora; a linha resolvida (ou arquivada depois de resolvida) a carrega.
  CONSTRAINT tarefa_resolvida_por CHECK ((resolvida_em IS NULL) = (resolvida_por IS NULL)),
  CONSTRAINT tarefa_resolvida_tem_resolucao CHECK (estado <> 'resolvida' OR resolvida_em IS NOT NULL),
  CONSTRAINT tarefa_resolucao_so_resolvida CHECK (resolvida_em IS NULL OR estado = 'resolvida' OR (estado = 'arquivada' AND estado_antes_de_arquivar = 'resolvida')),
  CONSTRAINT tarefa_versao CHECK (versao >= 1),
  CONSTRAINT tarefa_chave_idempotencia CHECK (chave_idempotencia IS NULL OR char_length(chave_idempotencia) BETWEEN 1 AND 100),
  CONSTRAINT tarefa_origem_chave CHECK (origem_chave IS NULL OR origem_chave ~ '^(trabalho|card):[0-9a-f-]{36}$')
);
SELECT nod_escopar_tabela('tarefas');
ALTER TABLE tarefas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE tarefas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
-- A lista Tarefas: as da dona (por bot ou todas), mais recentes primeiro.
CREATE INDEX tarefas_da_dona ON tarefas (tenant_id, owner_id, agente_id, atualizado_em DESC);
CREATE UNIQUE INDEX tarefas_chave_idempotencia ON tarefas (tenant_id, owner_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
CREATE UNIQUE INDEX tarefas_origem_chave ON tarefas (tenant_id, origem_chave) WHERE origem_chave IS NOT NULL;

CREATE TABLE tarefa_eventos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL,
  tipo text NOT NULL,
  autor_tipo text NOT NULL,
  autor_id uuid NOT NULL,
  turno_id uuid,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tarefa_evento_tipo CHECK (tipo IN ('criada', 'iniciada', 'entregue', 'resolvida', 'reaberta', 'arquivada', 'desarquivada', 'thread_criada')),
  CONSTRAINT tarefa_evento_autor_tipo CHECK (autor_tipo IN ('pessoa', 'agente', 'sistema')),
  CONSTRAINT tarefa_evento_dados CHECK (jsonb_typeof(dados) = 'object' AND octet_length(dados::text) <= 2000)
);
SELECT nod_escopar_tabela('tarefa_eventos');
ALTER TABLE tarefa_eventos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE tarefa_eventos ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES tarefas (tenant_id, id);
CREATE INDEX tarefa_eventos_da_tarefa ON tarefa_eventos (tenant_id, tarefa_id, criado_em);

CREATE TABLE threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'primaria',
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  fechada_em timestamptz,
  CONSTRAINT thread_tipo CHECK (tipo IN ('primaria', 'secundaria'))
);
SELECT nod_escopar_tabela('threads');
ALTER TABLE threads ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE threads ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES tarefas (tenant_id, id);
ALTER TABLE threads ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
CREATE INDEX threads_da_tarefa ON threads (tenant_id, tarefa_id, criado_em);
-- MVP: uma Thread primária por Tarefa. NÃO há UNIQUE(tarefa_id) geral (1:N futuro).
CREATE UNIQUE INDEX threads_uma_primaria ON threads (tenant_id, tarefa_id) WHERE tipo = 'primaria';

-- Invariante 1 (ADR-192): a Tarefa termina a transação com a Thread primária. Adiado até o COMMIT: o caso de uso insere a
-- Tarefa e depois a Thread na mesma transação. Roda como quem escreve (RLS da dona), que enxerga a própria Thread.
CREATE FUNCTION nod_tarefa_tem_thread_primaria() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM threads t WHERE t.tenant_id = NEW.tenant_id AND t.tarefa_id = NEW.id AND t.tipo = 'primaria') THEN
    RAISE EXCEPTION 'tarefa % sem thread primaria', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER nod_tarefa_tem_thread_primaria AFTER INSERT ON tarefas
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nod_tarefa_tem_thread_primaria();

ALTER TABLE turnos ADD COLUMN thread_id uuid;
ALTER TABLE turnos ADD CONSTRAINT turnos_thread_fk FOREIGN KEY (tenant_id, thread_id) REFERENCES threads (tenant_id, id);
-- Os turnos de uma Thread (atividade derivada e o detalhe da Tarefa).
CREATE INDEX turnos_por_thread ON turnos (tenant_id, thread_id, criado_em) WHERE thread_id IS NOT NULL;

ALTER TABLE trabalhos ADD COLUMN tarefa_objetivo_id uuid;
ALTER TABLE trabalhos ADD CONSTRAINT trabalhos_tarefa_objetivo_fk FOREIGN KEY (tenant_id, tarefa_objetivo_id) REFERENCES tarefas (tenant_id, id);
CREATE INDEX trabalhos_por_tarefa_objetivo ON trabalhos (tenant_id, tarefa_objetivo_id) WHERE tarefa_objetivo_id IS NOT NULL;

-- A ponte com o Card (opcional): arquivar a Tarefa não mexe no vínculo; a exclusão física, se um dia existir, solta.
ALTER TABLE quadro_tarefas ADD COLUMN tarefa_objetivo_id uuid;
ALTER TABLE quadro_tarefas ADD CONSTRAINT quadro_tarefas_tarefa_objetivo_fk FOREIGN KEY (tenant_id, tarefa_objetivo_id)
  REFERENCES tarefas (tenant_id, id) ON DELETE SET NULL (tarefa_objetivo_id);
CREATE INDEX quadro_tarefas_por_tarefa_objetivo ON quadro_tarefas (tenant_id, tarefa_objetivo_id) WHERE tarefa_objetivo_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS quadro_tarefas_por_tarefa_objetivo;
-- ALTER TABLE quadro_tarefas DROP CONSTRAINT IF EXISTS quadro_tarefas_tarefa_objetivo_fk;
-- ALTER TABLE quadro_tarefas DROP COLUMN tarefa_objetivo_id;
-- DROP INDEX IF EXISTS trabalhos_por_tarefa_objetivo;
-- ALTER TABLE trabalhos DROP CONSTRAINT IF EXISTS trabalhos_tarefa_objetivo_fk;
-- ALTER TABLE trabalhos DROP COLUMN tarefa_objetivo_id;
-- DROP INDEX IF EXISTS turnos_por_thread;
-- ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_thread_fk;
-- ALTER TABLE turnos DROP COLUMN thread_id;
-- DROP TRIGGER IF EXISTS nod_tarefa_tem_thread_primaria ON tarefas;
-- DROP FUNCTION IF EXISTS nod_tarefa_tem_thread_primaria();
-- DROP TABLE IF EXISTS threads;
-- DROP TABLE IF EXISTS tarefa_eventos;
-- DROP TABLE IF EXISTS tarefas;
