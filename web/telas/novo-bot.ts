import type { Estado } from "../estado/reducer.ts";
import { esc, iconeAgente } from "../lib/render.ts";

/**
 * ADR-165 (tela 04 do Paper): a nova conversa é a linha "Para:" no topo, com o popover de sugestões logo abaixo (os bots
 * que casam com o que foi digitado, "Criar o bot “Ce”" e "Nova sala com vários bots ⌘⇧N"), o mascote do nod no vazio e o
 * campo de sempre embaixo. O filtro é o de sempre (filtrarBots em `.contact-picker`): cada linha de bot tem `data-busca`.
 */
export function renderNovoBot(estado: Estado, o: { teclaSala?: string } = {}): string {
  const bots = (estado.frota?.agentes ?? []).filter((a) => a.confirmado !== false);
  const linhas = bots
    .map((a) => {
      const sub = [a.titulo, a.ultimaMensagem?.previa].filter(Boolean).join(" · ");
      return `<button type="button" class="picker-row nc-bot" role="option" data-busca="${esc(`${a.nome} ${a.titulo ?? ""}`.toLowerCase())}" data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}">${iconeAgente(a, "sm")}<span class="nc-txt"><b>${esc(a.nome)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span><kbd class="ds-kbd nc-enter" aria-hidden="true">↵</kbd></button>`;
    })
    .join("");
  const sala = (o.teclaSala ?? "⌘ ⇧ N").split(" ").map((t) => `<kbd class="ds-kbd">${esc(t)}</kbd>`).join("");
  return `<section class="tela novo-contato nc-paper">
    <div class="nc-para"><label for="busca-destinatario">Para:</label><input id="busca-destinatario" aria-label="Para: buscar ou criar bots" aria-controls="nc-sugestoes" autocomplete="off" spellcheck="false" /><button type="button" class="nc-fechar" data-act="fechar-nova-conversa" aria-label="Fechar a nova conversa" title="Fechar (Esc)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
    <div class="contact-picker nc-pop" id="nc-sugestoes" role="listbox" aria-label="Sugestões">
      ${linhas}
      <div class="nc-sep" role="separator"></div>
      <button type="button" class="picker-row nc-acao nc-criar" data-act="criar-rapido"><span class="nc-ic nc-ic-mais" aria-hidden="true">＋</span><span class="nc-txt"><span>Criar o bot “<span class="nc-termo"></span>”</span></span><span class="nc-dica">Novo bot</span></button>
      <button type="button" class="picker-row nc-acao" data-act="navegar" data-tela="nova-sala"><span class="nc-ic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h10a1 1 0 011 1v6.5a1 1 0 01-1 1H7.5L4.5 14v-2.5H3a1 1 0 01-1-1V4a1 1 0 011-1z"/></svg></span><span class="nc-txt"><span>Nova sala com vários bots</span></span><span class="ds-teclas" aria-hidden="true">${sala}</span></button>
    </div>
    <div class="nc-vazio" aria-hidden="true">${iconeAgente({ nome: "nod", cor: "c-black", forma: "shape-pebble" }, "lg")}<b>Nova conversa</b><span>Escolha um bot ou digite um nome para criar um.</span></div>
    <div class="nc-campo composer"><div class="box"><span class="mais-campo nc-mais" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></span><textarea id="nc-texto" rows="1" placeholder="Mensagem para o bot" aria-label="Mensagem para o bot escolhido"></textarea><span class="mic nc-mic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14"/></svg></span><button type="button" class="send" data-act="nc-enviar" aria-label="Enviar para o bot escolhido"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3.5M4 7.5l4-4 4 4"/></svg></button></div></div>
  </section>`;
}
