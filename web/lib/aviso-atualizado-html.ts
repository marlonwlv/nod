/**
 * ADR-188 (Paper "E · Depois do clique", momento 3): o HTML do aviso de quando o nod volta de uma atualização — o check
 * verde, "nod atualizado para a x.y.z" e a pílula "Novidades". Sem DOM: o teste lê daqui e o typecheck do servidor
 * (lib ES2022, sem "dom") inclui os testes. Quem mostra e tira o aviso da tela é web/lib/aviso-atualizado.ts.
 */
import { esc } from "./render.ts";

export const DURACAO_AVISO_ATUALIZADO_MS = 6_000;
const IC_CHECK = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="currentColor"/><path d="M5.6 9.2 7.8 11.3 12.4 6.7" fill="none" stroke="var(--on-status)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function htmlAvisoAtualizado(versao: string): string {
  return `<span class="atz-aviso-ic">${IC_CHECK}</span><span class="atz-aviso-txt">nod atualizado para a <b>${esc(versao)}</b></span><button type="button" class="atz-aviso-bt" data-novidades>Novidades</button>`;
}
