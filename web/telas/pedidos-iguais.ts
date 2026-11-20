import type { SuaVezDto } from "../../src/contracts/api.ts";
import { botao, esc } from "../lib/render.ts";

type Item = SuaVezDto["itens"][number];

/**
 * Aprovação em lote de pedidos iguais (definido em 2026-11-12, ADR-166; decisão 2 do Marlon, tela 06 "Em lote" do protótipo).
 * Quando o mesmo bot pede a mesma ação no mesmo app várias vezes (quatro "criar issue no Linear"), os
 * cartões viram um só: "4 pedidos iguais", cada pedido com a caixa marcada, "Permitir os 4", "Negar todos" (Esc) e "Ver um
 * a um". Só na tela: cada pedido continua sendo a decisão dele, e o clique decide cada uma pela rota de sempre
 * (`decisoes/:id/decidir`) — nada novo no servidor, nada que um item faça pelo outro.
 */

/** A partir de quantos pedidos iguais o cartão em lote aparece. */
export const MIN_IGUAIS = 2;

/** Os grupos abertos à mão ("Ver um a um"), pela chave do grupo; sobrevivem aos redesenhos desta aba. */
export const IGUAIS_UM_A_UM = new Set<string>();

/** A chave de "igual": o bot, a ação (app e ferramenta) e um item só, sem dado pessoal, aberto. Fora disso, null. */
export function chaveDeIgual(item: Item): string | null {
  if (item.decisao.tipo !== "aprovacao" || item.estadoColuna === "vencido") return null;
  const [i, outro] = item.itensAprovacao;
  if (!i || outro || i.origemSensivel) return null;
  if (i.destino.conector === "terminal" || i.destino.conector === "computador") return null;
  return `${item.decisao.agenteId}|${i.destino.conector}|${i.destino.ferramenta}`;
}

/**
 * Agrupa na ordem em que chegaram: o grupo fica no lugar do primeiro pedido dele. Item sem chave, grupo menor que o mínimo
 * ou grupo aberto à mão saem soltos, como antes.
 */
export function agruparIguais(itens: readonly Item[]): (Item | Item[])[] {
  const porChave = new Map<string, Item[]>();
  for (const it of itens) {
    const k = chaveDeIgual(it);
    if (k) porChave.set(k, [...(porChave.get(k) ?? []), it]);
  }
  const saida: (Item | Item[])[] = [];
  const postos = new Set<string>();
  for (const it of itens) {
    const k = chaveDeIgual(it);
    const grupo = k ? porChave.get(k) : undefined;
    if (!k || !grupo || grupo.length < MIN_IGUAIS || IGUAIS_UM_A_UM.has(k)) {
      saida.push(it);
      continue;
    }
    if (postos.has(k)) continue;
    postos.add(k);
    saida.push(grupo);
  }
  return saida;
}

/** O cartão do grupo. `nomeDaAcao`: "Criar issue no Linear" (acaoHumana); `onde`: "Linear". */
export function renderPedidosIguais(grupo: readonly Item[], nomeDaAcao: string, onde: string, avatar = ""): string {
  const primeiro = grupo[0];
  if (!primeiro) return "";
  const n = grupo.length;
  const chave = chaveDeIgual(primeiro) ?? "";
  const ids = grupo.map((g) => g.decisao.id);
  const tit = `iguais-t-${esc(ids[0] ?? "")}`;
  const linhas = grupo.map((g) => {
    const it = g.itensAprovacao[0];
    return `<li class="iguais-item"><label><input type="checkbox" data-igual="${esc(g.decisao.id)}" checked><span class="iguais-txt">${esc(it?.textoFinal ?? g.decisao.frase)}</span></label><small>${esc(onde)}</small></li>`;
  }).join("");
  return `<li class="decisao aprov-card aprov-iguais" data-decisao="${esc(ids[0] ?? "")}" data-iguais="${esc(ids.join(","))}" data-chave="${esc(chave)}">
    <div class="aprov-cab">${avatar ? `<span class="aprov-av">${avatar}</span>` : '<span class="aprov-ponto" aria-hidden="true"></span>'}<span class="aprov-quem">${n} pedidos iguais</span><span class="aprov-esc">Esc</span>${botao("iguais-negar", "×", { classe: "aprov-fechar", dados: { iguais: ids.join(",") }, aria: "Negar todos e fechar" })}</div>
    <p class="aprov-titulo dec-frase" id="${tit}">${esc(`${nomeDaAcao.charAt(0).toUpperCase()}${nomeDaAcao.slice(1)}`)}, ${n} vezes?</p>
    <p class="iguais-sub">Mesma ação, mesmo app. Desmarque o que não deve sair.</p>
    <ul class="iguais-lista" aria-labelledby="${tit}">${linhas}</ul>
    <div class="acoes aprov-acoes">${botao("iguais-ver", "Ver um a um", { classe: "link", dados: { chave } })}<span class="iguais-espaco"></span>${botao("iguais-negar", 'Negar todos <kbd class="kbd-esc">Esc</kbd>', { classe: "aprov-negar", dados: { iguais: ids.join(",") } })}${botao("iguais-permitir", `Permitir os <span data-iguais-conta>${n}</span>`, { classe: "pri", dados: { iguais: ids.join(",") } })}</div>
  </li>`;
}
