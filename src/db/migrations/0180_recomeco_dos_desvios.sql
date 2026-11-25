-- definido em 2026-11-22 (lote B das Jornadas da IA, "Mandar uma mensagem"): três recuperações novas da conversa nascem
-- com o motivo de recomeço delas, para a tabela de desvios (src/domain/desvios-da-conversa.ts) contar quantas vezes a
-- mesma mensagem já se repetiu por cada uma e a conversa mostrar a linha certa:
-- - 'instavel': o serviço da IA ficou instável (sobrecarga, 5xx, rede) e a conversa tenta de novo sozinha (desvio 5);
-- - 'erro_repetido': um erro que o nod não conhece; a conversa tenta UMA vez antes do cartão (desvio 10);
-- - 'nod_atualizou': o deploy ou o motor reiniciou no meio da resposta e a conversa volta sozinha uma vez (desvio 11).
--
-- Só troca o CHECK da 0158 por um com os valores novos, NOT VALID como os de antes (as linhas antigas já passaram por um
-- subconjunto deste; validar varreria `turnos` inteira sob a trava). lock_timeout de 5 s: sem a trava, o deploy para limpo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_motivo_recomeco_valido;
ALTER TABLE turnos
  ADD CONSTRAINT turnos_motivo_recomeco_valido
    CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada', 'autocompactacao', 'instavel', 'erro_repetido', 'nod_atualizou')) NOT VALID;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- A linha que já usa um valor novo faria o CHECK de antes falhar no próximo UPDATE dela: volta ao nulo (é só a marca).
-- UPDATE turnos SET motivo_recomeco = NULL WHERE motivo_recomeco IN ('instavel', 'erro_repetido', 'nod_atualizou');
-- ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_motivo_recomeco_valido;
-- ALTER TABLE turnos
--   ADD CONSTRAINT turnos_motivo_recomeco_valido
--     CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada', 'autocompactacao')) NOT VALID;
