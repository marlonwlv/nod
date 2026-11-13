-- NOD-414: exportar decisões pelo chat sempre espera confirmação.
SET LOCAL lock_timeout = '5s';
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'decisoes_exportacao';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'decisoes_exportacao';
-- ROLLBACK: recrie ambos os enums sem o valor novo, seguindo 0166_rotina_execucao.sql.
