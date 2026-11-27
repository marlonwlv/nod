import { esc } from "./escape.ts";

/**
 * O cartão "A {bot} quer usar seu Mac" (ADR-197, item 4; Paper "Seu computador", S1), no molde dos cartões do chat
 * (cc-cartao, ADR-190/D5): a linha de cima com o rótulo do aparelho e o X, o título, "Só o {app} · motivo" e as três
 * saídas — [Agora não] [Sempre no {app}] [Permitir desta vez]. O texto vem pronto do servidor (o item da aprovação:
 * `textoFinal` é o título, o resumo da decisão é a linha de baixo); o nome do app veio do sistema, nunca do modelo.
 */
const ICONE_TELA = '<svg class="cc-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
const ICONE_X = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

export type EntradaCartaoSeuComputador = { decisaoId: string; agenteId: string; titulo: string; texto: string; app: string; aparelho: "Mac" | "PC" };

export function htmlCartaoSeuComputador(o: EntradaCartaoSeuComputador): string {
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(o.decisaoId)}"`;
  const app = o.app.trim() || "app";
  return `<div class="cc-cartao cc-molde scc" role="group" aria-label="${esc(o.titulo)}" ${dados}>`
    + `<div class="cc-cab">${ICONE_TELA}<span class="cc-rotulo">Seu ${esc(o.aparelho)}</span><button type="button" class="cc-x" data-act="sc-decidir" ${dados} data-aprovar="0" aria-label="Agora não" title="Agora não">${ICONE_X}</button></div>`
    + `<p class="cc-titulo">${esc(o.titulo)}</p>${o.texto ? `<p class="cc-texto">${esc(o.texto)}</p>` : ""}`
    + `<p class="cc-texto scc-nota">Você vê tudo numa ilha no topo da tela e pode parar a qualquer hora.</p>`
    + `<div class="cc-botoes"><button type="button" class="cc-bt cc-resto" data-act="sc-decidir" ${dados} data-aprovar="0">Agora não</button>`
    + `<button type="button" class="cc-bt cc-resto" data-act="sc-decidir" ${dados} data-aprovar="1" data-sempre="1">Sempre no ${esc(app)}</button>`
    + `<button type="button" class="cc-bt cc-uma pri" data-act="sc-decidir" ${dados} data-aprovar="1">Permitir desta vez</button></div></div>`;
}
