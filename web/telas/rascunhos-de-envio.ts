import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { CanalRascunho, Rascunho } from "../../src/contracts/item-aprovacao.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";

type Item = SuaVezDto["itens"][number];
type ItemAprovacao = Item["itensAprovacao"][number];
type ItemComRascunho = ItemAprovacao & { rascunho: Rascunho };

/**
 * Os rascunhos de envio na conversa (ADR-173; protótipo "12-rascunhos-claro" da engenharia reversa do Grok Bot). Quando
 * TODOS os itens de uma aprovação aberta são mensagens que saem, a decisão vira um cartão por mensagem — cabeçalho "E-mail ·
 * Gmail", Para, Assunto e o corpo editável — e, com dois ou mais na conversa, a barra "N rascunhos prontos" com "Descartar
 * todos" e "Enviar todos ⌘↵". A web não decide nada: Enviar e Descartar chamam o mesmo `decisoes/:id/decidir` do cartão
 * de aprovação (main.ts), com o texto final da caixa. O `rascunho` vem pronto do servidor (listar-sua-vez.ts); aqui só se
 * desenha. Mantém `data-decisao`, `input[data-item]` e `[data-item-texto]`, que `marcacoesDe` lê.
 */

/** A decisão é de rascunhos: aberta, de aprovação, e todo item é uma mensagem que sai. */
export function ehDecisaoDeRascunhos(item: Pick<Item, "decisao" | "estadoColuna" | "itensAprovacao">): boolean {
  return item.decisao.tipo === "aprovacao" && item.estadoColuna !== "vencido" && item.itensAprovacao.length > 0 && item.itensAprovacao.every((i) => i.rascunho !== undefined && !i.origemSensivel);
}

const svg = (corpo: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ENVELOPE = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>';
const BALAO = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>';
const HASH = '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>';
const ICONE: Readonly<Record<CanalRascunho, string>> = { email: ENVELOPE, slack: HASH, imessage: BALAO, sms: BALAO, chat: BALAO };

/** As linhas do corpo que cabem sem rolar (definido em 2026-11-12: o corpo do protótipo tem duas; e-mail longo rola dentro). */
const LINHAS_MAX = 12;
const linhasDe = (t: string): number => Math.min(LINHAS_MAX, Math.max(2, t.split("\n").length + Math.floor(t.length / 90)));

function renderUmRascunho(decisaoId: string, i: ItemComRascunho, sozinho: boolean): string {
  const r = i.rascunho;
  const para = r.para.length ? `<div class="re-linha"><span class="re-rotulo">Para</span><span class="re-chips">${r.para.map((p) => `<span class="re-chip">${esc(p)}</span>`).join("")}</span></div>` : "";
  const assunto = r.assunto ? `<div class="re-linha"><span class="re-rotulo">Assunto</span><span class="re-assunto">${esc(r.assunto)}</span></div>` : "";
  const corpo = r.editavel
    ? `<textarea class="re-corpo texto-final" data-item-texto="${esc(i.id)}" rows="${linhasDe(r.corpo)}" aria-label="Corpo da mensagem (${esc(r.rotulo)}): edite antes de enviar">${esc(r.corpo)}</textarea>`
    : `<div class="re-corpo re-corpo-fixo" title="O bot montou esta mensagem fora do texto do pedido; para mudar, descarte e diga a ele o que quer.">${esc(r.corpo)}</div>`;
  // Um item na decisão: Enviar e Descartar fecham a decisão. Vários: Descartar tira este da lista (a caixa abaixo) e o envio
  // é pela barra, porque a decisão é uma só (enviar metade deixaria a outra metade sem resposta).
  const acoes = sozinho
    ? `${botao("decidir-aprovacao-nenhum", "Descartar", { classe: "re-descartar", id: decisaoId })}${botao("decidir-aprovacao", "Enviar", { classe: "re-enviar", id: decisaoId })}`
    : botao("rascunho-alternar", i.selecionado ? "Descartar" : "Desfazer", { classe: "re-descartar", dados: { item: i.id } });
  return `<div class="re-cartao${i.selecionado ? "" : " re-descartado"}" data-rascunho="${esc(i.id)}">
    <div class="re-cab"><span class="re-canal">${svg(ICONE[r.canal])}<span>${esc(r.rotulo)}</span></span><span class="re-acoes">${acoes}</span></div>
    <input type="checkbox" class="re-marca" hidden data-item="${esc(i.id)}" ${i.selecionado ? "checked" : ""} />
    ${para}${assunto}${corpo}
  </div>`;
}

/** O cartão da decisão de rascunhos: um rascunho por item, na ordem do pedido. Mesmo `<li class="decisao">` dos outros. */
export function renderDecisaoDeRascunhos(item: Item): string {
  const itens = item.itensAprovacao.filter((i): i is ItemComRascunho => i.rascunho !== undefined);
  const sozinho = itens.length === 1;
  return `<li class="decisao re-decisao dec-${esc(item.estadoColuna)}" data-decisao="${esc(item.decisao.id)}" data-rascunhos="${itens.length}">
    ${itens.map((i) => renderUmRascunho(item.decisao.id, i, sozinho)).join("")}
  </li>`;
}

/** As decisões de rascunhos abertas desta conversa, na ordem da fila. */
export function decisoesDeRascunhos(estado: Pick<Estado, "suaVez">, conversaId: string): Item[] {
  return estado.suaVez?.itens.filter((i) => i.decisao.conversaId === conversaId && ehDecisaoDeRascunhos(i)) ?? [];
}

/**
 * A barra "N rascunhos prontos" (protótipo: acima da caixa de mensagem). Só com dois ou mais rascunhos marcados na conversa:
 * um só já tem o Enviar no próprio cartão. O ⌘↵ (Ctrl+↵ fora do Mac) é atalho do mesmo botão (main.ts).
 */
export function renderBarraRascunhos(estado: Pick<Estado, "suaVez">, conversaId: string): string {
  const decisoes = decisoesDeRascunhos(estado, conversaId);
  const total = decisoes.reduce((n, d) => n + d.itensAprovacao.length, 0);
  if (total < 2) return "";
  const ids = decisoes.map((d) => d.decisao.id).join(",");
  const rotulo = total === 1 ? "1 rascunho pronto" : `${total} rascunhos prontos`;
  return `<div class="re-barra" role="region" aria-label="Rascunhos prontos para enviar">
    <span class="re-barra-txt">${svg(ENVELOPE)}<b>${esc(rotulo)}</b></span>
    <span class="re-barra-acoes">${botao("rascunhos-descartar-todos", "Descartar todos", { classe: "re-descartar", dados: { decisoes: ids } })}${botao("rascunhos-enviar-todos", 'Enviar todos <kbd class="re-atalho" aria-hidden="true">⌘↵</kbd>', { classe: "pri re-enviar-todos", dados: { decisoes: ids }, aria: `Enviar todos os ${total} rascunhos` })}</span>
  </div>`;
}

/**
 * O ⌘↵ da barra (Ctrl+↵ fora do Mac). Vale com o foco num rascunho, na barra ou no campo de mensagem VAZIO: com texto no
 * campo, o atalho é da fala da pessoa, e o rascunho não sai por engano. Puro, para o teste.
 */
export function atalhoEnviarTodos(t: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, ctx: { noMac: boolean; temBarra: boolean; foco: "rascunho" | "campo-vazio" | "campo-com-texto" | "outro" }): boolean {
  if (t.key !== "Enter" || t.isComposing || t.altKey || t.shiftKey || !ctx.temBarra) return false;
  if (!(ctx.noMac ? t.metaKey && !t.ctrlKey : t.ctrlKey && !t.metaKey)) return false;
  return ctx.foco === "rascunho" || ctx.foco === "campo-vazio";
}
