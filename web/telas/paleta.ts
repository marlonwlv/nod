import { ICONE } from "../lib/icones.ts";
import { ORDEM_DOS_GRUPOS, type ItemPaleta } from "../lib/paleta.ts";
import { esc } from "../lib/render.ts";

/**
 * ADR-165 (tela 08): o desenho da paleta ⌘K — campo no topo, grupos com título (Bots, Conversas, Ajustes, Ações), cada
 * item com ícone ou avatar, título, linha de baixo (prévia ou caminho) e as teclas à direita, e o rodapé com ↑ ↓ ↵ esc.
 * HTML com classes `.paleta-*` (web/ds.css): sem estado, recebe o modelo e devolve texto.
 */

export const PLACEHOLDER_DA_PALETA = "Buscar bots, conversas, ajustes e ações…";

const LUPA = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
const LUA = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>';
const BARRA = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/></svg>';
const TECLADO = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="4" width="13" height="8" rx="1.6"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6"/></svg>';
const TRABALHOS = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="14" height="11" rx="2.2"/><path d="M7.5 5.5V4.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2v1.3"/><path d="M3 10h14"/></svg>';

const ICONES: Record<NonNullable<ItemPaleta["icone"]>, string> = {
  conversa: ICONE.balao,
  ajuste: ICONE.ajustes,
  mais: ICONE.mais,
  tema: LUA,
  barra: BARRA,
  sala: ICONE.agentes,
  trabalhos: TRABALHOS,
  teclado: TECLADO,
  dev: ICONE.codigo,
  escudo: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/></svg>',
  relogio: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>',
  raio: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/></svg>',
};

export const idDoItem = (i: number): string => `paleta-i-${i}`;

/** A lista, por grupo. `avatar` desenha o mascote de um bot (quem chama sabe a cor e a forma). */
export function listaDaPaleta(itens: readonly ItemPaleta[], selecionado: number, avatar: (agenteId: string) => string, termo: string): string {
  if (!itens.length) return `<p class="paleta-vazia" role="status">Nada encontrado para “${esc(termo.trim())}”.</p>`;
  let n = 0;
  return ORDEM_DOS_GRUPOS.map((g) => {
    const doGrupo = itens.filter((i) => i.grupo === g);
    if (!doGrupo.length) return "";
    const linhas = doGrupo.map((i) => {
      const k = n++;
      const ic = i.agenteId ? `<span class="paleta-av">${avatar(i.agenteId)}</span>` : `<span class="paleta-ic" aria-hidden="true">${i.icone ? ICONES[i.icone] : ""}</span>`;
      const teclas = i.teclas?.length ? `<span class="ds-teclas" aria-hidden="true">${i.teclas.map((t) => `<kbd class="ds-kbd">${esc(t)}</kbd>`).join("")}</span>` : "";
      const sub = i.sub ? `<small>${esc(i.sub)}</small>` : "";
      return `<div class="paleta-item" role="option" id="${idDoItem(k)}" data-indice="${k}" aria-selected="${k === selecionado}">${ic}<span class="paleta-txt"><b>${esc(i.titulo)}</b>${sub}</span>${teclas}</div>`;
    }).join("");
    return `<div class="paleta-grupo" role="group" aria-label="${g}"><p class="paleta-grupo-tit" aria-hidden="true">${g}</p>${linhas}</div>`;
  }).join("");
}

/** A casca: o fundo, o campo, a lista (preenchida por listaDaPaleta) e o rodapé. */
export function cascaDaPaleta(): string {
  return `<div class="paleta-fundo" data-paleta-fundo>
    <div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar bots, conversas, ajustes e ações">
      <label class="paleta-campo">${LUPA}<input id="paleta-termo" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="paleta-lista" placeholder="${esc(PLACEHOLDER_DA_PALETA)}" autocomplete="off" spellcheck="false" /></label>
      <div class="paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados"></div>
      <div class="paleta-rodape" aria-hidden="true"><span><kbd class="ds-kbd">↑</kbd><kbd class="ds-kbd">↓</kbd> navegar</span><span><kbd class="ds-kbd">↵</kbd> abrir</span><span><kbd class="ds-kbd">esc</kbd> fechar</span></div>
    </div>
  </div>`;
}
