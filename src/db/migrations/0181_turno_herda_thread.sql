-- definido em 2026-11-22 (ADR-192, etapa 2, dual-write): o turno de um trabalho ligado a uma Tarefa cai na Thread primária
-- dela. Há uma dúzia de caminhos que enfileiram turno de trabalho (a fala da pessoa, a retomada da decisão, a resposta do
-- colega, a volta marcada, o fim do comando, a rede...); em vez de ensinar cada um, o banco preenche `thread_id` quando
-- o turno nasce (ou ganha `trabalho_id`) sem ele. Assim `trabalho_id`, `thread_id` e `tarefa_objetivo_id` ficam coerentes
-- em qualquer caminho, inclusive o do servidor antigo nos 10 min do deploy.
--
-- Roda como quem escreve (nod_app, com o escopo da transação): só enxerga o trabalho e a Thread da própria dona, que é a
-- dona do turno. Trabalho sem Tarefa (o de antes, o de rotina, o de colega): nada muda.
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION nod_turno_herda_thread() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  SELECT th.id INTO NEW.thread_id
  FROM trabalhos w
  JOIN threads th ON th.tenant_id = w.tenant_id AND th.tarefa_id = w.tarefa_objetivo_id AND th.tipo = 'primaria'
  WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.trabalho_id;
  RETURN NEW;
END $$;

CREATE TRIGGER nod_turno_herda_thread BEFORE INSERT OR UPDATE OF trabalho_id ON turnos
  FOR EACH ROW WHEN (NEW.trabalho_id IS NOT NULL AND NEW.thread_id IS NULL) EXECUTE FUNCTION nod_turno_herda_thread();

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TRIGGER IF EXISTS nod_turno_herda_thread ON turnos;
-- DROP FUNCTION IF EXISTS nod_turno_herda_thread();
