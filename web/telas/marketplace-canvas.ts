/**
 * ADA-13 (ADR-150): o cartão "Canvas · Do nod" do Marketplace e a gaveta dele. É um app nativo (não um conector):
 * instalar é da pessoa; o nível é por bot (Nenhum · Ver e comentar · Criar e publicar). Dar acesso fica só na tela
 * (`canvas.dar_acesso` é `falta` no chat: um bot se dar acesso seria escalada de privilégio). O estado vem de
 * GET /api/canvas/app, guardado aqui (lido uma vez quando o Marketplace aparece; cada ação devolve o novo).
 */
import type { AppCanvasDto, NivelCanvasDto } from "../../src/contracts/canvas.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { meusBots } from "./app-acesso.ts";

export const SLUG_CANVAS = "canvas";
export const ROTULO_NIVEL_CANVAS: Readonly<Record<"nenhum" | NivelCanvasDto, string>> = { nenhum: "Nenhum", ver_comentar: "Ver e comentar", criar_publicar: "Criar e publicar" };

type Situacao = { app: AppCanvasDto | null; erro: boolean };
let atual: Situacao = { app: null, erro: false };
let lendo = false;
/** null = sem sessão ainda (não lê; o próximo desenho tenta). */
let ler: (() => Promise<AppCanvasDto> | null) | null = null;
let aoMudar: () => void = () => undefined;

/** O main liga a leitura (a API) e o redesenho. */
export function configurarAppCanvas(o: { ler: () => Promise<AppCanvasDto> | null; aoMudar: () => void }): void { ler = o.ler; aoMudar = o.aoMudar; }
/** Reabrir o Marketplace tenta de novo depois de uma falha. */
export function esquecerErroDoCanvas(): void { if (atual.erro) atual = { app: null, erro: false }; }
/** A resposta de uma ação (instalar, desinstalar, nível) já é o estado novo. */
export function guardarAppCanvas(app: AppCanvasDto): void { atual = { app, erro: false }; aoMudar(); }

function lerSeFalta(): void {
  // Uma falha não relê sozinha a cada desenho (o redesenho do fim chamaria de novo): só ao reabrir o Marketplace.
  if (atual.app || atual.erro || lendo || !ler) return;
  const p = ler();
  if (!p) return;
  lendo = true;
  void p.then((app) => { atual = { app, erro: false }; }, () => { atual = { app: null, erro: true }; }).finally(() => { lendo = false; aoMudar(); });
}

const ICONE_CANVAS = '<span class="app-logo cv-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.25" y="4.5" width="8.25" height="6" rx="1.5"/><rect x="13.5" y="4.5" width="8.25" height="6" rx="1.5"/><rect x="2.25" y="14.25" width="8.25" height="6" rx="1.5"/><path d="M13.5 17.25h8.25"/></svg></span>';
export const DESCRICAO_CANVAS = "Os protótipos do Gil num canvas: as jornadas lado a lado, cada tela no tamanho real, com pinos e post-its que o bot lê.";

export function nivelCanvasDe(app: AppCanvasDto | null, agenteId: string): "nenhum" | NivelCanvasDto {
  return app?.acessos.find((a) => a.agenteId === agenteId)?.nivel ?? "nenhum";
}

export function cartaoCanvas(estado: Pick<Estado, "frota" | "sessao">, selecionado: boolean): string {
  lerSeFalta();
  const app = atual.app;
  const instalado = app?.instalado === true;
  const usam = app?.acessos.length ?? 0;
  const pil = instalado ? '<span class="pilula pilula-ok">Instalado</span>' : "";
  const acao = !app
    ? (atual.erro ? '<span class="mudo">Não deu para ler</span>' : '<span class="mudo">…</span>')
    : instalado
      ? `<span class="mkt-uso${usam ? "" : " mudo"}">${usam ? `${usam === 1 ? `${esc(meusBots(estado).find((b) => b.id === app.acessos[0]?.agenteId)?.nome ?? "1 bot")} usa` : `${usam} bots usam`}` : "Nenhum bot usa ainda"}</span>`
      : botao("instalar-canvas", "Instalar", { classe: "sm" });
  return `<article class="app-card${instalado ? " sit-conectado" : " sit-nao_conectado"}${selecionado ? " selected" : ""}" data-app-busca="canvas do nod protótipos design telas" id="app-${SLUG_CANVAS}">
    <button type="button" class="app-card-abrir" data-act="abrir-app" data-id="${SLUG_CANVAS}" aria-label="Ver Canvas"></button>
    <div class="app-card-heading">${ICONE_CANVAS}<span class="app-card-nome"><h3>Canvas</h3><small>Do nod</small></span>${pil}</div>
    <p>${esc(DESCRICAO_CANVAS)}</p>
    <div class="app-card-actions">${acao}</div>
  </article>`;
}

function seletor(agenteId: string, nome: string, n: "nenhum" | NivelCanvasDto): string {
  const op = (x: "nenhum" | NivelCanvasDto): string => `<button type="button" class="seg${x === n ? " ativo" : ""}" data-act="nivel-canvas" data-id="${esc(agenteId)}" data-nivel="${x}" aria-pressed="${x === n}">${esc(ROTULO_NIVEL_CANVAS[x])}</button>`;
  return `<div class="segmentado" role="group" aria-label="${esc(`Acesso de ${nome} ao Canvas`)}">${op("nenhum")}${op("ver_comentar")}${op("criar_publicar")}</div>`;
}

/** ADA-228 (J1-2): a prévia da gaveta, como no protótipo: duas jornadas de três telas em esboço, com a tela que mudou
 *  marcada. Só CSS (cv-gav-*), sem imagem: segue o tema e não pesa. */
const esboco = (miolo: string): string => `<span class="cv-gav-t"><span class="cv-gav-mini"><i class="cv-sk-sb"></i>${miolo}</span></span>`;
const QUADRO = '<i class="cv-sk-h"></i>' + [[28, 34], [52, 34], [76, 34], [28, 62], [52, 62]].map(([l, t]) => `<i class="cv-sk-card" style="left:${l}%;top:${t}%"></i>`).join("");
const LISTA = '<i class="cv-sk-h"></i><i class="cv-sk-tile" style="left:28%"></i><i class="cv-sk-tile" style="left:46%"></i><i class="cv-sk-tile" style="left:64%"></i><i class="cv-sk-wide"></i>';
const CHAT = '<i class="cv-sk-b cv-sk-r" style="top:22%;width:26%"></i><i class="cv-sk-b" style="top:38%;width:40%"></i><i class="cv-sk-b cv-sk-r" style="top:58%;width:22%"></i><i class="cv-sk-comp"></i>';
const NOVO = '<i class="cv-sk-nv" style="left:55%;top:40%"></i>';
const fila = (telas: string[]): string => `<span class="cv-gav-fila">${telas.map(esboco).join('<span class="cv-gav-seta"></span>')}</span>`;
export const PREVIA_CANVAS = `<div class="cv-gav-previa" aria-hidden="true"><span class="cv-gav-mundo">${fila([QUADRO, QUADRO + NOVO, LISTA])}${fila([CHAT, CHAT + NOVO, LISTA])}</span></div>`;
const TEXTO_GAVETA = "O bot monta e atualiza canvas de telas pelo chat. Você abre na página do bot, dá zoom, abre a tela em tamanho real e comenta; o bot lê os comentários.";

export function gavetaCanvas(estado: Pick<Estado, "frota" | "sessao">): string {
  lerSeFalta();
  const app = atual.app;
  const instalado = app?.instalado === true;
  // ADA-228 (J1-2, Marlon 11/11): sem o card "O que os bots podem fazer": o seletor de cada bot já se explica.
  let corpo: string;
  let rodape: string;
  if (!app) {
    corpo = `<p class="gaveta-desc">${atual.erro ? "Não deu para ler o Canvas agora." : "Lendo…"}</p>`;
    rodape = "";
  } else if (!instalado) {
    corpo = `${PREVIA_CANVAS}<p class="cv-gav-txt">${esc(TEXTO_GAVETA)}</p><section class="gaveta-secao"><h3>Como funciona</h3><ol class="como"><li>Instale o Canvas: os dados ficam no nod, nada sai para outro serviço.</li><li>Escolha quais bots podem usar, e com qual nível.</li><li>O bot ganha a página Canvas na pílula e a ferramenta no chat.</li></ol></section>`;
    rodape = botao("instalar-canvas", "Instalar Canvas", { classe: "pri largo" });
  } else {
    const bots = meusBots(estado);
    const linhas = bots.map((a) => `<div class="quem-linha">${iconeAgente(a, "sm")}<div class="quem-nome"><b>${esc(a.nome)}</b><small>${esc(a.titulo || "Seu bot")}</small></div>${seletor(a.id, a.nome, nivelCanvasDe(app, a.id))}</div>`).join("");
    corpo = `${PREVIA_CANVAS}<p class="cv-gav-txt">${esc(TEXTO_GAVETA)}</p>` +
      `<section class="gaveta-secao"><h3>Quem usa</h3>${bots.length ? `<div class="quem-lista">${linhas}</div>` : '<p class="mudo">Você ainda não tem bots.</p>'}<p class="mudo">Quem pode criar ganha a página Canvas na pílula. Quem só vê e comenta abre os canvas que receber, sem página própria.</p></section>`;
    rodape = `<span></span>${botao("desinstalar-canvas", "Desinstalar", { classe: "link perigo" })}`;
  }
  return `<div class="gaveta-fundo" data-act="fechar-gaveta"></div>
  <aside class="gaveta cv-gaveta" role="dialog" aria-modal="true" aria-label="Canvas">
    <div class="gaveta-cab">${ICONE_CANVAS}<div><h2>Canvas</h2><small>Do nod · sem conta, sem chave</small></div>${botao("fechar-gaveta", "×", { classe: "gaveta-fechar", aria: "Fechar" })}</div>
    <div class="gaveta-corpo">${corpo}</div>
    <div class="gaveta-rodape">${rodape}</div>
  </aside>`;
}
