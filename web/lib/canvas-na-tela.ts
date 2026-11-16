/**
 * ADA-13 (ADR-150) e ADA-228: a página Canvas do bot, na área de Trabalho, fiel ao protótipo v4 da ADA-13. Sem cabeçalho
 * e sem painel: a barra de vidro ao lado da pílula do bot (nome ▾, versão ▾, ‹ onde ›, zoom, Comentar, Nota, Apresentar,
 * Tela cheia, Enviar N ›), os avisos logo abaixo, o mundo das jornadas no palco, o popover do pino, o input de vidro
 * embaixo e o balão do bot acima dele. O HTML é de web/lib/canvas-html.ts e as contas, de web/lib/canvas-motor.ts; o HTML
 * do protótipo é dado e só roda no iframe sem mesma origem, com a CSP sem rede.
 *
 * Comentar é em rodada (J5): os pinos e as notas ficam em rascunho no aparelho até "Enviar N ›", que grava todos com o
 * mesmo número de rodada e põe o recibo na conversa do bot.
 */
import type { CanvasItemDto, ComentarioCanvasDto, VersaoCanvasDto, VistaCanvasDto } from "../../src/contracts/canvas.ts";
import type { Api } from "./api.ts";
import { SANDBOX_ARTEFATO } from "./artefato.ts";
import {
  balaoComFrame, enderecoDe, htmlDaBarra, htmlDaLista, htmlDasNotas, htmlDoAviso, htmlDoBalao, htmlDoComp, htmlDoMundo, htmlDosPinos, htmlDoVazio,
  htmlMenuNome, htmlMenuVersoes, htmlPopNovo, htmlThread, nomeCurto, numerarPinos, origemCurta, perguntaSobre, reciboDaRodada,
  type Aviso, type Balao, type Filtro, type Rascunho,
} from "./canvas-html.ts";
import {
  ajustarEntre, ajustarLargura, caixaDaFileira, canvasDaUrl, chaveOndeParou, depoisDaBusca, documentoDaTela, escolherVivos, fatorDaRoda, fracaoNaTela,
  gravarOndeParou, hashesQueFaltam, ignorarPonteiro, lerHash, lerOndeParou, montarLayout, noMundo, tamanhoReal, telaNoPonto, urlDoCanvas, visiveis,
  zoomNoPonto, type Layout, type Vista,
} from "./canvas-motor.ts";
import { esc } from "./escape.ts";

export interface CanvasNaTela {
  /** Põe a página no host (idempotente: o mesmo host e bot só redesenham o que mudou). */
  montar(host: HTMLElement, agenteId: string, nome: string): void;
  /** `canvas.mudou` do bot à vista relê a lista e o canvas aberto; os `turno.*` da conversa alimentam o balão. */
  aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void;
  /** O card do chat: a próxima montagem (ou a de agora) abre este canvas, e o endereço (#Jx-y), se vier. */
  querAbrir(canvasId: string, endereco?: string | null): void;
}

export type DepsCanvasNaTela = {
  api: () => Api | null;
  /** A conversa do bot à vista (o recibo da rodada e o input de vidro vão para ela). */
  conversa?: () => string | null;
  /** "ver na conversa" / "abrir": volta à Conversa na pílula. */
  irParaConversa?: () => void;
  /** ADA-228 (J4-2): o mascote do bot (HTML), para a fala dele na conversa do pino. */
  mascote?: (agenteId: string) => string | null;
};

const PALCO = { topo: 72, base: 88 };
/** Acima disto, o "onde" da barra é a tela do centro; abaixo, a jornada. */
const ZOOM_ONDE_TELA = 0.35;
const K_MAX = 12.5;
const ZOOM_LONGE = 0.2;
const guardar = (win: Window | null, chave: string, valor: string | null): void => {
  try { if (valor === null) win?.localStorage.removeItem(chave); else win?.localStorage.setItem(chave, valor); } catch { /* sem armazenamento */ }
};
const ler = (win: Window | null, chave: string): string | null => { try { return win?.localStorage.getItem(chave) ?? null; } catch { return null; } };
const chaveRodada = (id: string): string => `nod.canvas.rodada.${id}`;
const chaveVista = (id: string): string => `nod.canvas.visto.${id}`;
const chaveOrigem = (id: string): string => `nod.canvas.origem.${id}`;
const chaveUltimo = (ag: string): string => `nod.canvas.ultimo.${ag}`;

/** Os rascunhos guardados no aparelho, por canvas; o que não tem a forma certa sai. */
/** ADA-228 (J7-1): o clique num canvas do menu ou da lista. O que já está aberto, no menu, só fecha o menu ("topo");
 *  na lista (Todos), volta para ele ("voltar"), que o abrir(id) sozinho não redesenha; outro canvas abre ("abrir"). */
/** J6-2: o protótipo recém-importado abre com todas as fileiras à vista; o resto abre na largura (J1). */
export const vistaInicial = (importadoAgora: boolean): "tudo" | "largura" => (importadoAgora ? "tudo" : "largura");
export const passoDoAbrir = (id: string | undefined, aberto: string | null, todos: boolean): "topo" | "voltar" | "abrir" =>
  id && id === aberto ? (todos ? "voltar" : "topo") : "abrir";

export function lerRascunhos(bruto: string | null): Rascunho[] {
  if (!bruto) return [];
  try {
    const v: unknown = JSON.parse(bruto);
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is Rascunho => !!r && typeof r === "object" && typeof (r as Rascunho).id === "string" && ((r as Rascunho).tipo === "pino" || (r as Rascunho).tipo === "nota")
      && typeof (r as Rascunho).endereco === "string" && typeof (r as Rascunho).texto === "string" && (r as Rascunho).texto.trim().length > 0).slice(0, 200);
  } catch { return []; }
}

export function criarCanvasNaTela(doc: Document, o: DepsCanvasNaTela): CanvasNaTela {
  const win = doc.defaultView;
  let host: HTMLElement | null = null;
  let agenteId: string | null = null;
  let nome = "";
  let lista: CanvasItemDto[] | null = null;
  let erroLista = false;
  let todos = false;
  let filtro: Filtro = "todos";
  let busca = "";
  let aberto: string | null = null;
  let dados: VistaCanvasDto | null = null;
  /** A versão antiga à vista (J5-6, só leitura) e a estrutura dela. */
  let vendo: { versao: number; dados: VistaCanvasDto } | null = null;
  let versoes: VersaoCanvasDto[] | null = null;
  let comparar = false;
  let layout: Layout | null = null;
  let v: Vista = { x: 0, y: 0, zoom: 1 };
  let real: string | null = null;
  let modo: "pino" | "nota" | null = null;
  let novo: { endereco: string; x: number; y: number; rasc?: string } | null = null;
  let notaEm: string | null = null;
  let rascunhos: Rascunho[] = [];
  let thread: string | null = null;
  let erroThread = "";
  let enviando = false;
  let menu: "nome" | "ver" | null = null;
  let buscaMenu = "";
  let apresentando: string | null = null;
  let escalaApresentando = 1;
  let cheia = false;
  let balao: Balao | null = null;
  let relogio = 0;
  /** Avisos de passagem (rodada enviada, link copiado, erro) e os que a pessoa fechou. */
  let passageiros: Aviso[] = [];
  const fechados = new Set<string>();
  /** "Esta folha agora é a vN" (J4-7): a versão que a pessoa ainda não tinha visto, nesta abertura. */
  let novaVersao: number | null = null;
  let origemUmaVez = false;
  const blobs = new Map<string, string>();
  const vivos = new Map<string, HTMLIFrameElement>();
  /** A tela que navegou (2º load): o iframe sai e só volta quando a pessoa pede. */
  const fechadas = new Set<string>();
  let buscando = false;
  const ausentes = new Set<string>();
  let pausaBlobsAte = 0;
  let quadroPedido = 0;
  let pedido: { id: string; endereco: string | null } | null = null;

  // J3-3: apresentando, o input mora na camada da tela grande; quem procura por ele acha lá.
  const q = <E extends Element = HTMLElement>(sel: string): E | null => host?.querySelector<E>(sel) ?? doc.querySelector(".cv-sobre")?.querySelector<E>(sel) ?? null;
  const palco = (): HTMLElement | null => q(".cv-palco");
  const mundo = (): HTMLElement | null => q(".cv-mundo");
  const tamPalco = (): { w: number; h: number } => { const p = palco(); return { w: p?.clientWidth ?? 0, h: p?.clientHeight ?? 0 }; };
  /** A estrutura que está no palco: a da versão antiga, se a pessoa está vendo uma, ou a atual. */
  const naTela = (): VistaCanvasDto | null => vendo?.dados ?? dados;
  const velha = (): boolean => vendo !== null && !!dados && vendo.versao !== dados.canvas.versao;

  // -------------------------------------------------------------------------------------------------------------------
  // Dados

  async function lerLista(): Promise<void> {
    const api = o.api();
    const ag = agenteId;
    if (!api || !ag) return;
    try {
      const r = await api.canvasDoAgente(ag);
      if (ag !== agenteId) return;
      lista = r.canvas;
      erroLista = false;
      // J7-1: sem canvas pedido, o ícone abre o da URL, o último aberto neste aparelho ou o mais recente.
      if (!aberto && !todos && lista.length) {
        const daUrl = win ? canvasDaUrl(win.location.href) : null;
        const ultimo = ler(win, chaveUltimo(ag));
        const id = [daUrl, ultimo].find((x) => x && lista?.some((c) => c.id === x)) ?? [...lista].sort((a, b) => b.atualizadoEm - a.atualizadoEm)[0]?.id;
        if (id) { void abrir(id); return; }
      }
    } catch { if (ag === agenteId) erroLista = true; }
    if (!aberto) desenhar(); else desenharTopo();
  }

  async function abrir(id: string, o2: { manter?: boolean; endereco?: string | null } = {}): Promise<void> {
    const api = o.api();
    if (!api) return;
    const trocou = aberto !== id;
    if (trocou) soltarNota();
    aberto = id;
    todos = false;
    if (trocou) {
      dados = null; layout = null; real = null; novo = null; thread = null; notaEm = null; modo = null; menu = null; vendo = null; versoes = null; comparar = false;
      novaVersao = null; origemUmaVez = false; passageiros = []; fechados.clear();
      rascunhos = lerRascunhos(ler(win, chaveRodada(id)));
      fecharVivos(); desenhar();
      if (agenteId) guardar(win, chaveUltimo(agenteId), id);
    }
    try {
      const d = await api.verCanvas(id);
      if (aberto !== id) return;
      const mudouVersao = !dados || dados.canvas.versao !== d.canvas.versao || trocou;
      const primeira = !dados;
      dados = d;
      if (primeira) marcarVisto(d);
      if (mudouVersao && !vendo) {
        if (!primeira) { versoes = null; novaVersao = d.canvas.versao; guardar(win, chaveVista(id), String(d.canvas.versao));
          // J4-7: a versão que responde a um pedido do balão já chega marcada; a da rodada (J5-5) oferece "o que mudou".
          marcarMudou = balao !== null; if (marcarMudou) void lerVersoes(); }
        montarMundo();
        if (!o2.manter) {
          const alvo = o2.endereco ?? win?.location.hash ?? "";
          const foi = irPara(alvo, { real: false });
          if (!foi && !voltarOndeParou()) { if (vistaInicial(origemUmaVez) === "tudo") ajustarTudo(); else abrirNaLargura(); }
          marcarHash(foi ? lerHash(alvo) ? alvo.replace(/^#/, "") : undefined : null);
        } else aplicarVista();
      } else { desenharPinos(); desenharTopo(); desenharCamada(); }
    } catch {
      if (aberto === id && !dados) { const h = q(".cv-palco"); if (h) h.innerHTML = '<p class="cv-vazio">Não deu para abrir este canvas. <button type="button" class="cv-link" data-cv="reabrir">Tentar de novo</button></p>'; }
    }
  }

  /** J4-7 e J6: a versão nova desde a última visita vira aviso; a origem aparece uma vez. */
  function marcarVisto(d: VistaCanvasDto): void {
    const id = d.canvas.id;
    const visto = Number(ler(win, chaveVista(id)) ?? "0");
    if (visto > 0 && visto < d.canvas.versao) novaVersao = d.canvas.versao;
    guardar(win, chaveVista(id), String(d.canvas.versao));
    if (d.canvas.origemUrl && !ler(win, chaveOrigem(id))) { origemUmaVez = true; guardar(win, chaveOrigem(id), "1"); }
  }

  async function lerVersoes(): Promise<void> {
    const api = o.api();
    const id = aberto;
    if (!api || !id) return;
    try {
      const r = await api.versoesCanvas(id);
      if (aberto !== id) return;
      versoes = r.versoes;
    } catch { versoes = []; }
    if (dados && novaVersao) aplicarComparacao();
    desenharTopo();
  }

  /** "Ver" no ▾ (J5-6): a versão antiga entra só leitura; a atual volta ao normal. */
  async function verVersao(n: number): Promise<void> {
    const api = o.api();
    const id = aberto;
    if (!api || !id || !dados) return;
    menu = null; novo = null; thread = null; modo = null; notaEm = null;
    if (n === dados.canvas.versao) { vendo = null; montarMundo(); aplicarVista(); return; }
    try {
      const d = await api.verCanvas(id, n);
      if (aberto !== id) return;
      vendo = { versao: n, dados: d };
      montarMundo();
      aplicarVista();
    } catch { aviso({ chave: "erro-versao", tipo: "info", texto: `Não deu para abrir a v${n}.` }); }
  }

  async function buscarBlobs(): Promise<void> {
    const api = o.api();
    const d = naTela();
    if (!api || !d || !aberto || buscando) return;
    if (Date.now() < pausaBlobsAte) return;
    const quer = hashesQueFaltam(d.estrutura, [...alvosVivos()], new Set([...blobs.keys(), ...ausentes]));
    if (!quer.length) return;
    buscando = true;
    const id = aberto;
    const recebidos = new Set<string>();
    let falhou = false;
    try {
      for (let i = 0; i < quer.length; i += 80) {
        const r = await api.blobsCanvas(id, quer.slice(i, i + 80));
        for (const [h, c] of Object.entries(r.blobs)) { blobs.set(h, c); recebidos.add(h); }
      }
    } catch { falhou = true; }
    buscando = false;
    const r = depoisDaBusca(quer, recebidos, falhou, Date.now());
    pausaBlobsAte = r.pausaAte;
    for (const h of r.ausentes) ausentes.add(h);
    // Só redesenha (e com isso pede de novo o que falta) com algo novo na mão: falhar não vira laço (codex no #649).
    if (aberto === id && recebidos.size) { desenharMiniaturas(); atualizarVivos(); }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Desenho

  function desenhar(): void {
    if (!host) return;
    const antes = guardarCampos();
    if (todos || (!aberto && lista !== null && !erroLista && lista.length > 0)) {
      host.innerHTML = `<section class="cv" aria-label="Canvas"><div class="cv-topo"></div>${htmlDaLista({ lista: lista ?? [], filtro, busca, nome, miniatura: () => null })}</section>`;
    } else if (!aberto) {
      const corpo = erroLista ? '<p class="cv-vazio">Não deu para ler os canvas. <button type="button" class="cv-link" data-cv="relista">Tentar de novo</button></p>'
        : lista === null ? '<p class="cv-vazio" aria-busy="true">Lendo os canvas…</p>' : htmlDoVazio();
      host.innerHTML = `<section class="cv" aria-label="Canvas">${corpo}${htmlDoComp({ chip: null, nome, escrevendo: false, enviando })}<div class="cv-bal-host"></div></section>`;
    } else {
      host.innerHTML = `<section class="cv${velha() ? " cv-velha" : ""}" aria-label="Canvas">` +
        `<div class="cv-palco${modo === "pino" ? " cv-modo-pino" : ""}" tabindex="0" aria-label="Telas do protótipo: arraste para mover, Ctrl ou ⌘ com a roda para zoom, C comenta, N cria uma nota">` +
        `<div class="cv-mundo"></div><p class="cv-dica" aria-hidden="true">C comenta · N nota · Shift 1 ajusta</p></div>` +
        `<div class="cv-camada"></div><div class="cv-topo"></div>` +
        `${htmlDoComp({ chip: chipDoCentro(), nome, escrevendo: false, enviando })}<div class="cv-bal-host"></div></section>`;
      if (layout) { const m = mundo(); const d = naTela(); if (m && d) m.innerHTML = htmlDoMundo(layout, d.estrutura, { mudaram: mudaram(), versao: dados?.canvas.versao }); }
      if (layout) { aplicarVista(); desenharPinos(); desenharMiniaturas(); }
    }
    desenharTopo();
    desenharBalao();
    restaurarCampos(antes);
    medirBarra();
  }

  function montarMundo(): void {
    const d = naTela();
    if (!d) return;
    layout = montarLayout(d.estrutura, d.comentarios.flatMap((c) => (c.tipo === "nota" && !c.paiId && !c.arquivado && c.jornada ? [c.jornada] : [])));
    ausentes.clear(); pausaBlobsAte = 0;
    fecharVivos();
    desenhar();
  }

  /** As telas que mudaram para o contorno: com Comparar ou o aviso "o que mudou" (J4-7). */
  let marcarMudou = false;
  function mudaram(): Set<string> {
    // J5-7: vendo uma versão antiga, as telas que mudaram até a atual já vêm contornadas, como no protótipo.
    if (!marcarMudou && !comparar && !(vendo && velha())) return new Set();
    const alvo = vendo?.versao ?? dados?.canvas.versao ?? 0;
    const atual = dados?.canvas.versao ?? 0;
    // Vendo a atual, compara com a anterior; vendo uma antiga, as telas que mudaram até a atual.
    const vs = versoes ?? [];
    const ids = new Set<string>();
    if (alvo === atual) for (const x of vs.find((y) => y.versao === atual)?.mudaram ?? []) ids.add(x);
    else for (const y of vs) if (y.versao > alvo && y.versao <= atual) for (const x of y.mudaram) ids.add(x);
    return ids;
  }
  function aplicarComparacao(): void { const d = naTela(); const m = mundo(); if (layout && d && m) { m.innerHTML = htmlDoMundo(layout, d.estrutura, { mudaram: mudaram(), versao: dados?.canvas.versao }); fecharVivos(); aplicarVista(); desenharPinos(); desenharMiniaturas(); } }

  function avisos(): Aviso[] {
    const r: Aviso[] = [];
    const d = dados;
    if (!d) return passageiros;
    if (vendo && velha()) {
      const n = (versoes ?? []).filter((y) => y.versao > vendo!.versao).flatMap((y) => y.mudaram);
      const qtd = new Set(n).size;
      r.push({ chave: "velha", tipo: "velha", texto: `Vendo a v${vendo.versao} · só leitura${versoes ? ` · ${qtd} tela${qtd === 1 ? "" : "s"} mudar${qtd === 1 ? "ou" : "am"} na v${d.canvas.versao}` : ""}`, acao: { cv: "voltar-atual", rotulo: `Voltar à v${d.canvas.versao}`, forte: true } });
    }
    if (d.canvas.estado === "em_producao" && d.canvas.etapa) r.push({ chave: "vivo", tipo: "vivo", texto: `${nome} está ${d.canvas.etapa} · as prontas já aceitam comentário` });
    if (novaVersao && !vendo && novaVersao === d.canvas.versao) {
      const raizes = d.comentarios.filter((c) => !c.paiId && !c.arquivado);
      const res = raizes.filter((c) => c.resolvido && c.versao < d.canvas.versao).length;
      const ab = raizes.filter((c) => !c.resolvido).length;
      r.push({ chave: `nova-${novaVersao}`, tipo: "info", texto: `Esta folha agora é a v${novaVersao}${res ? ` · ${res} resolvido${res > 1 ? "s" : ""}` : ""}${ab ? ` · ${ab} aberto${ab > 1 ? "s" : ""}` : ""}`, acao: marcarMudou ? undefined : { cv: "o-que-mudou", rotulo: "o que mudou" }, fechar: true } as Aviso);
    }
    if (origemUmaVez && d.canvas.origemUrl) {
      const imp = d.comentarios.filter((c) => c.autorTipo === "importado" && !c.paiId).length;
      r.push({ chave: "origem", tipo: "info", texto: `Importado de ${origemCurta(d.canvas.origemUrl)}${imp ? ` · ${imp} comentário${imp > 1 ? "s" : ""} ${imp > 1 ? "vieram" : "veio"} junto` : ""}`, fechar: true });
    }
    return [...r, ...passageiros].filter((a) => !fechados.has(a.chave));
  }

  function aviso(a: Aviso, ms = 6000): void {
    passageiros = [...passageiros.filter((x) => x.chave !== a.chave), a];
    desenharTopo();
    win?.setTimeout(() => { passageiros = passageiros.filter((x) => x !== a); desenharTopo(); }, ms);
  }

  function barra(): string {
    if (todos || !aberto) {
      if (!todos || !lista) return "";
      const ultimo = aberto ?? (agenteId ? ler(win, chaveUltimo(agenteId)) : null);
      return ultimo && lista.some((c) => c.id === ultimo) ? `<div class="cv-fer" role="toolbar" aria-label="Canvas"><button type="button" class="cv-fer-bt" data-cv="voltar-canvas" aria-label="Voltar ao canvas">‹</button><span class="cv-fer-onde">Todos os canvas</span></div>` : "";
    }
    const d = dados;
    const c = d?.canvas ?? lista?.find((x) => x.id === aberto);
    if (!c) return "";
    return htmlDaBarra({
      nome: nomeCurto(c), versao: c.versao, vendo: vendo?.versao ?? null, onde: onde(), pct: v.zoom, modo, rascunhos: rascunhos.length,
      abertos: d ? d.comentarios.filter((x) => !x.paiId && !x.resolvido && !x.arquivado).length : 0, vivo: c.estado === "em_producao", enviando, menu,
      apresentando: apresentando !== null, podeLink: !!d,
      ...(apresentando ? { titulo: layout?.porId.get(apresentando)?.tela.titulo ?? "", pct: escalaApresentando } : {}),
    });
  }

  function desenharTopo(): void {
    const t = q(".cv-topo");
    if (!t) return;
    const antes = guardarCampos();
    let m = "";
    if (menu === "ver" && dados) m = htmlMenuVersoes({ canvas: nomeCurto(dados.canvas), versoes, atual: dados.canvas.versao, vendo: vendo?.versao ?? dados.canvas.versao, comparar, comentarios: dados.comentarios });
    else if (menu === "nome" && lista) m = htmlMenuNome({ lista, aberto, busca: buscaMenu, nome });
    // Menu aberto ocupa o lugar dos avisos: os dois juntos empilhavam o aviso por cima das telas.
    t.innerHTML = barra() + m + (todos || m ? "" : avisos().map(htmlDoAviso).join(""));
    restaurarCampos(antes);
  }

  function desenharMiniaturas(): void {
    if (!layout) return;
    for (const t of layout.porId.values()) {
      if (t.tela.pendente) continue;
      const el = q(`.cv-tela[data-tela="${CSS.escape(t.tela.id)}"] .cv-mini`);
      const src = t.tela.miniatura ? blobs.get(t.tela.miniatura) : undefined;
      if (el && src && /^data:image\/(webp|png|jpeg);base64,/.test(src) && !el.querySelector("img")) el.innerHTML = `<img alt="" src="${esc(src)}" draggable="false">`;
    }
  }

  function onde(): string {
    if (apresentando) return apresentando;
    if (!layout) return "";
    if (real) return real;
    const t = telaDoCentro();
    if (!t) return layout.fileiras[0]?.id ?? "";
    return v.zoom >= ZOOM_ONDE_TELA ? t : layout.porId.get(t)?.tela.jornada ?? t;
  }
  const chipDoCentro = (): string | null => apresentando ?? (layout && v.zoom >= ZOOM_ONDE_TELA ? real ?? telaDoCentro() : null);

  function aplicarVista(): void {
    const m = mundo();
    if (!m) return;
    m.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    m.style.setProperty("--cv-inv", String(1 / v.zoom));
    m.style.setProperty("--cv-k", String(Math.min(1 / v.zoom, K_MAX)));
    // De longe, as legendas, o resumo da jornada e os post-its viram ruído (e se sobrepõem): só os rótulos ficam.
    m.classList.toggle("cv-longe", v.zoom < ZOOM_LONGE);
    const pct = q(".cv-fer-pct");
    if (pct) pct.textContent = `${Math.round(v.zoom * 100)}%`;
    const on = q(".cv-fer-onde");
    if (on && !todos) on.textContent = onde();
    const chip = q(".cv-comp .cv-chip");
    const c = chipDoCentro();
    if (chip && c) chip.textContent = c;
    else if (!!chip !== !!c) { const f = q(".cv-comp"); if (f) { const txt = q<HTMLTextAreaElement>("#cv-comp-in")?.value ?? ""; f.outerHTML = htmlDoComp({ chip: c, nome, escrevendo: !!txt.trim(), enviando }); const n = q<HTMLTextAreaElement>("#cv-comp-in"); if (n) n.value = txt; } }
    for (const el of host?.querySelectorAll<HTMLElement>(".cv-tela") ?? []) el.classList.toggle("cv-real", el.dataset["tela"] === real);
    pedirVivos();
    guardarOndeParou();
    posicionarCamada();
  }

  function desenharPinos(): void {
    const d = naTela();
    if (!host || !d) return;
    const numeros = numerarPinos(d.comentarios);
    for (const el of host.querySelectorAll<HTMLElement>(".cv-tela")) {
      const id = el.dataset["tela"] ?? "";
      const box = el.querySelector(".cv-pinos");
      if (box) box.innerHTML = htmlDosPinos({ tela: id, comentarios: d.comentarios, numeros, rascunhos: velha() ? [] : rascunhos, ativo: thread, velha: velha(), novo: novo && !novo.rasc && novo.endereco === id ? novo : null });
    }
    for (const el of host.querySelectorAll<HTMLElement>(".cv-notas")) {
      const j = el.dataset["jornada"] ?? "";
      const box = el.querySelector(".cv-notas-pessoa");
      const txt = q<HTMLTextAreaElement>("#cv-nota-in")?.value;
      if (box) box.outerHTML = `<span class="cv-notas-pessoa" style="display:contents">${htmlDasNotas({ jornada: j, comentarios: d.comentarios, rascunhos: velha() ? [] : rascunhos, editando: notaEm, autor: autorDe, ...(txt !== undefined && notaEm === j ? { texto: txt } : {}) })}</span>`;
    }
  }

  // O comentário importado sempre diz que é importado: o nome vem do protótipo e não se passa pela pessoa (revisão 6 do #649, M1).
  const autorDe = (c: ComentarioCanvasDto): string =>
    c.autorTipo === "importado" ? (c.autorNome ? `${c.autorNome} · importado` : "Importado")
      : c.autorNome ?? (c.autorTipo === "pessoa" ? "Você" : nome);

  /** O ponto do pino na tela (px do palco), para o popover; null se a tela não está no layout. */
  function pontoNaTela(endereco: string, fx: number, fy: number): { x: number; y: number } | null {
    const t = layout?.porId.get(endereco);
    if (!t) return null;
    return { x: v.x + (t.x + fx * t.w) * v.zoom, y: v.y + (t.y + fy * t.h) * v.zoom };
  }
  const prenderPop = (p: { x: number; y: number }): { x: number; y: number } => {
    const t = tamPalco();
    return { x: Math.max(12, Math.min(p.x + 14, t.w - 302)), y: Math.max(PALCO.topo, Math.min(p.y - 12, t.h - 220)) };
  };

  function desenharCamada(): void {
    const c = q(".cv-camada");
    if (!c) return;
    const antes = guardarCampos();
    let h = "";
    const d = naTela();
    if (novo) {
      const p = pontoNaTela(novo.endereco, novo.x, novo.y);
      const r = novo.rasc ? rascunhos.find((x) => x.id === novo?.rasc) : undefined;
      if (p) h = htmlPopNovo({ endereco: novo.endereco, ...prenderPop(p), ...(r ? { texto: r.texto, editando: true } : {}) });
    } else if (thread && d) {
      const raiz = d.comentarios.find((x) => x.id === thread);
      if (raiz) {
        const p = raiz.tipo === "pino" && raiz.telaId ? pontoNaTela(raiz.telaId, raiz.x ?? 0.5, raiz.y ?? 0.5) : centroDasNotas(raiz.jornada ?? "");
        const respostas = d.comentarios.filter((x) => x.paiId === raiz.id).sort((a, b) => a.criadoEm - b.criadoEm);
        if (p) h = htmlThread({ raiz, respostas, ...prenderPop(p), autor: autorDe, leitura: velha(), enviando, mascote: (x) => (x.autorAgenteId ? o.mascote?.(x.autorAgenteId) ?? null : null), ...(erroThread ? { erro: erroThread } : {}) });
      }
    }
    c.innerHTML = h;
    restaurarCampos(antes);
  }
  function centroDasNotas(j: string): { x: number; y: number } | null {
    const el = q(`.cv-notas[data-jornada="${CSS.escape(j)}"]`);
    const p = palco();
    if (!el || !p) return null;
    const a = el.getBoundingClientRect();
    const b = p.getBoundingClientRect();
    return { x: a.right - b.left, y: a.top - b.top + 12 };
  }
  function posicionarCamada(): void {
    const pop = q(".cv-camada .cv-pop");
    if (!pop) return;
    let p: { x: number; y: number } | null = null;
    if (novo) p = pontoNaTela(novo.endereco, novo.x, novo.y);
    else if (thread) {
      const raiz = naTela()?.comentarios.find((x) => x.id === thread);
      p = raiz?.tipo === "pino" && raiz.telaId ? pontoNaTela(raiz.telaId, raiz.x ?? 0.5, raiz.y ?? 0.5) : centroDasNotas(raiz?.jornada ?? "");
    }
    if (!p) return;
    const r = prenderPop(p);
    pop.style.left = `${Math.round(r.x)}px`;
    pop.style.top = `${Math.round(r.y)}px`;
  }

  function desenharBalao(): void {
    const b = q(".cv-bal-host");
    if (b) b.innerHTML = balao ? htmlDoBalao(balao, agenteId ? o.mascote?.(agenteId) ?? null : null) : "";
  }

  // Os campos que a pessoa escrevia sobrevivem ao redesenho (versão nova chegando; M7 do #649).
  function guardarCampos(): { valores: Map<string, string>; foco: string | null } {
    const valores = new Map<string, string>();
    for (const el of host?.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea[id], input[id]") ?? []) valores.set(el.id, el.value);
    const ativo = doc.activeElement as HTMLElement | null;
    return { valores, foco: ativo && host?.contains(ativo) && ativo.id ? ativo.id : null };
  }
  function restaurarCampos(a: { valores: Map<string, string>; foco: string | null }): void {
    for (const [id, valor] of a.valores) { const el = host?.querySelector<HTMLTextAreaElement | HTMLInputElement>(`#${CSS.escape(id)}`); if (el && !el.value && valor) el.value = valor; }
    if (a.foco) { const el = host?.querySelector<HTMLElement>(`#${CSS.escape(a.foco)}`); if (el && doc.activeElement !== el) { el.focus(); if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) { const n = el.value.length; el.setSelectionRange(n, n); } } }
  }

  /** A barra começa logo depois da pílula do bot (que mora no cabeçalho, fora do host). */
  let medindo: ResizeObserver | null = null;
  function medirBarra(): void {
    if (!host || !win) return;
    const pil = doc.querySelector<HTMLElement>(".cabecalho-pilula .qd-pil") ?? doc.querySelector<HTMLElement>(".qd-pil");
    const medir = (): void => {
      if (!host || !pil) return;
      const a = pil.getBoundingClientRect();
      const b = host.getBoundingClientRect();
      if (a.width > 0) host.style.setProperty("--cv-barra-x", `${Math.max(12, Math.round(a.right - b.left + 10))}px`);
    };
    medir();
    if (pil && typeof ResizeObserver !== "undefined") { medindo?.disconnect(); medindo = new ResizeObserver(medir); medindo.observe(pil); medindo.observe(host); }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Iframes vivos (no máximo 6, a partir de 50%; fora da vista saem)

  function alvosVivos(): Set<string> {
    if (!layout) return new Set();
    const t = tamPalco();
    const ids = escolherVivos(visiveis(layout, v, t), v, t, new Set(vivos.keys())).filter((id) => !layout?.porId.get(id)?.tela.pendente);
    if (real && !ids.includes(real)) ids.splice(Math.max(0, ids.length - 1), 1, real);
    return new Set(ids.filter((id) => !fechadas.has(id)));
  }

  function pedirVivos(): void {
    if (quadroPedido) return;
    quadroPedido = win?.requestAnimationFrame(() => { quadroPedido = 0; atualizarVivos(); }) ?? 0;
    if (!win) atualizarVivos();
  }

  function fecharVivos(): void { for (const f of vivos.values()) f.remove(); vivos.clear(); fechadas.clear(); }

  function iframeDaTela(id: string, aoNavegar: () => void): HTMLIFrameElement | null {
    const d = naTela();
    const t = layout?.porId.get(id);
    const html = t ? blobs.get(t.tela.html) : undefined;
    if (!d || !t || html === undefined) return null;
    const e = d.estrutura;
    if ([...e.css, ...e.js].some((h) => !blobs.has(h))) return null;
    const f = doc.createElement("iframe");
    f.className = "cv-frame";
    f.setAttribute("sandbox", SANDBOX_ARTEFATO);
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("title", t.tela.titulo);
    f.tabIndex = -1;
    let loads = 0;
    // ADR-150 §4: a tela que navega (o 2º load) fecha; a miniatura fica e a pessoa reabre se quiser.
    f.addEventListener("load", () => { loads += 1; if (loads >= 2) aoNavegar(); });
    f.srcdoc = documentoDaTela({ html, css: e.css.map((h) => blobs.get(h) ?? ""), js: e.js.map((h) => blobs.get(h) ?? ""), novo: t.tela.novo, tamanho: t.tela.tamanho });
    return f;
  }

  function atualizarVivos(): void {
    const d = naTela();
    if (!layout || !d || !host) return;
    const alvo = alvosVivos();
    for (const [id, f] of vivos) if (!alvo.has(id)) { f.remove(); vivos.delete(id); }
    let falta = false;
    for (const id of alvo) {
      if (vivos.has(id)) continue;
      const caixa = q(`.cv-tela[data-tela="${CSS.escape(id)}"]`);
      if (!caixa) continue;
      const f = iframeDaTela(id, () => { f?.remove(); vivos.delete(id); fechadas.add(id); caixa.classList.add("cv-fechada"); });
      if (!f) { falta = true; continue; }
      caixa.insertBefore(f, caixa.querySelector(".cv-pinos"));
      vivos.set(id, f);
    }
    if (falta || hashesQueFaltam(d.estrutura, [], new Set([...blobs.keys(), ...ausentes])).length) void buscarBlobs();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Navegação

  // ADA-228: a vista de cada canvas fica no aparelho; o #Jx-y sempre ganha dela.
  let guardarEm = 0;
  function guardarOndeParou(): void {
    if (!win || !aberto || real || vendo) return;
    const id = aberto;
    win.clearTimeout(guardarEm);
    guardarEm = win.setTimeout(() => guardar(win, chaveOndeParou(id), gravarOndeParou(v)), 300);
  }
  function voltarOndeParou(): boolean {
    if (!aberto) return false;
    const salvo = lerOndeParou(ler(win, chaveOndeParou(aberto)));
    if (!salvo) return false;
    real = null; v = salvo; aplicarVista();
    return true;
  }

  /** Ao abrir (J2-3): as jornadas na largura, no máximo 50%, a primeira fileira logo abaixo da barra. */
  function abrirNaLargura(): void { if (layout) { real = null; v = ajustarLargura(layout.limites, tamPalco(), PALCO); aplicarVista(); } }
  /** Shift 1, 0 e o clique no %: tudo cabe entre a barra e o input. */
  function ajustarTudo(): void { if (layout) { real = null; v = ajustarEntre(layout.limites, tamPalco(), PALCO); aplicarVista(); } }

  function irPara(endereco: string, o2: { real?: boolean } = {}): boolean {
    if (!layout) return false;
    const alvo = lerHash(endereco);
    if (!alvo) return false;
    if ("tela" in alvo) {
      const t = layout.porId.get(alvo.tela);
      if (!t) return false;
      if (o2.real) { real = t.tela.id; v = tamanhoReal(t, tamPalco()); } else { real = null; v = ajustarEntre(t, tamPalco(), PALCO); }
    } else {
      const f = layout.fileiras.find((x) => x.id === alvo.jornada);
      if (!f) return false;
      real = null;
      v = ajustarEntre(caixaDaFileira(f), tamPalco(), PALCO);
    }
    aplicarVista();
    return true;
  }

  function marcarHash(endereco?: string | null): void {
    if (!win) return;
    const n = urlDoCanvas(win.location.href, aberto, endereco);
    if (n !== win.location.pathname + win.location.search + win.location.hash) win.history.replaceState(win.history.state, "", n);
  }

  function telaDoCentro(): string | null {
    if (!layout) return null;
    const t = tamPalco();
    const c = noMundo(v, t.w / 2, PALCO.topo + (t.h - PALCO.topo - PALCO.base) / 2);
    let melhor: string | null = null;
    let dist = Infinity;
    for (const x of layout.porId.values()) {
      const d = Math.hypot(Math.max(x.x - c.x, 0, c.x - x.x - x.w), Math.max(x.y - c.y, 0, c.y - x.y - x.h));
      if (d < dist) { dist = d; melhor = x.tela.id; }
    }
    return melhor;
  }
  const jornadaDoCentro = (): string | null => { const t = telaDoCentro(); return t ? layout?.porId.get(t)?.tela.jornada ?? null : layout?.fileiras[0]?.id ?? null; };

  /** ‹ › da barra: de tela em tela de perto, de jornada em jornada de longe; apresentando, a tela seguinte. */
  function andar(passo: -1 | 1): void {
    if (!layout) return;
    const ordem = layout.fileiras.flatMap((f) => f.telas.filter((t) => !t.tela.pendente).map((t) => t.tela.id));
    if (apresentando) { const i = ordem.indexOf(apresentando); const n = ordem[i + passo]; if (n) apresentar(n); return; }
    const aqui = onde();
    if (lerHash(aqui) && "jornada" in (lerHash(aqui) ?? {})) {
      const js = layout.fileiras.map((f) => f.id);
      const n = js[js.indexOf(aqui) + passo];
      if (n && irPara(n)) marcarHash(n);
    } else {
      const n = ordem[ordem.indexOf(aqui) + passo];
      if (n && irPara(n, { real: !!real })) marcarHash(n);
    }
    desenharTopo();
  }

  function sairDoReal(): void { if (real) { real = null; marcarHash(null); aplicarVista(); } }

  // -------------------------------------------------------------------------------------------------------------------
  // Apresentar (a tela grande, sem o mundo) e Tela cheia

  function apresentar(id: string): void {
    apresentando = id;
    let s = doc.querySelector<HTMLElement>(".cv-sobre");
    if (!s) { s = doc.createElement("div"); s.className = "cv-sobre"; s.setAttribute("role", "dialog"); doc.body.append(s); ligar(s); }
    const t = layout?.porId.get(id);
    s.setAttribute("aria-label", `${id} em tamanho real`);
    const vw = win?.innerWidth ?? 1440;
    const vh = win?.innerHeight ?? 900;
    // J3-3: o input segue embaixo, por cima da tela grande; a tela cabe acima dele.
    const k = t ? Math.min(1, (vw - 80) / t.w, (vh - 170) / t.h) : 1;
    escalaApresentando = k;
    doc.body.classList.add("cv-apresentando");
    s.innerHTML = `<div class="cv-topo" style="left:20px">${barra()}</div><div class="cv-sobre-palco"><div class="cv-real-grande" style="width:${t?.w ?? 1440}px;height:${t?.h ?? 900}px;transform:translateX(-50%) scale(${k})"></div></div>`;
    const caixa = s.querySelector(".cv-real-grande");
    const f = iframeDaTela(id, () => { /* navegou dentro: fica, é a apresentação */ });
    if (caixa) {
      if (f) caixa.append(f);
      else { const src = t?.tela.miniatura ? blobs.get(t.tela.miniatura) : undefined; caixa.innerHTML = src ? `<img alt="" src="${esc(src)}">` : `<p class="cv-vazio">${esc(t?.tela.titulo ?? id)}</p>`; void buscarBlobs(); }
    }
    // J3-3: o input segue embaixo, por cima da tela grande (vai para a camada; volta ao sair).
    const comp = q(".cv-comp");
    if (comp) s.append(comp);
    s.tabIndex = -1;
    s.focus();
  }
  function sairDeApresentar(): void { apresentando = null; doc.body.classList.remove("cv-apresentando"); const comp = doc.querySelector(".cv-sobre .cv-comp"); const casa = q(".cv-bal-host"); if (comp && casa) casa.before(comp); doc.querySelector(".cv-sobre")?.remove(); desenharTopo(); palco()?.focus(); }
  function alternarCheia(): void {
    cheia = !cheia;
    host?.closest(".app")?.classList.toggle("cv-cheia", cheia);
    doc.querySelector(".app")?.classList.toggle("cv-cheia", cheia);
    win?.requestAnimationFrame(() => { medirBarra(); pedirVivos(); });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Comentar em rodada (J4-2, J5-1..3)

  const salvarRascunhos = (): void => { if (aberto) guardar(win, chaveRodada(aberto), rascunhos.length ? JSON.stringify(rascunhos) : null); };
  const novoId = (): string => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /** Fecha o editor de nota sem perder o que a pessoa escreveu: o texto vira rascunho do canvas aberto (Esc, outro modo, outro canvas). */
  function soltarNota(): void {
    if (!notaEm) return;
    const t = q<HTMLTextAreaElement>("#cv-nota-in")?.value.trim() ?? "";
    if (t) { rascunhos = [...rascunhos, { id: novoId(), tipo: "nota", endereco: notaEm, texto: t }]; salvarRascunhos(); }
    notaEm = null;
  }

  function trocarModo(m: "pino" | "nota" | null): void {
    if (velha()) return;
    soltarNota();
    modo = modo === m ? null : m;
    novo = null; thread = null;
    if (modo === "nota") { notaEm = jornadaDoCentro(); modo = null; desenharPinos(); win?.requestAnimationFrame(() => q<HTMLTextAreaElement>("#cv-nota-in")?.focus()); }
    else notaEm = null;
    palco()?.classList.toggle("cv-modo-pino", modo === "pino");
    desenharTopo(); desenharCamada(); desenharPinos();
  }

  function guardarNovo(texto: string): void {
    if (!novo || !texto.trim()) return;
    const t = texto.trim();
    if (novo.rasc) rascunhos = rascunhos.map((r) => (r.id === novo?.rasc ? { ...r, texto: t } : r));
    else rascunhos = [...rascunhos, { id: novoId(), tipo: "pino", endereco: novo.endereco, x: novo.x, y: novo.y, texto: t }];
    novo = null;
    salvarRascunhos();
    desenharPinos(); desenharCamada(); desenharTopo();
    palco()?.focus();
  }
  function guardarNota(texto: string): void {
    if (!notaEm || !texto.trim()) return;
    rascunhos = [...rascunhos, { id: novoId(), tipo: "nota", endereco: notaEm, texto: texto.trim() }];
    notaEm = null;
    salvarRascunhos();
    desenharPinos(); desenharTopo();
    palco()?.focus();
  }

  /** "Enviar N ›": grava cada rascunho com a mesma rodada, na ordem; o que falhar fica no rascunho. Depois, o recibo no chat. */
  async function enviarRodada(): Promise<void> {
    const api = o.api();
    const id = aberto;
    const d = dados;
    if (!api || !id || !d || enviando || !rascunhos.length) return;
    enviando = true; desenharTopo();
    // Revisão do #677: a conversa e o nome são os do bot de agora; a pessoa pode trocar de bot antes do recibo.
    const conversa = o.conversa?.() ?? null;
    const doBot = nome;
    const rodada = d.proximaRodada;
    const foram: Rascunho[] = [];
    let falhou = false;
    // Revisão do #677: a pessoa pode abrir outro canvas no meio. O enviado sai da chave deste canvas (relida, com o que
    // ela tenha escrito nele enquanto isso), e da lista em memória só se ele ainda está aberto.
    for (const r of [...rascunhos]) {
      try {
        const res = await api.comentarCanvas(id, { texto: r.texto, endereco: r.endereco, tipo: r.tipo, rodada, versao: d.canvas.versao, ...(r.tipo === "pino" ? { x: r.x ?? 0.5, y: r.y ?? 0.5 } : {}) });
        if (aberto === id) d.comentarios.push(res.comentario);
        foram.push(r);
        const restam = lerRascunhos(ler(win, chaveRodada(id))).filter((x) => x.id !== r.id);
        guardar(win, chaveRodada(id), restam.length ? JSON.stringify(restam) : null);
        if (aberto === id) rascunhos = rascunhos.filter((x) => x.id !== r.id);
      } catch { falhou = true; break; }
    }
    enviando = false;
    if (foram.length) {
      let recibo = false;
      if (conversa) {
        try { await api.enviar(conversa, reciboDaRodada({ canvas: nomeCurto(d.canvas), rodada, itens: foram.map((r) => ({ endereco: r.endereco, texto: r.texto })) })); recibo = true; } catch { /* os comentários já estão no canvas */ }
      }
      d.proximaRodada = rodada + 1;
      aviso({ chave: "rodada", tipo: "ok", texto: `Rodada ${rodada} enviada ao ${doBot} · ${foram.length} comentário${foram.length > 1 ? "s" : ""}${recibo ? " · ele já está ajustando" : ""}`, ...(recibo && o.irParaConversa ? { acao: { cv: "ver-conversa", rotulo: "ver na conversa" } } : {}) }, 9000);
    }
    // O que ficou é o da chave deste canvas: se a pessoa abriu outro no meio, `rascunhos` já é o do outro.
    const ficaram = lerRascunhos(ler(win, chaveRodada(id))).length;
    if (falhou) aviso({ chave: "erro-rodada", tipo: "info", texto: `Não deu para enviar ${ficaram === 1 ? "1 comentário" : `${ficaram} comentários`}; ficaram no rascunho.`, acao: { cv: "enviar-rodada", rotulo: "Tentar de novo" } }, 12000);
    if (aberto === id) { modo = null; palco()?.classList.remove("cv-modo-pino"); desenharPinos(); desenharTopo(); }
  }

  async function responder(paiId: string, texto: string): Promise<void> {
    const api = o.api();
    if (!api || !aberto || enviando || velha()) return;
    const pai = dados?.comentarios.find((c) => c.id === paiId);
    enviando = true; erroThread = "";
    try {
      const r = await api.comentarCanvas(aberto, { texto, pai_id: paiId, ...(pai ? { endereco: enderecoDe(pai) } : {}) });
      dados?.comentarios.push(r.comentario);
      const in_ = q<HTMLInputElement>("#cv-resp-in");
      if (in_) in_.value = "";
    } catch { erroThread = "Não deu para responder. Tente de novo."; }
    enviando = false;
    desenharCamada();
    q<HTMLInputElement>("#cv-resp-in")?.focus();
  }

  async function resolver(id: string, resolvido: boolean): Promise<void> {
    const api = o.api();
    if (!api || velha()) return;
    try {
      const r = await api.resolverComentarioCanvas(id, resolvido);
      if (dados) dados.comentarios = dados.comentarios.map((c) => (c.id === r.comentario.id || c.paiId === r.comentario.id ? { ...c, resolvido: r.comentario.resolvido } : c));
      if (resolvido) thread = null;
    } catch { erroThread = "Não deu para resolver. Tente de novo."; }
    desenharPinos(); desenharCamada(); desenharTopo();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // O input de vidro e o balão (J4-4..6)

  async function perguntar(texto: string): Promise<void> {
    const api = o.api();
    const conversa = o.conversa?.() ?? null;
    if (!api || !texto.trim() || enviando) return;
    if (!conversa) { aviso({ chave: "sem-conversa", tipo: "info", texto: "Abra a conversa com o bot uma vez para pedir daqui." }); return; }
    const chip = chipDoCentro();
    const c = dados?.canvas;
    const msg = c ? perguntaSobre({ endereco: chip, canvas: nomeCurto(c), texto }) : texto.trim();
    enviando = true;
    try {
      await api.enviar(conversa, msg);
      const agora = Date.now();
      balao = { pergunta: texto.trim(), chip, etapas: [], resposta: "", fim: false, inicio: agora, agora, nome, conversaId: conversa, turnoId: null };
      const in_ = q<HTMLTextAreaElement>("#cv-comp-in");
      if (in_) { in_.value = ""; in_.style.height = ""; }
      q(".cv-comp")?.classList.remove("cv-comp-escrevendo");
      tique();
    } catch { aviso({ chave: "erro-pedir", tipo: "info", texto: "Não deu para enviar. Tente de novo." }); }
    enviando = false;
    desenharBalao();
  }
  function tique(): void {
    if (!win) return;
    win.clearInterval(relogio);
    relogio = win.setInterval(() => {
      if (!balao || balao.fim || !host?.isConnected) { win.clearInterval(relogio); return; }
      balao = { ...balao, agora: Date.now() };
      const cab = q(".cv-bal .fala-viva-estado");
      if (cab) desenharBalao();
    }, 1000);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Eventos (delegados no host; ligados uma vez por host)

  async function copiarLink(): Promise<void> {
    const e = onde();
    if (!win || !aberto || !e) return;
    const url = new URL(urlDoCanvas(win.location.href, aberto, e), win.location.origin).toString();
    try { await win.navigator.clipboard.writeText(url); aviso({ chave: "link", tipo: "ok", texto: `Link da ${e} copiado` }, 3500); }
    catch { aviso({ chave: "link", tipo: "info", texto: `Não deu para copiar o link da ${e}.` }, 3500); }
    marcarHash(e);
  }

  function fecharUm(): boolean {
    if (novo) { novo = null; desenharCamada(); desenharPinos(); return true; }
    if (notaEm) { soltarNota(); desenharPinos(); desenharTopo(); return true; }
    if (thread) { thread = null; erroThread = ""; desenharCamada(); desenharPinos(); return true; }
    if (menu) { menu = null; desenharTopo(); return true; }
    if (apresentando) { sairDeApresentar(); return true; }
    if (modo) { trocarModo(null); return true; }
    if (real) { sairDoReal(); return true; }
    if (cheia) { alternarCheia(); return true; }
    return false;
  }

  function acao(act: string, el: HTMLElement): void {
    const id = el.dataset["id"] ?? "";
    switch (act) {
      case "abrir": {
        menu = null; buscaMenu = "";
        const passo = passoDoAbrir(id, aberto, todos);
        todos = false;
        if (passo === "topo") desenharTopo();
        else if (passo === "voltar") { desenhar(); montarMundo(); abrirNaLargura(); }
        else void abrir(id);
        return;
      }
      case "todos": menu = null; todos = true; marcarHash(null); fecharVivos(); desenhar(); void lerLista(); return;
      case "voltar-canvas": { todos = false; const u = aberto ?? (agenteId ? ler(win, chaveUltimo(agenteId)) : null); if (u) { if (u === aberto) { desenhar(); montarMundo(); abrirNaLargura(); } else void abrir(u); } return; }
      case "filtro": filtro = (el.dataset["filtro"] as Filtro | undefined) ?? "todos"; desenhar(); return;
      case "relista": erroLista = false; lista = null; desenhar(); void lerLista(); return;
      case "reabrir": if (aberto) { const a = aberto; aberto = null; void abrir(a); } return;
      case "menu-nome": menu = menu === "nome" ? null : "nome"; buscaMenu = ""; desenharTopo(); if (menu) q<HTMLInputElement>("#cv-busca-menu")?.focus(); if (menu && lista === null) void lerLista(); return;
      case "menu-ver": menu = menu === "ver" ? null : "ver"; desenharTopo(); if (menu && versoes === null) void lerVersoes(); return;
      case "ver-versao": void verVersao(Number(el.dataset["versao"])); return;
      case "voltar-atual": if (dados) void verVersao(dados.canvas.versao); return;
      case "comparar": comparar = !comparar; if (versoes === null) void lerVersoes(); aplicarComparacao(); desenharTopo(); return;
      case "o-que-mudou": marcarMudou = true; if (versoes === null) void lerVersoes(); else aplicarComparacao(); desenharTopo(); return;
      case "fechar-aviso": fechados.add(el.dataset["aviso"] ?? ""); if ((el.dataset["aviso"] ?? "").startsWith("nova-")) { novaVersao = null; if (marcarMudou) { marcarMudou = false; aplicarComparacao(); } } desenharTopo(); return;
      case "anterior": andar(-1); return;
      case "proxima": andar(1); return;
      case "link": void copiarLink(); return;
      case "ajustar": marcarHash(null); ajustarTudo(); return;
      case "afastar": case "aproximar": { const t = tamPalco(); v = zoomNoPonto(v, act === "afastar" ? 1 / 1.25 : 1.25, t.w / 2, t.h / 2); real = null; aplicarVista(); return; }
      case "comentar": trocarModo("pino"); return;
      case "nota": trocarModo("nota"); return;
      case "apresentar": { const t = real ?? telaDoCentro(); if (t) apresentar(t); return; }
      case "sair-apresentar": sairDeApresentar(); return;
      case "cheia": alternarCheia(); return;
      case "enviar-rodada": void enviarRodada(); return;
      case "ver-conversa": o.irParaConversa?.(); return;
      case "expandir": { const t = el.dataset["tela"] ?? ""; fechadas.delete(t); q(`.cv-tela[data-tela="${CSS.escape(t)}"]`)?.classList.remove("cv-fechada"); if (irPara(t, { real: true })) marcarHash(t); return; }
      case "thread": novo = null; soltarNota(); erroThread = ""; thread = thread === id ? null : id; desenharPinos(); desenharCamada(); if (thread) q<HTMLInputElement>("#cv-resp-in")?.focus(); return;
      case "rascunho": {
        const r = rascunhos.find((x) => x.id === id);
        if (!r) return;
        thread = null;
        if (r.tipo === "pino") { novo = { endereco: r.endereco, x: r.x ?? 0.5, y: r.y ?? 0.5, rasc: r.id }; desenharCamada(); q<HTMLTextAreaElement>("#cv-novo-in")?.focus(); }
        else { rascunhos = rascunhos.filter((x) => x.id !== id); salvarRascunhos(); notaEm = r.endereco; desenharPinos(); const n = q<HTMLTextAreaElement>("#cv-nota-in"); if (n) { n.value = r.texto; n.focus(); } desenharTopo(); }
        return;
      }
      case "tirar-rascunho": if (novo?.rasc) { const r = novo.rasc; rascunhos = rascunhos.filter((x) => x.id !== r); novo = null; salvarRascunhos(); desenharPinos(); desenharCamada(); desenharTopo(); } return;
      case "guardar": guardarNovo(q<HTMLTextAreaElement>("#cv-novo-in")?.value ?? ""); return;
      case "resolver": void resolver(id, el.dataset["resolvido"] === "1"); return;
      case "fechar-balao": balao = null; desenharBalao(); return;
      default: return;
    }
  }

  const ligados = new WeakSet<HTMLElement>();
  function ligar(h: HTMLElement): void {
    if (ligados.has(h)) return;
    ligados.add(h);
    let arraste: { id: number; x: number; y: number; vx: number; vy: number; moveu: boolean } | null = null;

    h.addEventListener("click", (ev) => {
      const el = (ev.target as Element | null)?.closest<HTMLElement>("[data-cv]");
      if (!el) {
        // Fora de um menu aberto, o clique fecha o menu.
        if (menu && !(ev.target as Element | null)?.closest(".cv-menu")) { menu = null; desenharTopo(); }
        return;
      }
      if (menu && !el.closest(".cv-menu") && !["menu-nome", "menu-ver"].includes(el.dataset["cv"] ?? "")) menu = null;
      acao(el.dataset["cv"] ?? "", el);
    });

    h.addEventListener("input", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.id === "cv-busca-menu") { buscaMenu = (t as HTMLInputElement).value; desenharTopo(); }
      else if (t.id === "cv-busca-lista") { busca = (t as HTMLInputElement).value; desenhar(); }
      else if (t.id === "cv-comp-in") {
        const a = t as HTMLTextAreaElement;
        a.style.height = ""; a.style.height = `${Math.min(120, a.scrollHeight)}px`;
        a.closest(".cv-comp")?.classList.toggle("cv-comp-escrevendo", !!a.value.trim());
      }
    });

    h.addEventListener("submit", (ev) => {
      const f = ev.target as HTMLFormElement;
      ev.preventDefault();
      if (f.dataset["cvForm"] === "perguntar") void perguntar(q<HTMLTextAreaElement>("#cv-comp-in")?.value ?? "");
    });

    h.addEventListener("keydown", (ev) => {
      const alvo = ev.target as HTMLElement;
      if (alvo.closest("textarea, input")) {
        const enter = ev.key === "Enter" && !ev.shiftKey && !ev.isComposing;
        if (enter && alvo.id === "cv-novo-in") { ev.preventDefault(); guardarNovo((alvo as HTMLTextAreaElement).value); }
        else if (enter && alvo.id === "cv-nota-in") { ev.preventDefault(); guardarNota((alvo as HTMLTextAreaElement).value); }
        else if (enter && alvo.id === "cv-resp-in") { ev.preventDefault(); const t = (alvo as HTMLInputElement).value.trim(); if (t && thread) void responder(thread, t); }
        else if (enter && alvo.id === "cv-comp-in") { ev.preventDefault(); void perguntar((alvo as HTMLTextAreaElement).value); }
        else if (ev.key === "Escape") { ev.preventDefault(); if (alvo.id === "cv-comp-in") (alvo as HTMLTextAreaElement).blur(); else fecharUm(); palco()?.focus(); }
        return;
      }
      atalho(ev);
    });

    h.addEventListener("wheel", (ev) => {
      const p = (ev.target as Element | null)?.closest<HTMLElement>(".cv-palco");
      if (!p || !layout) return;
      ev.preventDefault();
      const r = p.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) v = zoomNoPonto(v, fatorDaRoda(ev.deltaY), ev.clientX - r.left, ev.clientY - r.top);
      else v = { ...v, x: v.x - ev.deltaX, y: v.y - ev.deltaY };
      if (real && (ev.ctrlKey || ev.metaKey)) { real = null; marcarHash(null); }
      aplicarVista();
    }, { passive: false });

    h.addEventListener("pointerdown", (ev) => {
      const p = (ev.target as Element | null)?.closest<HTMLElement>(".cv-palco");
      const alvo = ev.target as Element;
      if (!p || ev.button !== 0 || ignorarPonteiro({ controle: !!alvo.closest("button, a, textarea, input"), noReal: !!alvo.closest(".cv-real"), modoPino: modo === "pino" })) return;
      arraste = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, vx: v.x, vy: v.y, moveu: false };
      p.setPointerCapture(ev.pointerId);
      p.classList.add("cv-arrastando");
    });
    h.addEventListener("pointermove", (ev) => {
      if (!arraste || ev.pointerId !== arraste.id) return;
      const dx = ev.clientX - arraste.x;
      const dy = ev.clientY - arraste.y;
      if (!arraste.moveu && Math.hypot(dx, dy) < 4) return;
      arraste.moveu = true;
      v = { ...v, x: arraste.vx + dx, y: arraste.vy + dy };
      aplicarVista();
    });
    const soltar = (ev: PointerEvent): void => {
      if (!arraste || ev.pointerId !== arraste.id) return;
      const a = arraste;
      arraste = null;
      palco()?.classList.remove("cv-arrastando");
      if (a.moveu || ev.type === "pointercancel" || !layout) return;
      // Um clique parado: no modo Comentar vira o popover do pino novo; fora dele, fecha o que estiver aberto.
      const r = palco()?.getBoundingClientRect();
      if (!r) return;
      const m = noMundo(v, ev.clientX - r.left, ev.clientY - r.top);
      const t = telaNoPonto(layout, m);
      if (modo === "pino" && t && !t.tela.pendente) {
        thread = null;
        novo = { endereco: t.tela.id, ...fracaoNaTela(t, m) };
        desenharPinos(); desenharCamada();
        q<HTMLTextAreaElement>("#cv-novo-in")?.focus();
      } else if (novo || thread || menu) { novo = null; thread = null; menu = null; desenharPinos(); desenharCamada(); desenharTopo(); }
    };
    h.addEventListener("pointerup", soltar);
    h.addEventListener("pointercancel", soltar);
    h.addEventListener("dblclick", (ev) => {
      if (!layout || modo) return;
      const r = palco()?.getBoundingClientRect();
      if (!r || !(ev.target as Element).closest(".cv-palco")) return;
      const t = telaNoPonto(layout, noMundo(v, ev.clientX - r.left, ev.clientY - r.top));
      if (t && !t.tela.pendente && t.tela.id !== real) { irPara(t.tela.id, { real: true }); marcarHash(t.tela.id); }
    });
  }

  /** Os atalhos da página (fora de um campo): C, N, Shift 1 / 0, 1, + −, setas e Esc. */
  function atalho(ev: KeyboardEvent): void {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || !aberto || todos || !layout) return;
    const k = ev.key;
    if (k === "Escape") { if (!fecharUm()) return; }
    else if (k === "c" || k === "C") trocarModo("pino");
    else if (k === "n" || k === "N") trocarModo("nota");
    else if (k === "0" || (ev.shiftKey && (k === "!" || ev.code === "Digit1"))) { marcarHash(null); ajustarTudo(); }
    else if (k === "1") { const t = real ?? telaDoCentro(); if (t && irPara(t, { real: true })) marcarHash(t); }
    else if (k === "+" || k === "=" || k === "-") { const t = tamPalco(); v = zoomNoPonto(v, k === "-" ? 1 / 1.25 : 1.25, t.w / 2, t.h / 2); real = null; aplicarVista(); }
    else if (k.startsWith("Arrow")) {
      if (apresentando && (k === "ArrowLeft" || k === "ArrowRight")) andar(k === "ArrowLeft" ? -1 : 1);
      else { const p = 80; v = { ...v, x: v.x + (k === "ArrowLeft" ? p : k === "ArrowRight" ? -p : 0), y: v.y + (k === "ArrowUp" ? p : k === "ArrowDown" ? -p : 0) }; aplicarVista(); }
    } else return;
    ev.preventDefault();
  }

  // Os atalhos valem com a página à vista e o foco fora de um campo do app (no corpo da página, por exemplo).
  doc.addEventListener("keydown", (ev) => {
    if (!host?.isConnected || ev.defaultPrevented) return;
    const t = ev.target as HTMLElement | null;
    if (t && (host.contains(t) || t.closest(".cv-sobre"))) { if (t.closest(".cv-sobre")) atalho(ev); return; }
    if (t && t !== doc.body && t.closest("input, textarea, [contenteditable], select, dialog")) return;
    if (host.closest("[hidden]") || host.offsetParent === null) return;
    atalho(ev);
  });

  // O Esc de dentro da tela no tamanho real (a ponte do srcdoc só posta {nod:"esc"}); vale só o iframe vivo nosso.
  win?.addEventListener("message", (ev) => {
    const d = ev.data as { nod?: unknown } | null;
    if (!d || d.nod !== "esc") return;
    for (const f of vivos.values()) if (f.contentWindow === ev.source) { sairDoReal(); palco()?.focus(); return; }
    if (apresentando) sairDeApresentar();
  });
  win?.addEventListener("hashchange", () => { if (host?.isConnected && aberto && layout) irPara(win.location.hash); });
  win?.addEventListener("resize", () => { if (host?.isConnected && layout) { pedirVivos(); medirBarra(); } });

  return {
    montar(h, ag, n) {
      nome = n;
      const outro = ag !== agenteId;
      const novoHost = h !== host || !h.firstElementChild;
      host = h;
      ligar(h);
      if (outro) {
        agenteId = ag; lista = null; erroLista = false; aberto = null; dados = null; layout = null; todos = false; vendo = null; versoes = null;
        blobs.clear(); ausentes.clear(); pausaBlobsAte = 0; fecharVivos(); rascunhos = []; novo = null; thread = null; balao = null; menu = null;
        desenhar();
        void lerLista();
      }
      if (pedido) { const p = pedido; pedido = null; if (p.id !== aberto) { void abrir(p.id, { endereco: p.endereco }); return; } if (p.endereco && irPara(p.endereco)) marcarHash(p.endereco); }
      if (outro) return;
      if (novoHost) { vivos.clear(); desenhar(); if (aberto) void abrir(aberto, { manter: true }); else void lerLista(); }
      else medirBarra();
    },
    querAbrir(id, endereco = null) {
      pedido = { id, endereco };
      if (host?.isConnected && agenteId) {
        pedido = null;
        todos = false;
        if (id !== aberto) void abrir(id, { endereco });
        else if (endereco && irPara(endereco)) marcarHash(endereco);
      }
    },
    aoFrame(frame) {
      if (balao && frame.tipo.startsWith("turno.")) {
        const b = balaoComFrame(balao, frame, Date.now());
        if (b !== balao) { balao = b; if (host?.isConnected) desenharBalao(); }
      }
      if (frame.tipo !== "canvas.mudou" || !host?.isConnected || frame.dados["agenteId"] !== agenteId) return;
      void lerLista();
      if (aberto && frame.dados["canvasId"] === aberto) void abrir(aberto, { manter: true });
    },
  };
}
