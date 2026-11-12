import type { CapturaDesktop } from "../../src/contracts/desktop-mac.ts";
import { esc } from "./escape.ts";

/**
 * Quick Chat (ADR-173, definido em 2026-11-12; tela 10 do protótipo no Paper): a mesma página do nod numa janela de
 * 608×440 que o atalho global abre de qualquer app (desktop/quick-chat.ts). Aqui só o que é da página:
 *
 * - o modo compacto, ligado por `?janela=quick-chat` (o CSS esconde a barra lateral, o cabeçalho e os detalhes);
 * - o topo com o seletor de bot (a pílula "Ada ⌄"), o ⤢ que abre a conversa na janela grande e o ✕;
 * - o botão Capturar ao lado do clipe, em qualquer janela do app do Mac: a captura vira um anexo comum do composer.
 *
 * Puro e sem DOM, menos `arquivoDaCaptura` (File existe no navegador e no Node 24 do teste).
 */
export const PARAMETRO_QUICK_CHAT = "janela";
export const VALOR_QUICK_CHAT = "quick-chat";

export function ehJanelaQuickChat(search: string): boolean {
  return new URLSearchParams(search).get(PARAMETRO_QUICK_CHAT) === VALOR_QUICK_CHAT;
}

/** O avatar solto na mesa (desktop/avatar-mesa.ts) carrega a página com `?janela=avatar&bot=<id>`. */
export function ehJanelaAvatar(search: string): boolean {
  return new URLSearchParams(search).get(PARAMETRO_QUICK_CHAT) === "avatar";
}

/** O bot pedido na URL (o avatar abre o Quick Chat já nele). Só uuid; o resto é ignorado. */
export function botDaUrl(search: string): string | null {
  const id = new URLSearchParams(search).get("bot");
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

const ALFINETE = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2Z M8 9.5v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';

/**
 * O avatar da mesa: só o mascote, num botão (clique abre o Quick Chat no bot) e um × pequeno que aparece no mouse
 * (desmonta). `mascote` é o HTML pronto (web/lib/mascote.ts), para este módulo não depender do componente.
 */
export function htmlAvatarDaMesa(bot: { id: string; nome: string }, mascote: string): string {
  return `<div class="am"><button type="button" class="am-bot" data-act="avatar-abrir" data-id="${esc(bot.id)}" aria-label="Falar com ${esc(bot.nome)}" title="${esc(bot.nome)} · clique para conversar">${mascote}</button><button type="button" class="am-tirar" data-act="avatar-tirar" data-id="${esc(bot.id)}" aria-label="Tirar ${esc(bot.nome)} da área de trabalho" title="Tirar da área de trabalho">×</button></div>`;
}

export type BotDoQuickChat = { id: string; nome: string; conversaId: string };

const SETA = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXPANDIR = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FECHAR = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const CAPTURAR = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

/**
 * O topo do Quick Chat: o seletor de bot é um `<select>` nativo por baixo da pílula (teclado, leitor de tela e a lista
 * do macOS de graça); trocar abre a conversa daquele bot. A faixa inteira arrasta a janela (`-webkit-app-region`),
 * menos os controles.
 */
export function htmlTopoQuickChat(bots: readonly BotDoQuickChat[], atual: string | null, mesa: { pode: boolean; montado: boolean } = { pode: false, montado: false }, /** Tela 10 do Paper: o mascote do bot na pílula (HTML pronto). */ avatar = ""): string {
  const escolhido = bots.find((b) => b.id === atual) ?? null;
  const opcoes = bots.map((b) => `<option value="${esc(b.id)}"${b.id === atual ? " selected" : ""}>${esc(b.nome)}</option>`).join("");
  const vazio = escolhido ? "" : '<option value="" selected disabled>Escolha um bot</option>';
  return `<div class="qc-topo"><label class="qc-bot">${escolhido && avatar ? `<span class="qc-bot-av" aria-hidden="true">${avatar}</span>` : ""}<span class="qc-bot-nome">${esc(escolhido?.nome ?? "Escolha um bot")}</span>${SETA}<select class="qc-bot-select" data-quick="bot" aria-label="Bot da conversa">${vazio}${opcoes}</select></label><span class="qc-espaco"></span>${mesa.pode && escolhido ? `<button type="button" class="qc-bt${mesa.montado ? " ativo" : ""}" data-act="${mesa.montado ? "quick-desmontar" : "quick-montar"}" data-id="${esc(escolhido.id)}" aria-pressed="${mesa.montado}" aria-label="${mesa.montado ? "Tirar da área de trabalho" : "Montar na área de trabalho"}" title="${mesa.montado ? "Tirar da área de trabalho" : "Montar na área de trabalho"}">${ALFINETE}</button>` : ""}<button type="button" class="qc-bt" data-act="quick-expandir" aria-label="Abrir na janela do nod" title="Abrir na janela do nod">${EXPANDIR}</button><button type="button" class="qc-bt" data-act="quick-fechar" aria-label="Fechar o Quick Chat" title="Fechar (Esc)">${FECHAR}</button></div>`;
}

/** O botão do composer (ao lado do clipe). Só aparece quando a ponte do Mac tem `capturarTela`. */
export function htmlBotaoCapturar(): string {
  return `<button type="button" class="qc-capturar" data-act="capturar-tela" aria-label="Capturar janela ou região" title="Capturar janela ou região (Espaço troca para janela)">${CAPTURAR}<span>Capturar</span></button>`;
}

/** A captura vira um File como o do clipe; null quando não há imagem. O teto já foi conferido no processo principal. */
export function arquivoDaCaptura(c: CapturaDesktop | null): File | null {
  if (!c || "erro" in c) return null;
  const bin = atob(c.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], c.nome, { type: c.mime });
}

/** A frase do aviso quando a captura não entra (só o teto; cancelar não avisa nada). */
export function fraseDaCaptura(c: CapturaDesktop | null): string | null {
  return c && "erro" in c ? "A captura passou de 10 MB. Capture uma região menor." : null;
}
