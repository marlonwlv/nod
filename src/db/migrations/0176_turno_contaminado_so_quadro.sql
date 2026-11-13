-- definido em 2026-11-13 (quadro: o 2º gerir_quadro no mesmo turno da pessoa): o turno que só leu o próprio quadro da
-- pessoa (as tarefas que o Linear ou um turno de fora escreveram, ADR-062) fica marcado à parte. A marca vale só
-- enquanto a ÚNICA contaminação do turno for essa: qualquer outra (página, e-mail, quadro de outra pessoa) a desliga.
-- Com ela, o gerir_quadro deixa o bot, na conversa com a pessoa, seguir MOVENDO tarefas do quadro dela (só coluna e
-- prioridade, sem escrever texto, sem atribuir, sem cancelar nem excluir), como a pessoa pediu; o resto continua no
-- limite normal. Só aditiva: o servidor de antes não lê a coluna, e o padrão false é o comportamento de sempre.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS contaminado_so_quadro boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê a coluna: o 2º gerir_quadro depois de ler o quadro volta ao limite normal.
-- ALTER TABLE turnos DROP COLUMN IF EXISTS contaminado_so_quadro;
