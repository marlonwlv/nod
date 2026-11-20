import type { PayloadNavegadorLugar } from "../../src/contracts/navegador-do-bot.ts";
import { esc } from "./escape.ts";

/**
 * ADR-190 (N): a linha cinza da conversa do bot quando o navegador dele muda de lugar sozinho ("Com o Mac desligado,
 * agora continuo na vm-sp." · Desfazer). O botão manda `mudar` em POST /agentes/:id/navegador/lugar (ação
 * `navegador-lugar` em main.ts); só a dona do bot o vê.
 */
export function htmlLinhaDoLugarDoNavegador(p: PayloadNavegadorLugar, texto: string, dono: boolean): string {
  const acao = p.acao && dono
    ? `<span class="cc-sistema-sep" aria-hidden="true"> · </span><button type="button" class="cc-sistema-link" data-act="navegador-lugar" data-id="${esc(p.agenteId)}" data-mudar="${esc(JSON.stringify(p.acao.mudar))}">${esc(p.acao.rotulo)}</button>`
    : "";
  return `<p class="cc-sistema" role="status"><span>${esc(texto)}</span>${acao}</p>`;
}
