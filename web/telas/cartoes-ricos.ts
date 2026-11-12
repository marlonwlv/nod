import type { Dinheiro } from "../../src/contracts/assistente.ts";
import type { CartaoMapa, CartaoRico, PayloadCartoes } from "../../src/contracts/ferramentas-cartoes.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { esc } from "../lib/render.ts";

/**
 * Os cartões ricos na conversa (ADR-175; respostas ricas): voo, hotel, carro, mapa, clima, carrinho e arquivo.
 * Os dados chegam limpos do servidor (src/domain/cartoes-ricos.ts: texto curto, link só https); aqui tudo é escapado de
 * novo e nada de fora é carregado — o mapa é um desenho dos pontos pelos números, sem tiles, com o link para o Mapas.
 */

/** "R$ 1.234,56"; outra moeda sai com o código (espelho de `formatarDinheiro`; a web não executa código de src/). */
export function dinheiro(d: Dinheiro): string {
  const inteiro = Math.trunc(Math.abs(d.centavos) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${d.centavos < 0 ? "-" : ""}${d.moeda === "BRL" ? "R$" : d.moeda} ${inteiro},${String(Math.abs(d.centavos) % 100).padStart(2, "0")}`;
}

const svg = (corpo: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ICONE: Readonly<Record<CartaoRico["tipo"], string>> = {
  voo: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  hotel: '<path d="M3 21V7l9-4 9 4v14"/><path d="M9 21v-6h6v6"/>',
  carro: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
  mapa: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clima: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  carrinho: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6"/>',
  arquivo: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
};

const link = (href: string | undefined, rotulo: string): string => (href ? `<a class="rc-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(rotulo)}</a>` : "");
const hora = (dataHora: string): string => dataHora.slice(11, 16);
const dia = (data: string): string => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

function cartao(tipo: CartaoRico["tipo"], titulo: string, corpo: string, rodape = ""): string {
  return `<article class="rc rc-${tipo}"><header class="rc-cab">${svg(ICONE[tipo])}<b>${titulo}</b></header>${corpo}${rodape ? `<footer class="rc-rodape">${rodape}</footer>` : ""}</article>`;
}

/** O mapa sem tiles: os pontos no retângulo que os contém, com margem; um ponto só fica no centro. */
function desenhoDoMapa(c: CartaoMapa): string {
  const lats = c.pontos.map((p) => p.lat), lngs = c.pontos.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const L = 320, A = 160, M = 20;
  const x = (lng: number) => (maxLng === minLng ? L / 2 : M + ((lng - minLng) / (maxLng - minLng)) * (L - 2 * M));
  const y = (lat: number) => (maxLat === minLat ? A / 2 : M + ((maxLat - lat) / (maxLat - minLat)) * (A - 2 * M));
  const pontos = c.pontos.map((p, i) => `<g><circle cx="${x(p.lng).toFixed(1)}" cy="${y(p.lat).toFixed(1)}" r="9" class="rc-pino"/><text x="${x(p.lng).toFixed(1)}" y="${(y(p.lat) + 4).toFixed(1)}" text-anchor="middle" class="rc-pino-n">${i + 1}</text></g>`).join("");
  return `<svg class="rc-mapa-desenho" viewBox="0 0 ${L} ${A}" role="img" aria-label="${esc(`Mapa com ${c.pontos.length} ${c.pontos.length === 1 ? "lugar" : "lugares"}`)}">${pontos}</svg>`;
}
const noMapas = (p: { nome: string; lat: number; lng: number }): string => `https://maps.apple.com/?ll=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&q=${encodeURIComponent(p.nome)}`;

export function renderCartaoRico(c: CartaoRico): string {
  switch (c.tipo) {
    case "voo":
      return cartao("voo", `${esc(c.origem)} → ${esc(c.destino)}`, `<div class="rc-linha"><span class="rc-grande">${esc(hora(c.partida))} – ${esc(hora(c.chegada))}</span>${c.preco ? `<span class="rc-preco">${esc(dinheiro(c.preco))}</span>` : ""}</div>
        <div class="rc-mudo">${esc(c.companhia)} ${esc(c.numero)} · ${esc(dia(c.partida))} · ${c.paradas === 0 ? "direto" : `${c.paradas} ${c.paradas === 1 ? "parada" : "paradas"}`}</div>`, link(c.link, "Ver voo"));
    case "hotel":
      return cartao("hotel", esc(c.nome), `<div class="rc-linha"><span class="rc-mudo">${esc(c.endereco)}</span>${c.diaria ? `<span class="rc-preco">${esc(dinheiro(c.diaria))}<small> /diária</small></span>` : ""}</div>
        <div class="rc-mudo">${esc(dia(c.entrada))} a ${esc(dia(c.saida))}${c.nota !== undefined ? ` · nota ${esc(c.nota.toFixed(1).replace(".", ","))}` : ""}</div>`, link(c.link, "Ver hotel"));
    case "carro":
      return cartao("carro", `${esc(c.modelo)}`, `<div class="rc-linha"><span class="rc-mudo">${esc(c.locadora)} · ${esc(c.local)}</span>${c.total ? `<span class="rc-preco">${esc(dinheiro(c.total))}</span>` : ""}</div>
        <div class="rc-mudo">${esc(dia(c.retirada))} a ${esc(dia(c.devolucao))}</div>`, link(c.link, "Ver carro"));
    case "mapa":
      return cartao("mapa", esc(c.titulo), `${desenhoDoMapa(c)}<ol class="rc-lista">${c.pontos.map((p) => `<li><span>${esc(p.nome)}${p.endereco ? `<small>${esc(p.endereco)}</small>` : ""}</span>${link(noMapas(p), "Abrir no Mapas")}</li>`).join("")}</ol>`);
    case "clima":
      return cartao("clima", esc(c.local), `<ul class="rc-dias">${c.dias.map((d) => `<li><b>${esc(dia(d.data))}</b><span class="rc-temp">${Math.round(d.maximaC)}°<small> ${Math.round(d.minimaC)}°</small></span><span class="rc-mudo">${esc(d.resumo)}</span><span class="rc-chuva">${Math.round(d.chuvaPct)}% chuva</span></li>`).join("")}</ul>`);
    case "carrinho": {
      const estado = c.estado === "pago" ? "Pago" : c.estado === "aguardando_passkey" ? "Esperando sua passkey no Mac" : "Aberto";
      return cartao("carrinho", c.loja ? `Carrinho · ${esc(c.loja)}` : "Carrinho", `<ul class="rc-itens">${c.itens.map((i) => `<li><span>${i.quantidade}× ${esc(i.nome)}</span><span>${esc(dinheiro({ centavos: i.unitario.centavos * i.quantidade, moeda: i.unitario.moeda }))}</span></li>`).join("")}</ul>
        <div class="rc-linha rc-total"><span>Total</span><span class="rc-preco">${esc(dinheiro(c.total))}</span></div>`, `<span class="rc-estado rc-estado-${esc(c.estado)}">${esc(estado)}</span>`);
    }
    case "arquivo": {
      const previa = c.previa?.length ? `<div class="md-tabela rc-previa"><div class="md-tabela-rolagem"><table><tbody>${c.previa.map((l) => `<tr>${l.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>` : "";
      const meta = c.formato === "pdf" ? `PDF${c.paginas ? ` · ${c.paginas} ${c.paginas === 1 ? "página" : "páginas"}` : ""}` : "Planilha";
      return cartao("arquivo", esc(c.nome), `<div class="rc-mudo">${esc(meta)}</div>${previa}`, link(c.link, "Abrir"));
    }
  }
}

/** A fala com cartões: o resumo (primeira linha do texto) e a grade; a fala que leu conteúdo de fora leva a marca. */
export function renderMensagemCartoes(m: Pick<Mensagem, "texto" | "confianca">, p: PayloadCartoes): string {
  const resumo = m.texto.split("\n")[0] ?? "";
  const naoConfiavel = m.confianca === "nao_confiavel" ? ' <span class="tag tag-ambar" title="mostrado num turno que leu conteúdo de fora">não confiável</span>' : "";
  return `<section class="rc-grupo" aria-label="${esc(resumo)}"><p class="rc-resumo">${esc(resumo)}${naoConfiavel}</p><div class="rc-grade">${p.cartoes.map(renderCartaoRico).join("")}</div></section>`;
}
