/**
 * Teto de workers do vitest (NOD-198), com um redutor por ambiente.
 *
 * O teto fixo (8, nunca acima de núcleos − 1) pressupõe UMA suíte por máquina. Numa máquina que roda vários
 * turnos de bot ao mesmo tempo, cada `vitest run` abria núcleos − 1 workers sem saber dos outros.
 * medido em 2026-11-25 (máquina de 8 núcleos, 5 turnos ativos): duas suítes simultâneas pediam 14 workers,
 * a fila de CPU ficava em 20–30 processos, o lease dos turnos deixava de renovar e os turnos interrompidos
 * recomeçavam rodando a suíte de novo.
 *
 * `TESTE_NOD_WORKERS` só ABAIXA o teto; nunca sobe acima do que a máquina aguenta. O nome não começa com
 * `NOD_` de propósito: o ambiente do executor (src/domain/ambiente-executor.ts) remove `NOD_*` do filho,
 * e esta variável precisa chegar ao `vitest` que o bot roda.
 */
export const VARIAVEL_TETO_DE_WORKERS = "TESTE_NOD_WORKERS";

const TETO_FIXO = 8;

export function tetoDeWorkers(nucleos: number, pedido: string | undefined): number {
  const daMaquina = Math.min(TETO_FIXO, Math.max(1, nucleos - 1));
  if (pedido === undefined || !/^\d+$/.test(pedido.trim())) return daMaquina;
  const n = Number.parseInt(pedido.trim(), 10);
  if (n < 1) return daMaquina;
  return Math.min(daMaquina, n);
}
