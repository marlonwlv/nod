/**
 * Atualização com o Mac ocioso (ADR-173, definido em 2026-11-12). O app já baixa a
 * versão nova sozinho (ADR-149) e fica em "pronta" esperando o clique em Reiniciar. Aqui ele reinicia SOZINHO, mas só
 * quando reiniciar não atrapalha ninguém:
 *   - a versão está pronta;
 *   - o Mac está sem teclado e mouse há pelo menos `OCIOSO_MIN_S` (a pessoa saiu);
 *   - nada roda: nenhum turno no Mac, nenhuma tela do computador do bot aberta, nenhuma ligação;
 *   - nenhuma janela do nod está em foco;
 *   - a última tentativa foi há mais de `ESPERA_ENTRE_TENTATIVAS_MS` (se algo segurou, não insiste a cada minuto).
 * Com isso o `confirmarReinicio` não mostra caixa nenhuma (0 turnos e 0 telas = true direto).
 */
export const OCIOSO_MIN_S = 15 * 60;
export const ESPERA_ENTRE_TENTATIVAS_MS = 30 * 60_000;
/** definido em 2026-11-12: a cada minuto; `powerMonitor.getSystemIdleTime()` é uma leitura barata do IOKit. */
export const INTERVALO_OCIOSO_MS = 60_000;

export type SinaisOcioso = {
  pronta: boolean;
  ociosoSegundos: number;
  turnos: number;
  telas: number;
  emLigacao: boolean;
  janelaEmFoco: boolean;
  ultimaTentativaEm: number | null;
  agora: number;
};

export function deveAtualizarOcioso(s: SinaisOcioso): boolean {
  if (!s.pronta || s.emLigacao || s.janelaEmFoco) return false;
  if (s.turnos > 0 || s.telas > 0) return false;
  if (s.ociosoSegundos < OCIOSO_MIN_S) return false;
  return s.ultimaTentativaEm === null || s.agora - s.ultimaTentativaEm >= ESPERA_ENTRE_TENTATIVAS_MS;
}
