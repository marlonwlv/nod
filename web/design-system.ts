/**
 * ADR-167 (tela 01 do Paper): a vitrine do design system, como página interna (`/design-system.html`).
 * Mostra os tokens de verdade (web/tokens.css) e os componentes desenhados com eles: cor, tipografia, raios, sombras,
 * movimento, botões, campos, chips, balões e os avatares do nod (o mesmo <nod-mascote> do app). Segue o tema do sistema;
 * `?tema=escuro` ou `?tema=claro` força um. Só tokens (web/design-system.css).
 */
import "./lib/mascote-elemento.ts";
import { htmlMascote } from "./lib/mascote.ts";
import type { CorAgente, FormaAgente } from "../src/contracts/agente.ts";

const tema = new URLSearchParams(location.search).get("tema");
if (tema === "escuro") document.documentElement.dataset.theme = "dark";
if (tema === "claro") document.documentElement.dataset.theme = "light";
const escuro = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

const ic = (corpo: string, t = 16): string => `<svg width="${t}" height="${t}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const IC = {
  lupa: ic('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  mais: ic('<path d="M8 3v10M3 8h10"/>'),
  barra: ic('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>'),
  cima: ic('<path d="M8 13V3.5M4 7.5l4-4 4 4"/>'),
  parar: ic('<rect x="4.5" y="4.5" width="7" height="7" rx="1.2"/>'),
  mic: ic('<rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14"/>'),
  brilho: ic('<path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z"/>', 12),
  refazer: ic('<path d="M13 8a5 5 0 11-1.6-3.7M13 2.8v2.7h-2.7"/>', 12),
  seta: ic('<path d="M4.5 6.5L8 10l3.5-3.5"/>', 12),
};
const m = (forma: FormaAgente, cor: CorAgente, estado: Parameters<typeof htmlMascote>[2] = "disponivel", t = 36): string =>
  htmlMascote({ nome: "nod", forma, cor }, "", estado, `style="width:${t}px;height:${t}px"`);

const sup = (nome: string, valor: string, token: string) => `<div class="dsv-sup"><span class="dsv-amostra" style="background:var(${token})"></span><b>${nome}</b><small>${valor}</small></div>`;
const texto = (rotulo: string, pct: string, token: string) => `<div class="dsv-txt"><span style="color:var(${token})">Aa</span><b>${rotulo}</b><small>base ${pct}</small></div>`;
const borda = (rotulo: string, token: string) => `<div class="dsv-borda"><span style="border-color:var(${token})"></span><small>${rotulo}</small></div>`;
const sinal = (nome: string, sub: string, forte: string, suave: string) => `<div class="dsv-sinal"><span><i style="background:var(${forte})"></i><i style="background:var(${suave})"></i></span><b>${nome}</b><small>${sub}</small></div>`;
const CORES: [string, string][] = [["encre", "Tinta"], ["brun", "Marrom"], ["rouge", "Vermelho"], ["orange", "Laranja"], ["ambre", "Âmbar"], ["vert", "Verde"], ["turquoise", "Turquesa"], ["bleu", "Azul"], ["violet", "Violeta"], ["rose", "Rosa"], ["gris", "Cinza"], ["creme", "Creme"]];
const tipo = (nome: string, medida: string, classe: string, exemplo: string) => `<div class="dsv-tipo"><div><b>${nome}</b><small>${medida}</small></div><span class="${classe}">${exemplo}</span></div>`;

const cor = `<section class="dsv-col"><h2>Cor</h2><p class="dsv-sub">Tudo sai da base ${escuro ? "#f5f5f5" : "#1c1c1c"} por opacidade</p>
  <h3>Superfícies</h3><div class="dsv-linha">${sup("Conversa", "--surface", "--surface")}${sup("Topo", "--surface-chrome", "--surface-chrome")}${sup("Sidebar", "--surface-side", "--surface-side")}${sup("Elevado", "--surface-elevated", "--surface-elevated")}${sup("Hover", "base 6%", "--hover")}${sup("Ativo", "base 9%", "--ativo")}</div>
  <h3>Texto</h3>${texto("Primário", "100%", "--ink")}${texto("Secundário", "68%", "--ink-2")}${texto("Terciário", "64%", "--ink-3")}${texto("Quaternário", "40%", "--ink-4")}
  <h3>Bordas</h3><div class="dsv-linha">${borda("Forte · 24%", "--borda-forte")}${borda("Padrão · 12%", "--borda")}${borda("Sutil · 8%", "--borda-sutil")}${borda("Divisória · 6%", "--divisoria")}</div>
  <h3>Sinais</h3><div class="dsv-linha">${sinal("Acento", "só o que é novo", "--signal", "--signal-soft")}${sinal("Sucesso", "feito, ativo", "--success", "--success-soft")}${sinal("Aviso", "sua vez, alta", "--aguardando-ponto", "--aguardando-soft")}${sinal("Perigo", "erro, negar", "--danger", "--danger-soft")}</div>
  <h3>Cor do bot</h3><div class="dsv-cores">${CORES.map(([k, n]) => `<div><span style="background:var(--agent-${k})"></span><small>${n}</small></div>`).join("")}</div>
</section>`;

const tipografia = `<section class="dsv-col"><h2>Tipografia</h2><p class="dsv-sub">SF Pro, a fonte do sistema · 7 tamanhos · corpo 14</p>
  ${tipo("Título 1", "26/32 · 500", "ds-titulo-1", "Seus bots trabalham")}${tipo("Título 2", "22/28 · 500", "ds-titulo-2", "Aprovações")}${tipo("Título 3", "17/24 · 500", "ds-titulo-3", "Ada · PM")}
  ${tipo("Corpo", "14/20 · 400", "ds-corpo", "Criei 4 issues no backlog.")}${tipo("Corpo 2 · menus", "13/18 · 400", "ds-corpo-2", "Pode fazer sem perguntar")}${tipo("Rótulo", "12/16 · 400", "ds-rotulo", "Todo dia às 9h")}${tipo("Legenda", "11/16 · 400", "ds-legenda", "Rodando há 2 min")}
  <h3>Raios</h3><div class="dsv-raios">${[["6", "tooltip", "--raio-6"], ["8", "botão", "--raio-8"], ["10", "item", "--raio-10"], ["12", "cartão", "--raio-12"], ["14", "busca", "--raio-14"], ["18", "balão", "--raio-18"], ["20", "modal", "--raio-20"], ["full", "pílula", "--raio-full"]].map(([n, s, t]) => `<div><span style="border-radius:var(${t})"></span><b>${n}</b><small>${s}</small></div>`).join("")}</div>
  <h3>Sombras</h3><div class="dsv-sombras">${[["Controle", "--sombra-controle"], ["Inline", "--sombra-inline"], ["Menu", "--sombra-popover"], ["Modal", "--sombra-modal"], ["Janela", "--sombra-janela"]].map(([n, t]) => `<div><span style="box-shadow:var(${t})"></span><b>${n}</b></div>`).join("")}</div>
  <p class="dsv-nota">Sombras só no claro; no escuro viram borda</p>
  <h3>Movimento</h3><div class="dsv-mov">${[["Rápido", "100 ms · hover"], ["Normal", "150 ms · menus"], ["Lento", "200 ms · sidebar"], ["Mais lento", "300 ms · painéis"]].map(([n, s]) => `<div><b>${n}</b><small>${s}</small></div>`).join("")}</div>
  <p class="dsv-mono">Curva principal cubic-bezier(.22, 1, .36, 1)</p>
  <div class="dsv-shimmer"><span class="ds-shimmer">Pensando</span><i class="ds-esqueleto"></i><small>shimmer 1,6 s</small></div>
</section>`;

const componentes = `<section class="dsv-col"><h2>Componentes</h2><p class="dsv-sub">Alturas 32 · 28 · 24</p>
  <h3>Botões</h3>
  <div class="dsv-bts"><span class="dsv-bt pri g">Permitir uma vez</span><span class="dsv-bt sec g">Sempre permitir</span><span class="dsv-bt fant g">Negar <small>Esc</small></span></div>
  <div class="dsv-bts"><span class="dsv-bt pri">Criar</span><span class="dsv-bt cont">Cancelar</span><span class="dsv-bt perigo">Excluir bot</span><span class="dsv-bt off">Criar</span></div>
  <div class="dsv-bts"><span class="dsv-bt pri p">${IC.brilho}Salvar regra</span><span class="dsv-bt sec p">Editar</span><span class="dsv-bt perigo-s p">Descartar</span><span class="dsv-bt cont p">${IC.refazer}Tentar de novo</span></div>
  <div class="dsv-bts dsv-ics"><span class="dsv-ib flut">${IC.lupa}</span><span class="dsv-ib flut">${IC.mais}</span><span class="dsv-ib">${IC.barra}</span><span class="dsv-ib pri">${IC.cima}</span><span class="dsv-ib pri">${IC.parar}</span><span class="dsv-ib">${IC.mic}</span></div>
  <h3>Campos e controles</h3>
  <div class="dsv-campo">Dê um nome ao seu bot</div><div class="dsv-campo foco"><b>Ada</b></div><div class="dsv-campo dsv-campo-erro"><b>ada@</b></div><p class="dsv-erro">Use só letras, números e espaço.</p>
  <div class="dsv-bts"><span class="dsv-chave on"><i></i></span><span class="dsv-chave"><i></i></span><span class="dsv-select">Automático ${IC.seta}</span><span class="dsv-seg"><span>Manual</span><span class="on">Automático</span><span>Total</span></span></div>
  <h3>Chips e atalhos</h3>
  <div class="dsv-bts"><span class="dsv-chip ok"><i></i>Ativo</span><span class="dsv-chip">Pausada</span><span class="dsv-chip aviso"><i></i>Sua vez</span><span class="dsv-chip novo">Novo</span><span class="dsv-chip perigo">× Falhou</span></div>
  <div class="dsv-bts dsv-kbds"><kbd class="ds-kbd">⌘</kbd><kbd class="ds-kbd">K</kbd><small>·</small><kbd class="ds-kbd">⌘</kbd><kbd class="ds-kbd">B</kbd><small>·</small><kbd class="ds-kbd">Esc</kbd></div>
  <h3>Balões</h3>
  <div class="dsv-balao"><span>Põe as duas no ciclo atual</span></div><p class="dsv-bot">O bot fala sem balão, direto na conversa.</p>
  <h3>Avatar · formas do nod</h3>
  <div class="dsv-formas">${([["shape-circle", "c-blue", "Círculo"], ["shape-pebble", "c-purple", "Seixo"], ["shape-square", "c-black", "Quadrado"], ["shape-capsule", "c-amber", "Cápsula"], ["shape-triangle", "c-orange", "Triângulo"], ["shape-hex", "c-teal", "Hexágono"], ["shape-cloud", "c-pink", "Nuvem"], ["shape-drop", "c-green", "Gota"]] as [FormaAgente, CorAgente, string][]).map(([f, c, n]) => `<div>${m(f, c)}<small>${n}</small></div>`).join("")}</div>
  <h3>Avatar · estados</h3>
  <div class="dsv-estados">${([["disponivel", "Parado", "sem turno"], ["pensando", "Pensando", "turno na fila"], ["trabalhando", "Trabalhando", "turno rodando"], ["aguardando_aprovacao", "Aguardando aprovação", "aprovação pendente"]] as [Parameters<typeof htmlMascote>[2], string, string][]).map(([e, n, s]) => `<div>${m("shape-pebble", "c-purple", e, 56)}<b>${n}</b><small>${s}</small></div>`).join("")}</div>
  <h3>Avatar · tamanhos</h3>
  <div class="dsv-tamanhos">${[20, 24, 36, 44, 72].map((t) => `<div>${m("shape-circle", "c-blue", "disponivel", t)}<small>${t}</small></div>`).join("")}</div>
</section>`;

const app = document.getElementById("vitrine");
/** O valor de cada superfície sai do token de verdade (o hex que o tema calcula agora). */
function valoresDasSuperficies(raiz: HTMLElement): void {
  for (const el of raiz.querySelectorAll<HTMLElement>(".dsv-sup")) {
    const amostra = el.querySelector<HTMLElement>(".dsv-amostra");
    const legenda = el.querySelector("small");
    if (!amostra || !legenda || legenda.textContent?.startsWith("base")) continue;
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(amostra).backgroundColor);
    if (m) legenda.textContent = `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }
}
if (app) {
  app.innerHTML = `<header class="dsv-topo">${m("shape-pebble", "c-black", "disponivel", 56)}<div><h1>nod · design system</h1><p>Novo front com o visual novo · tema ${escuro ? "escuro" : "claro"}</p></div><span class="dsv-etiquetas"><span>SF Pro</span><span>base + opacidade</span><span>Sand ${escuro ? "dark" : "light"}</span></span></header>
    <div class="dsv-grade">${cor}${tipografia}${componentes}</div>`;
  valoresDasSuperficies(app);
}
