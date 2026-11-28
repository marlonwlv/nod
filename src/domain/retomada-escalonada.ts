/**
 * ADR-198 (definido em 2026-11-26): `aposLimiteNoFundo` (assentar-turno.ts) acordava cada bot exatamente na
 * hora que o provedor deu (`prazoDoLimite`/`prazoDoLimiteDaConta`, inteligencia.ts) — sem nenhum atraso entre bots. A
 * regra de escalonar as retomadas por bot (decisão do dono, 17/11) valia só de boca: nada no código a aplicava. Em
 * 26/11, 5 sessões da mesma dona voltaram de pausa por limite num intervalo de 16 s porque as janelas de 5 h delas
 * resetaram juntas.
 *
 * `atrasoRetomadaMin` é por bot (agentes.atraso_retomada_min); ausente ou null = sem atraso, igual ao comportamento de
 * antes desta ADR — por isso o guard é `!= null`, não truthy: um bot configurado com 0 (ex.: "Gilda +0") precisa se
 * comportar como configurado, não cair no mesmo caminho de quem nunca recebeu um valor.
 */
export function comAtrasoDeRetomada(renovaEm: number, atrasoRetomadaMin: number | null | undefined): number {
  return atrasoRetomadaMin != null ? renovaEm + atrasoRetomadaMin * 60_000 : renovaEm;
}
