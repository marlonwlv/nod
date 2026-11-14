-- NOD-414: exportar decisões pelo chat sempre espera confirmação.
SET LOCAL lock_timeout = '5s';
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'decisoes_exportacao';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'decisoes_exportacao';
-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DELETE FROM decisoes WHERE tipo = 'decisoes_exportacao';
-- DELETE FROM propostas WHERE kind = 'decisoes_exportacao';
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0175;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao', 'app', 'importacao_linear', 'assumir_quadro', 'rotina_execucao');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0175;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector')) WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0175;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta', 'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao', 'app', 'importacao_linear', 'assumir_quadro', 'rotina_execucao');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0175;
