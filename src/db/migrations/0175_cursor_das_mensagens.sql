-- definido em 2026-11-12 (sincronização por cursor): cada mensagem ganha `seq` (ordem de criação) e `updated_seq` (sobe
-- quando a linha muda, quando uma reação entra ou sai e quando a decisão do cartão dela é decidida); a conversa ganha
-- `geracao`, que sobe quando mensagens dela são apagadas (a conversa zerada). O cliente pede
-- `GET /conversas/:id/mensagens?depois_de=<updated_seq>&geracao=<g>` e recebe só o que mudou.
--
-- Os dois números saem de UMA sequência global (como o `seq` de turno_passos, 0170): monotônicos em toda conversa, com
-- buracos. A ordem de commit dentro da conversa é garantida por uma trava consultiva por conversa tomada no gatilho
-- (pg_advisory_xact_lock): quem grava na mesma conversa espera o commit do anterior antes de tirar o número, então quem
-- leu até N nunca vê depois um N-1 da mesma conversa aparecer. A trava não passa pela RLS (a conversa da sala, gravada
-- por outra pessoa, também entra) e só serializa escrita na mesma conversa — que já é serial na prática.
--
-- Só adição: o servidor antigo no ar não lê as colunas; o que ele grava passa pelo gatilho e ganha os números.
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE mensagens_cursor_seq AS bigint;
GRANT USAGE ON SEQUENCE mensagens_cursor_seq TO nod_app;

ALTER TABLE mensagens ADD COLUMN seq bigint, ADD COLUMN updated_seq bigint;
ALTER TABLE conversas ADD COLUMN geracao integer NOT NULL DEFAULT 1;

-- Backfill: a ordem de criação de sempre (criado_em, id); antes do gatilho, para o UPDATE não tirar número novo.
WITH ordem AS (SELECT tenant_id, id, row_number() OVER (ORDER BY criado_em, id) AS n FROM mensagens)
UPDATE mensagens m SET seq = o.n, updated_seq = o.n FROM ordem o WHERE m.tenant_id = o.tenant_id AND m.id = o.id;
SELECT setval('mensagens_cursor_seq', COALESCE((SELECT max(seq) FROM mensagens), 0) + 1, false);

CREATE INDEX mensagens_por_cursor ON mensagens (tenant_id, conversa_id, updated_seq);

CREATE FUNCTION nod_mensagem_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nod_cursor:' || NEW.conversa_id::text, 0));
  IF TG_OP = 'INSERT' THEN
    NEW.seq := nextval('mensagens_cursor_seq');
    NEW.updated_seq := NEW.seq;
  ELSE
    NEW.seq := OLD.seq;
    NEW.updated_seq := nextval('mensagens_cursor_seq');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nod_mensagem_cursor BEFORE INSERT OR UPDATE ON mensagens
  FOR EACH ROW EXECUTE FUNCTION nod_mensagem_cursor();

-- A reação que entra ou sai toca a mensagem (o gatilho acima dá o número). Na cascata da mensagem apagada, a linha já
-- saiu e o UPDATE não acha nada.
CREATE FUNCTION nod_reacao_toca_mensagem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r reacoes;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  UPDATE mensagens SET updated_seq = updated_seq WHERE tenant_id = r.tenant_id AND id = r.mensagem_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER nod_reacao_toca_mensagem AFTER INSERT OR DELETE ON reacoes
  FOR EACH ROW EXECUTE FUNCTION nod_reacao_toca_mensagem();

-- A decisão decidida (ou vencida) toca os cartões dela na conversa (payload.decisaoId). Sob a RLS de quem decide: a
-- decisora que não é a dona não toca a linha (afeta zero), e o cartão dela muda pelo frame decisao.decidida, como antes.
CREATE FUNCTION nod_decisao_toca_cartao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE mensagens SET updated_seq = updated_seq
  WHERE tenant_id = NEW.tenant_id AND conversa_id = NEW.conversa_id AND payload->>'decisaoId' = NEW.id::text;
  RETURN NULL;
END;
$$;
CREATE TRIGGER nod_decisao_toca_cartao AFTER UPDATE OF estado ON decisoes
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION nod_decisao_toca_cartao();

-- Mensagem apagada: a conversa muda de geração (o cursor do cliente não enxerga o que sumiu).
CREATE FUNCTION nod_conversa_nova_geracao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversas c SET geracao = c.geracao + 1
  WHERE (c.tenant_id, c.id) IN (SELECT DISTINCT a.tenant_id, a.conversa_id FROM apagadas a);
  RETURN NULL;
END;
$$;
CREATE TRIGGER nod_conversa_nova_geracao AFTER DELETE ON mensagens
  REFERENCING OLD TABLE AS apagadas FOR EACH STATEMENT EXECUTE FUNCTION nod_conversa_nova_geracao();

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TRIGGER IF EXISTS nod_conversa_nova_geracao ON mensagens;
-- DROP FUNCTION IF EXISTS nod_conversa_nova_geracao();
-- DROP TRIGGER IF EXISTS nod_decisao_toca_cartao ON decisoes;
-- DROP FUNCTION IF EXISTS nod_decisao_toca_cartao();
-- DROP TRIGGER IF EXISTS nod_reacao_toca_mensagem ON reacoes;
-- DROP FUNCTION IF EXISTS nod_reacao_toca_mensagem();
-- DROP TRIGGER IF EXISTS nod_mensagem_cursor ON mensagens;
-- DROP FUNCTION IF EXISTS nod_mensagem_cursor();
-- DROP INDEX IF EXISTS mensagens_por_cursor;
-- ALTER TABLE conversas DROP COLUMN geracao;
-- ALTER TABLE mensagens DROP COLUMN updated_seq;
-- ALTER TABLE mensagens DROP COLUMN seq;
-- DROP SEQUENCE IF EXISTS mensagens_cursor_seq;
