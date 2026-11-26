/**
 * Os ícones do estado de uma tarefa, iguais em todo lugar que mostra tarefas: a aba presa ao campo (P1), as abas de tarefa,
 * a tela Tarefas, o cartão vivo na conversa e a lista aberta da aba (ADR-187 §5). Definido em 2026-11-18 (lote B, passo 6):
 * saíram de pilula-do-bot.ts para o cartão vivo (progresso-na-fala.ts) usar os mesmos sem importar a pílula de volta.
 *
 * Valores do Paper ("Aba das tarefas", P1, e o cartão vivo, 1c/1d/P1): o anel de quem roda (trilho e arco de 1,6), o ponto
 * azul de 8 de quem precisa da pessoa; no cartão, o ✓ branco num disco de 14, o anel tracejado de quem espera, o quadrado
 * de 8 (raio 2) da parada e o "!" num disco da que não terminou. As cores vêm do CSS (currentColor e as classes).
 */

export const ANEL_RODANDO = '<svg class="pf-aba-ic pf-anel" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle class="pf-anel-trilho" cx="7" cy="7" r="5.5"/><path class="pf-anel-arco" d="M7 1.5 A5.5 5.5 0 0 1 12.5 7"/></svg>';
export const PONTO_PRECISA = '<svg class="pf-aba-ic pf-precisa" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>';
export const DISCO_FEITA = '<svg class="tv-svg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M4.2 7.2 L6.1 9 L9.8 5.2" fill="none" stroke="var(--chat-superficie)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const DISCO_FALHOU = '<svg class="tv-svg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M7 3.8 V7.6 M7 9.8 V9.9" stroke="var(--chat-superficie)" stroke-width="1.6" stroke-linecap="round"/></svg>';
export const ANEL_FILA = '<svg class="tv-svg" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 2" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/></svg>';
export const QUADRADO_PARADA = '<svg class="tv-svg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor"/></svg>';
/** XUM-6 (Paper 9f, RV3-0): na lista aberta da aba, o "!" branco num disco de 12 (quem precisa de você) e a pausa num anel (a parada). */
export const EXCLAMACAO_PRECISA = '<svg class="tv-svg" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="currentColor"/><path d="M6 3.2v3.4" stroke="var(--chat-superficie)" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="8.7" r="0.9" fill="var(--chat-superficie)"/></svg>';
export const PAUSA_PARADA = '<svg class="tv-svg" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-opacity=".63" stroke-width="1.5"/><path d="M4.8 4.2v3.6M7.2 4.2v3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
