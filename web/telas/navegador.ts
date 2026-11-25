import type { RespostaNavegador, VistaNavegador } from "../../src/contracts/navegador-do-bot.ts";
import type { Api } from "../lib/api.ts";
import { htmlBarraDeGravacao, htmlPassosGravados, rotuloDaGravacao } from "../lib/navegador-cartoes.ts";
import { esc } from "../lib/escape.ts";
import { movimentoReduzido } from "../lib/movimento.ts";
import {
  alturaDaFolha, aoNome, avisoDaAbaFechada, conversaEstreita, botNoMeio, CHAVE_LARGURA, comArtigo, deNome, fraseMaiuscula, gravarLargura, htmlAbaDeLugar, htmlAcoesDoPainel, htmlBotaoDoCanto, htmlLinhaDoNavegador, htmlLugares, htmlMenuDoNavegador, ICONES_NAVEGADOR,
  imantar, larguraPadrao, legendaDoPasso, lerLargura, limitarLargura, linhaDoNavegadorVisivel, modoDoPainel, PAINEL_MIN, pontoDoLugar, proximoEncaixe, soltarFecha, soltarFolha,
  estadoDaAbaDeLugar, htmlLugaresFechados, lugarFechadoAMao, tituloDaAbaAtiva, tecla, ariaTecla, definirTecladoDoMac, type LugarDaVista, type ModoDoPainel, type PosicaoDaFolha,
} from "../lib/navegador-vista.ts";
import { montarVistaNavegador, type Hospedeiro, type OpcoesDaVista, type VistaMontada } from "./navegador-vista.ts";

/**
 * Onde a vista do navegador do bot mora na tela (ADR-190; Paper linhas 1, 5 e 1+5; D1, D1c, D4 E, D5, D6, D7, D8):
 * - o PAINEL ao lado da conversa (modo pílula), com o seletor de lugares, as ações e a alça de largura; em 900–1179 px ele
 *   cobre a conversa com sombra;
 * - a ABA de lugar (modo abas), depois da conversa e das tarefas na fileira; a vista ocupa o lugar da conversa;
 * - a TELA CHEIA (a mesma do computador, `dialog.ctc`), com o seletor no topo e "Recado para a {Bot}";
 * - a FOLHA de baixo no celular (meia, cheia, fechada).
 * A vista é UM elemento por bot (web/telas/navegador-vista.ts) que viaja entre eles (D8). Fechar a vista nunca para o
 * trabalho; fechar com a pessoa no controle devolve e mostra "Devolvido à {Bot} · Desfazer" (D4, E).
 */

export type OpcoesNavegadorNaTela = {
  /** A sessão (null antes de entrar): a vista só existe com ela. */
  api: () => (OpcoesDaVista["api"] & Partial<Pick<Api, "ensinarNoNavegador">>) | null;
  /** O nome do bot (a vista nunca diz "Ada": diz o nome real). */
  nome: (agenteId: string) => string;
  /** D1c: o personagem do bot (HTML) no chip do título da tela cheia; sem ele, o chip só com o nome. */
  avatar?: (agenteId: string) => string;
  /** O bot tem o computador (o lugar "Computador" no seletor). */
  temComputador: (agenteId: string) => boolean;
  /** Abre a tela do computador de hoje (o lugar "Computador"). */
  abrirComputador: (agenteId: string) => void;
  /** Lê a vista pelo REST (a primeira vez; depois o `navegador.mudou` relê). */
  lerVista: (agenteId: string) => void;
  /** A vista mudou por fora do reducer (canal ou operação): guarda no estado da tela. */
  guardarVista: (agenteId: string, r: RespostaNavegador) => void;
  decidir: OpcoesDaVista["decidir"];
  entrarEuMesmo?: OpcoesDaVista["entrarEuMesmo"];
  /** "Recado para a {Bot}" (D1c): manda na conversa do bot; mandar devolve o controle. */
  mandarRecado: (agenteId: string, texto: string) => Promise<void>;
  /** "Logins deste site…" (D1c). */
  abrirLogins: (agenteId: string, site: string) => void;
  /** 2026-11-23: "Trazer do meu Chrome" do ⋯ (a sessão do site da aba, do Chrome da pessoa). Ausente = o item não aparece. */
  trazerDoChrome?: (agenteId: string) => void;
  /** "Abrir no meu navegador" (D1c). */
  abrirFora: (url: string) => void;
  aoErro: (e: unknown) => void;
  /** O modo abas do bot (a aba de lugar só existe nele) e o jeito de ligá-lo. */
  modoAbas: (agenteId: string) => boolean;
  ligarModoAbas: (agenteId: string) => void;
  /** Redesenha a tela (a fileira e o cabeçalho mudam quando a aba ou o painel abrem). */
  render: () => void;
  /** A pessoa (a largura é lembrada por pessoa). */
  pessoaId: () => string | null;
  celular: () => boolean;
  /** Mostra o aviso com Desfazer (D4 E; D7). */
  avisar?: (texto: string, desfazer: (() => void) | null, atalho?: string) => void;
};

type Lugar = { agenteId: string; modo: "painel" | "aba" | "folha"; lugar: LugarDaVista };

/** 5c: o lugar onde o bot está agora, como o botão de abas e a pílula do campo o mostram. */
export type LugarAtivo = { agenteId: string; rotulo: string; estado: string; ponto: "vivo" | "precisa"; site: string };

const CHAVE_ABAS = "nod:navegador:abas";
/** D8: o painel abre em 260 ms (mola suave) e fecha em 200 ms. Movimento reduzido: fade de 120/100 ms. */
export const MS_PAINEL_ABRE = 260;
export const MS_PAINEL_FECHA = 200;
/** D8: o aviso com Desfazer fica 5 s (pausa com o mouse em cima). */
export const MS_AVISO = 5_000;
/** D7: a dica da aba aparece depois de 600 ms. */
export const MS_DICA_ABA = 600;
/** T2: o relógio da barra de gravação anda de segundo em segundo. */
export const MS_RELOGIO_GRAVACAO = 1_000;
/**
 * D6, C e achado 13 do crítico: a folha do celular anda por `translateY` (não pela altura) em 320 ms, com a curva do
 * projeto, sem passar do ponto; o quique (a curva que passa e volta) só quando a pessoa solta com velocidade.
 */
export const MS_FOLHA = 320;
/** D8 (Paper XMX-0): com Reduzir movimento a folha vai sem mola, em 150 ms. */
export const MS_FOLHA_REDUZIDO = 150;
export const CURVA_FOLHA = "cubic-bezier(.22, 1, .36, 1)";
export const CURVA_FOLHA_EMBALO = "cubic-bezier(.32, 1.2, .5, 1)";
/** A velocidade (px/ms) acima da qual a soltura "tem embalo" (a mesma de soltarFolha). */
const VELOCIDADE_DO_EMBALO = 0.6;
/** D7: arrastar a aba de lugar começa depois de 6 px; soltar a até 80 px da borda direita a põe ao lado da conversa. */
export const ARRASTO_MIN_PX = 6;
export const BORDA_PAINEL_PX = 80;

function guardado(chave: string): string | null {
  try { return window.localStorage.getItem(chave); } catch { return null; }
}
function guardar(chave: string, valor: string): void {
  try { window.localStorage.setItem(chave, valor); } catch { /* sem storage, vale só nesta página */ }
}

export function lerAbasDeLugar(texto: string | null): Set<string> {
  if (!texto) return new Set();
  try {
    const v = JSON.parse(texto) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "").slice(0, 50) : []);
  } catch { return new Set(); }
}

export type NavegadorNaTela = ReturnType<typeof criarNavegadorNaTela>;

export function criarNavegadorNaTela(o: OpcoesNavegadorNaTela) {
  definirTecladoDoMac(/Mac|iPhone|iPad/.test(navigator.platform));
  const vistas = new Map<string, VistaMontada>();
  const respostas = new Map<string, RespostaNavegador | null>();
  const pedidos = new Set<string>();
  let abasDeLugar = lerAbasDeLugar(guardado(CHAVE_ABAS));
  /** O bot da conversa à vista (só da dona) e se a tela é a conversa dele. */
  let botDaTela: string | null = null;
  let aberto: Lugar | null = null;
  /** A aba de lugar à vista (modo abas): o bot. */
  let abaAtiva: string | null = null;
  let telaCheia: { agenteId: string; dialog: HTMLDialogElement; voltar: Lugar | null } | null = null;
  /** T2: o campo do nome aberto no lugar de "Salvar e ensinar", e o relógio vivo da barra. */
  let nomeando = false;
  let relogio = 0;
  let pintadoGravacao = "";
  /** T2: o descarte já avisado de cada bot (pelo `ate`), para o aviso com Desfazer sair uma vez. */
  const descartesAvisados = new Map<string, number>();
  const fechadas: string[] = [];
  let largura = 0;
  let posFolha: PosicaoDaFolha = "meia";
  /** D7: onde a pessoa pôs a aba de lugar de cada bot arrastando ("inicio" = antes das tarefas). */
  const posicaoDaAba = new Map<string, "inicio" | "fim">();
  /** Os ouvintes da janela e do documento saem juntos em `destruir` (os testes montam várias). */
  const ac = new AbortController();
  const sinal = { signal: ac.signal };
  /**
   * Revisão da CI (2026-11-20): todo temporizador desta tela sai em `destruir`. Um `setTimeout` do fechar do painel disparava
   * depois de o teste desmontar a página ("document is not defined") e derrubava a rodada do vitest.
   */
  const temporizadores = new Set<number>();
  function depois(fn: () => void, ms?: number): number {
    const t = window.setTimeout(() => { temporizadores.delete(t); if (!ac.signal.aborted) fn(); }, ms);
    temporizadores.add(t);
    return t;
  }

  // ---- o painel (um só elemento; a vista entra e sai dele) -------------------------------------------------------------------
  const painel = document.createElement("aside");
  painel.className = "nv-painel";
  painel.id = "navegador-painel";
  painel.hidden = true;
  painel.setAttribute("aria-label", "Tela do bot");
  painel.innerHTML = `<div class="nv-alca" role="separator" aria-orientation="vertical" aria-label="Largura do painel" tabindex="0" aria-valuemin="${PAINEL_MIN}"><i class="nv-alca-linha" aria-hidden="true"></i><span class="nv-alca-selo" hidden></span></div>`
    + `<header class="nv-topo"></header><div class="nv-corpo"></div>`;
  const topo = painel.querySelector<HTMLElement>(".nv-topo")!;
  const corpo = painel.querySelector<HTMLElement>(".nv-corpo")!;
  const alca = painel.querySelector<HTMLElement>(".nv-alca")!;
  const selo = painel.querySelector<HTMLElement>(".nv-alca-selo")!;
  const app = (): HTMLElement | null => document.querySelector<HTMLElement>(".app");
  const stage = (): HTMLElement | null => document.querySelector<HTMLElement>(".stage");

  // A folha do celular (D6, C).
  const folha = document.createElement("div");
  folha.className = "nv-folha";
  /**
   * Revisão da CI (2026-11-20): o papel de diálogo só existe com a folha aberta. Escondida com role="dialog", ela casava com
   * SELETOR_MODAL (web/lib/atalhos.ts) e o app achava que havia uma janela aberta: ⌘B, ⌘, e os outros atalhos paravam.
   */
  const mostrarFolha = (sim: boolean): void => {
    folha.hidden = !sim;
    if (sim) folha.setAttribute("role", "dialog");
    else folha.removeAttribute("role");
  };
  mostrarFolha(false);
  folha.setAttribute("aria-label", "Tela do bot");
  folha.innerHTML = `<div class="nv-folha-pega"><span class="nv-folha-alca" aria-hidden="true"></span><div class="nv-folha-topo"></div></div><div class="nv-folha-corpo"></div>`;
  const folhaTopo = folha.querySelector<HTMLElement>(".nv-folha-topo")!;
  const folhaCorpo = folha.querySelector<HTMLElement>(".nv-folha-corpo")!;

  let montado = false;
  function montar(): void {
    if (montado) return;
    const a = app();
    if (!a) return;
    a.append(painel);
    document.body.append(folha);
    montado = true;
  }

  const exigir = (): OpcoesDaVista["api"] => {
    const a = o.api();
    if (!a) throw new Error("sem_sessao");
    return a;
  };
  const apiDaVista: OpcoesDaVista["api"] = {
    operarNavegador: (id, op) => exigir().operarNavegador(id, op),
    irParaNoNavegador: (id, url) => exigir().irParaNoNavegador(id, url),
    trocarAbaDoNavegador: (id, aba) => exigir().trocarAbaDoNavegador(id, aba),
    urlVivoNavegador: (id) => exigir().urlVivoNavegador(id),
    navegador: (id) => exigir().navegador(id),
  };

  function vistaDe(agenteId: string): VistaMontada {
    let v = vistas.get(agenteId);
    if (v) return v;
    v = montarVistaNavegador({
      api: apiDaVista,
      agenteId,
      nome: () => o.nome(agenteId),
      aoMudar: (r) => { respostas.set(agenteId, r); o.guardarVista(agenteId, r); pintarTopo(); pintarTelaCheia(); avisarDescarte(agenteId, r.vista); },
      aoErro: o.aoErro,
      decidir: o.decidir,
      entrarEuMesmo: o.entrarEuMesmo,
    });
    v.atualizar(respostas.get(agenteId) ?? null);
    vistas.set(agenteId, v);
    return v;
  }

  const reduzido = (): boolean => movimentoReduzido();
  const nomeDe = (id: string): string => o.nome(id);
  const resp = (id: string): RespostaNavegador | null => respostas.get(id) ?? null;
  const vistaAtual = (id: string): VistaNavegador | null => resp(id)?.vista ?? null;

  function lugaresDe(agenteId: string): LugarDaVista[] {
    return o.temComputador(agenteId) ? ["navegador", "computador"] : ["navegador"];
  }

  // ---- a largura (D5) -----------------------------------------------------------------------------------------------------
  function area(): number {
    const barra = document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0;
    return Math.max(0, window.innerWidth - barra);
  }
  function chaveDaLargura(): string {
    return `${CHAVE_LARGURA}:${o.pessoaId() ?? "anon"}`;
  }
  function larguraLembrada(): number {
    const f = lerLargura(guardado(chaveDaLargura()));
    const ar = area();
    return f ? limitarLargura(Math.round(f * ar), ar) : larguraPadrao(ar);
  }
  function modo(): ModoDoPainel {
    return modoDoPainel(window.innerWidth, o.celular(), area());
  }
  function aplicarLargura(l: number): void {
    largura = l;
    app()?.style.setProperty("--nv-largura", `${Math.round(l)}px`);
    app()?.classList.toggle("nv-conversa-estreita", conversaEstreita(area(), l));
    alca.setAttribute("aria-valuenow", String(Math.round(l)));
    alca.setAttribute("aria-valuemax", String(Math.round(Math.max(PAINEL_MIN, area() - 420))));
  }

  // ---- o topo do painel (D1, 1 e 2) ---------------------------------------------------------------------------------------
  function pintarTopo(): void {
    if (!aberto) return;
    const id = aberto.agenteId;
    const v = vistaAtual(id);
    const lugares = htmlLugares(lugaresDe(id), aberto.lugar, aberto.lugar === "navegador" ? pontoDoLugar(v) : null);
    if (aberto.modo === "aba") {
      const html = `<div class="nv-topo-aba"><button type="button" class="nv-bt-texto" data-nv-p="ao-lado">${ICONES_NAVEGADOR.aba}<span>Pôr ao lado da conversa</span></button><button type="button" class="nv-ic" data-nv-p="tela-cheia" aria-label="Tela cheia" title="Tela cheia · ${tecla("⌘⇧F")}">${ICONES_NAVEGADOR.expandir}</button><button type="button" class="nv-ic" data-nv-p="menu" aria-haspopup="menu" aria-label="Mais ações" title="Mais">${ICONES_NAVEGADOR.mais}</button></div>`;
      if (topo.innerHTML !== html) topo.innerHTML = html;
      return;
    }
    const html = `${lugares}${htmlAcoesDoPainel({ celular: aberto.modo === "folha" })}`;
    const alvo = aberto.modo === "folha" ? folhaTopo : topo;
    if (alvo.innerHTML !== html) {
      const foco = alvo.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.nv ?? (document.activeElement as HTMLElement).dataset.lugar : null;
      alvo.innerHTML = html.replaceAll('data-nv="', 'data-nv-p="');
      if (foco) alvo.querySelector<HTMLElement>(`[data-nv-p="${foco}"], [data-lugar="${foco}"]`)?.focus();
    }
  }

  /** O lugar "Computador" no painel: a tela de hoje abre na tela cheia dela (o computador não muda nesta entrega). */
  function htmlComputador(agenteId: string): string {
    const n = esc(deNome(nomeDe(agenteId)));
    return `<div class="nv-computador"><span class="nv-estado-ic" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></span><b>Computador ${n}</b><span class="nv-estado-sub">A tela do computador abre por inteiro.</span><button type="button" class="nv-estado-bt" data-nv-p="abrir-computador">Abrir a tela</button></div>`;
  }

  function encaixarVista(): void {
    if (!aberto) return;
    const v = vistaDe(aberto.agenteId);
    const alvo = aberto.modo === "folha" ? folhaCorpo : corpo;
    if (aberto.lugar === "computador") {
      v.ligar(false);
      if (v.el.parentElement) v.el.remove();
      const html = htmlComputador(aberto.agenteId);
      if (!alvo.querySelector(".nv-computador")) alvo.innerHTML = html;
      return;
    }
    alvo.querySelector(".nv-computador")?.remove();
    // 2026-11-22 (teste do dono): trocar de bot com o painel aberto deixava a vista do bot anterior no mesmo corpo — o
    // navegador do Chico ("em pausa") empilhado em cima do da Ada. Só a vista do bot aberto fica; a outra desliga o canal.
    for (const [id, outra] of vistas) if (id !== aberto.agenteId && outra.el.parentElement === alvo) { outra.ligar(false); outra.el.remove(); }
    if (v.el.parentElement !== alvo) alvo.append(v.el);
    v.hospedar(aberto.modo === "folha" ? "folha" : aberto.modo === "aba" ? "aba" : "painel");
    v.ligar(true);
  }

  // ---- abrir e fechar -----------------------------------------------------------------------------------------------------
  function classesDaApp(): void {
    const a = app();
    if (!a) return;
    const m = aberto && aberto.modo === "painel" ? modo() : null;
    a.classList.toggle("nv-lado", m === "lado");
    a.classList.toggle("nv-cobre", m === "cobre");
    a.classList.toggle("nv-aba-ativa", aberto?.modo === "aba");
    painel.classList.toggle("nv-em-aba", aberto?.modo === "aba");
    painel.classList.toggle("nv-cobrindo", m === "cobre");
  }

  /**
   * A coluna da direita é uma pilha (definido em 2026-11-22, pedido do dono): o painel do bot aberto por cima do navegador
   * recolhe o navegador, e fechar o do bot traz o navegador de volta — o mesmo que já acontecia ao contrário (o navegador
   * por cima do painel do bot, que reaparece quando o navegador fecha). Antes o painel do bot abria escondido "por baixo".
   */
  let recolhido: { agenteId: string; lugar: LugarDaVista } | null = null;

  function abrirPainel(agenteId: string, lugar: LugarDaVista = "navegador"): void {
    recolhido = null;
    montar();
    // C1 e 1a: com o painel aberto o botão do canto sai do cabeçalho; o foco que estava nele vai para o × do painel.
    const doCanto = !!(document.activeElement as HTMLElement | null)?.closest?.(".nv-canto");
    if (telaCheia) sairDaTelaCheia(false);
    if (o.celular()) { abrirFolha(agenteId, lugar); return; }
    const jaAberto = aberto?.modo === "painel" && aberto.agenteId === agenteId;
    if (aberto?.modo === "aba") devolverAoPainel();
    aberto = { agenteId, modo: "painel", lugar };
    abaAtiva = null;
    if (!respostas.has(agenteId)) pedirVista(agenteId);
    if (painel.parentElement !== app()) app()?.append(painel);
    painel.hidden = false;
    const alvoL = modo() === "cobre" ? Math.min(area(), Math.max(PAINEL_MIN, Math.round(area() * 0.72))) : larguraLembrada();
    if (!jaAberto) animarAbrir(alvoL); else aplicarLargura(alvoL);
    classesDaApp();
    pintarTopo();
    encaixarVista();
    o.render();
    if (doCanto && !document.activeElement?.closest?.(".nv-canto")) painel.querySelector<HTMLElement>('[data-nv-p="fechar"]')?.focus({ preventScroll: true });
  }

  function animarAbrir(alvoL: number): void {
    const a = app();
    if (!a) { aplicarLargura(alvoL); return; }
    if (reduzido()) {
      aplicarLargura(alvoL);
      painel.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "linear" });
      return;
    }
    // D8: desliza da direita e a conversa encolhe junto (a coluna anima pela --nv-largura registrada com @property).
    a.classList.add("nv-animando");
    aplicarLargura(0);
    void a.offsetWidth;
    a.style.setProperty("--nv-dur", `${MS_PAINEL_ABRE}ms`);
    aplicarLargura(alvoL);
    painel.animate?.([{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: MS_PAINEL_ABRE, easing: "cubic-bezier(.22, 1, .36, 1)" });
    depois(() => a.classList.remove("nv-animando"), MS_PAINEL_ABRE + 20);
  }

  function fechar(o2: { devolver?: boolean; aviso?: boolean } = {}): void {
    if (!aberto) return;
    const id = aberto.agenteId;
    const eraModo = aberto.modo;
    const v = vistas.get(id);
    const noControle = v?.controleComPessoa() ?? false;
    // D4, E: fechar a vista no controle devolve; o aviso com Desfazer só aqui (a devolução foi indireta).
    if (noControle && o2.devolver !== false) {
      void v!.devolver();
      if (o2.aviso !== false) avisar(`Devolvido ${aoNome(nomeDe(id))}`, () => { abrirPainel(id); void vistaDe(id).assumir(); });
    }
    if (eraModo === "aba") { fecharAba(id, false); return; }
    const focoNoPainel = painel.contains(document.activeElement);
    const terminar = (): void => {
      v?.ligar(false);
      painel.hidden = true;
      mostrarFolha(false);
      if (aberto?.agenteId === id && aberto.modo === eraModo) aberto = null;
      classesDaApp();
      o.render();
      // O botão do canto volta ao cabeçalho com o painel fechado: o foco que estava no painel volta para ele.
      if (focoNoPainel) document.querySelector<HTMLElement>(`.nv-canto[data-agente="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    };
    if (eraModo === "folha") { moverFolha("fechada"); depois(terminar, reduzido() ? MS_FOLHA_REDUZIDO : MS_FOLHA); aberto = null; return; }
    const a = app();
    if (a && !reduzido() && modo() === "lado") {
      a.classList.add("nv-animando", "nv-fechando");
      a.style.setProperty("--nv-dur", `${MS_PAINEL_FECHA}ms`);
      aplicarLargura(0);
      painel.animate?.([{ transform: "none", opacity: 1 }, { transform: "translateX(16px)", opacity: 0 }], { duration: MS_PAINEL_FECHA, easing: "cubic-bezier(.4, 0, 1, 1)" });
      aberto = null;
      depois(() => { a.classList.remove("nv-animando", "nv-fechando"); terminar(); }, MS_PAINEL_FECHA);
      return;
    }
    if (reduzido()) painel.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 100 });
    aberto = null;
    terminar();
  }

  function alternar(agenteId: string): void {
    if (aberto?.agenteId === agenteId && aberto.modo !== "aba") fechar();
    else if (o.modoAbas(agenteId) && abasDeLugar.has(agenteId)) mostrarAba(agenteId);
    else abrirPainel(agenteId);
  }

  /** O "Ver" da linha de atividade: no modo abas abre a aba; no modo pílula, o painel. */
  function ver(agenteId: string): void {
    if (o.modoAbas(agenteId)) abrirAba(agenteId);
    else abrirPainel(agenteId);
  }

  // ---- a aba de lugar (D7) ------------------------------------------------------------------------------------------------
  function gravarAbas(): void { guardar(CHAVE_ABAS, JSON.stringify([...abasDeLugar])); }

  function abrirAba(agenteId: string): void {
    montar();
    if (o.celular()) { abrirFolha(agenteId, "navegador"); return; }
    if (telaCheia) sairDaTelaCheia(false);
    abasDeLugar = new Set(abasDeLugar).add(agenteId);
    gravarAbas();
    o.ligarModoAbas(agenteId);
    mostrarAba(agenteId);
  }

  function mostrarAba(agenteId: string): void {
    montar();
    if (aberto?.modo === "painel") { painel.hidden = true; }
    aberto = { agenteId, modo: "aba", lugar: "navegador" };
    abaAtiva = agenteId;
    if (!respostas.has(agenteId)) pedirVista(agenteId);
    const st = stage();
    const composer = document.getElementById("composer");
    if (st && painel.parentElement !== st) st.insertBefore(painel, composer ?? null);
    painel.hidden = false;
    // D8: a vista viaja (mesmo elemento) do painel para a aba em 300 ms; aqui o fade curto basta para não piscar.
    if (!reduzido()) painel.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300, easing: "cubic-bezier(.22, 1, .36, 1)" });
    classesDaApp();
    pintarTopo();
    encaixarVista();
    o.render();
  }

  /** A aba deixa de estar à vista (a pessoa foi para a Conversa ou uma tarefa); ela continua na fileira. */
  function desativarAba(agenteId: string): void {
    if (abaAtiva !== agenteId) return;
    abaAtiva = null;
    if (aberto?.modo === "aba") { vistas.get(agenteId)?.ligar(false); painel.hidden = true; aberto = null; devolverAoPainel(); }
    classesDaApp();
  }

  function devolverAoPainel(): void {
    const a = app();
    if (a && painel.parentElement !== a) a.append(painel);
  }

  function fecharAba(agenteId: string, comAviso = true): void {
    const v = vistas.get(agenteId);
    if (v?.controleComPessoa()) void v.devolver();
    abasDeLugar = new Set(abasDeLugar);
    abasDeLugar.delete(agenteId);
    gravarAbas();
    fechadas.push(agenteId);
    if (abaAtiva === agenteId) desativarAba(agenteId);
    o.render();
    // D7 e 5d: some a aba, o bot continua, aviso com Desfazer e ⌘⇧T.
    if (comAviso) avisar(avisoDaAbaFechada(nomeDe(agenteId)), () => reabrirFechada(), tecla("⌘⇧T"));
  }

  function reabrirFechada(id = fechadas.at(-1)): void {
    if (!id) return;
    const i = fechadas.lastIndexOf(id);
    if (i >= 0) fechadas.splice(i, 1);
    abrirAba(id);
  }

  // ---- arrastar a aba de lugar (D7: arrastar reordena; arrastar para a borda direita vira painel) -------------------------
  {
    let arrasto: { agenteId: string; aba: HTMLElement; x0: number; y0: number; id: number; movendo: boolean } | null = null;
    let engolirClique = false;
    const pertoDaBorda = (x: number) => x >= window.innerWidth - BORDA_PAINEL_PX;
    document.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const ir = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".nv-aba-lugar .at-ir");
      const aba = ir?.closest<HTMLElement>(".nv-aba-lugar");
      const agenteId = aba?.dataset.agente;
      if (!aba || !agenteId) return;
      arrasto = { agenteId, aba, x0: e.clientX, y0: e.clientY, id: e.pointerId, movendo: false };
    }, sinal);
    document.addEventListener("pointermove", (e) => {
      if (!arrasto || e.pointerId !== arrasto.id) return;
      const dx = e.clientX - arrasto.x0;
      if (!arrasto.movendo && Math.hypot(dx, e.clientY - arrasto.y0) < ARRASTO_MIN_PX) return;
      arrasto.movendo = true;
      arrasto.aba.classList.add("nv-aba-arrastando");
      arrasto.aba.style.transform = `translateX(${dx}px)`;
      document.documentElement.classList.toggle("nv-solta-painel", pertoDaBorda(e.clientX));
    }, sinal);
    const soltar = (e: PointerEvent) => {
      const a = arrasto;
      arrasto = null;
      document.documentElement.classList.remove("nv-solta-painel");
      if (!a || !a.movendo) return;
      a.aba.classList.remove("nv-aba-arrastando");
      a.aba.style.transform = "";
      engolirClique = true;
      depois(() => { engolirClique = false; }, 0);
      if (e.type === "pointercancel") return;
      if (pertoDaBorda(e.clientX)) {
        abasDeLugar = new Set(abasDeLugar);
        abasDeLugar.delete(a.agenteId);
        gravarAbas();
        desativarAba(a.agenteId);
        abrirPainel(a.agenteId);
        return;
      }
      // Reordena: antes do meio da primeira tarefa da fileira = no começo; depois = no fim.
      const primeira = a.aba.closest(".abas-tarefa")?.querySelector<HTMLElement>(".at-aba:not(.nv-aba-lugar):not(.at-nova)");
      const b = primeira?.getBoundingClientRect();
      posicaoDaAba.set(a.agenteId, b && e.clientX < b.left + b.width / 2 ? "inicio" : "fim");
      o.render();
    };
    document.addEventListener("pointerup", soltar, sinal);
    document.addEventListener("pointercancel", soltar, sinal);
    document.addEventListener("click", (e) => { if (engolirClique) { e.stopPropagation(); e.preventDefault(); engolirClique = false; } }, { capture: true, signal: ac.signal });
  }

  // ---- a folha do celular (D6, C) -----------------------------------------------------------------------------------------
  function abrirFolha(agenteId: string, lugar: LugarDaVista): void {
    montar();
    aberto = { agenteId, modo: "folha", lugar };
    if (!respostas.has(agenteId)) pedirVista(agenteId);
    mostrarFolha(true);
    pintarTopo();
    encaixarVista();
    folha.style.setProperty("--nv-folha-alto", "0px");
    void folha.offsetWidth;
    moverFolha(window.matchMedia?.("(orientation: landscape)").matches ? "cheia" : "meia");
  }

  let animacaoDaFolha: Animation | null = null;
  /**
   * Da altura de agora para a nova, por transform (FLIP): crescendo, a folha já tem a altura nova e sobe de onde estava;
   * encolhendo, desce até o ponto novo e só então perde a altura. Movimento reduzido: vai direto.
   */
  function animarFolha(de: number, para: number, embalo: boolean): void {
    animacaoDaFolha?.cancel();
    animacaoDaFolha = null;
    const por = (h: number): void => folha.style.setProperty("--nv-folha-alto", `${Math.round(h)}px`);
    if (typeof folha.animate !== "function" || Math.abs(para - de) < 1) { por(para); return; }
    // D8: a mola de 320 ms; com Reduzir movimento, "sem mola, 150 ms" (linear).
    const rm = reduzido();
    const duration = rm ? MS_FOLHA_REDUZIDO : MS_FOLHA;
    const easing = rm ? "linear" : embalo ? CURVA_FOLHA_EMBALO : CURVA_FOLHA;
    if (para > de) {
      por(para);
      animacaoDaFolha = folha.animate([{ transform: `translateY(${Math.round(para - de)}px)` }, { transform: "none" }], { duration, easing });
      return;
    }
    const a = folha.animate([{ transform: "none" }, { transform: `translateY(${Math.round(de - para)}px)` }], { duration, easing, fill: "forwards" });
    animacaoDaFolha = a;
    a.onfinish = () => { por(para); a.cancel(); if (animacaoDaFolha === a) animacaoDaFolha = null; };
  }

  function moverFolha(p: PosicaoDaFolha, embalo = false): void {
    const de = folha.getBoundingClientRect().height;
    posFolha = p;
    folha.dataset.pos = p;
    folha.classList.remove("arrastando");
    animarFolha(de, alturaDaFolha(p, window.innerHeight), embalo);
    if (p === "fechada" && aberto?.modo === "folha") {
      const id = aberto.agenteId;
      const v = vistas.get(id);
      if (v?.controleComPessoa()) { void v.devolver(); avisar(`Devolvido ${aoNome(nomeDe(id))}`, () => abrirPainel(id)); }
      v?.ligar(false);
      aberto = null;
      depois(() => { if (!aberto) mostrarFolha(false); }, reduzido() ? MS_FOLHA_REDUZIDO : MS_FOLHA);
    }
  }

  {
    let inicio: { y: number; alto: number; em: number; ultimoY: number; ultimoEm: number } | null = null;
    const pega = folha.querySelector<HTMLElement>(".nv-folha-pega")!;
    pega.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      // O dedo pega a folha no meio do caminho: ela termina onde ia (a altura certa) e segue o dedo dali.
      animacaoDaFolha?.finish();
      animacaoDaFolha = null;
      inicio = { y: e.clientY, alto: alturaDaFolha(posFolha, window.innerHeight), em: e.timeStamp, ultimoY: e.clientY, ultimoEm: e.timeStamp };
      folha.classList.add("arrastando");
      try { pega.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    });
    pega.addEventListener("pointermove", (e) => {
      if (!inicio) return;
      const alto = Math.max(0, Math.min(window.innerHeight, inicio.alto - (e.clientY - inicio.y)));
      folha.style.setProperty("--nv-folha-alto", `${alto}px`);
      inicio.ultimoY = e.clientY;
      inicio.ultimoEm = e.timeStamp;
    });
    const soltar = (e: PointerEvent): void => {
      if (!inicio) return;
      const alto = Math.max(0, inicio.alto - (e.clientY - inicio.y));
      const dt = Math.max(1, e.timeStamp - inicio.em);
      const vel = (e.clientY - inicio.y) / dt;
      inicio = null;
      moverFolha(soltarFolha(alto, window.innerHeight, vel), Math.abs(vel) > VELOCIDADE_DO_EMBALO);
    };
    pega.addEventListener("pointerup", soltar);
    pega.addEventListener("pointercancel", soltar);
  }

  // ---- a tela cheia (D1c) -------------------------------------------------------------------------------------------------
  function abrirTelaCheia(agenteId: string): void {
    if (telaCheia) { sairDaTelaCheia(); return; }
    const voltar = aberto ? { ...aberto } : null;
    const dialog = document.createElement("dialog");
    dialog.className = "ctc nv-tc";
    dialog.setAttribute("role", "region");
    dialog.setAttribute("aria-labelledby", "nv-tc-titulo");
    if ((window as { nodDesktop?: unknown }).nodDesktop !== undefined) dialog.classList.add("no-mac");
    dialog.innerHTML = `<header class="ctc-topo nv-tc-topo"><h1 class="ctc-titulo nv-tc-titulo" id="nv-tc-titulo"><span class="nv-tc-avatar" aria-hidden="true">${o.avatar?.(agenteId) ?? ""}</span><span class="nv-tc-titulo-txt"></span></h1><div class="nv-tc-lugares"></div><button type="button" class="nv-tc-sair" data-nv-p="sair" aria-keyshortcuts="${ariaTecla("Meta+Shift+F")}">${'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/></svg>'}<span>Sair da tela cheia</span></button></header>`
      + `<div class="nv-grav-topo" hidden></div>`
      + `<div class="nv-tc-meio"><div class="nv-tc-corpo"></div><div class="nv-tc-lado" hidden></div></div>`
      + `<div class="nv-recado"><form class="nv-recado-form" data-nv-form="recado" hidden><input class="nv-recado-input" name="texto" maxlength="2000" autocomplete="off" aria-label="Recado para ${esc(comArtigo(nomeDe(agenteId)))}" placeholder="Recado para ${esc(comArtigo(nomeDe(agenteId)))}…"><button type="submit" class="nv-recado-enviar">Mandar</button></form><button type="button" class="nv-recado-bt" data-nv-p="recado">Recado para ${esc(comArtigo(nomeDe(agenteId)))}</button></div>`;
    document.body.append(dialog);
    dialog.showModal();
    telaCheia = { agenteId, dialog, voltar };
    const v = vistaDe(agenteId);
    dialog.querySelector<HTMLElement>(".nv-tc-corpo")!.append(v.el);
    v.hospedar("tela-cheia");
    v.ligar(true);
    if (aberto?.modo === "painel") { painel.hidden = true; }
    if (aberto?.modo === "folha") mostrarFolha(false);
    pintarTelaCheia();
    // Esc não fecha (no controle ele vai ao site); só "Sair da tela cheia" e ⌘⇧F.
    dialog.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); }, true);
    dialog.addEventListener("cancel", (e) => e.preventDefault());
    dialog.addEventListener("click", (e) => cliqueDoPainel(e, agenteId));
    dialog.addEventListener("submit", (e) => {
      const nomear = (e.target as HTMLElement).closest<HTMLFormElement>("[data-nv-form=nomear]");
      if (nomear) {
        e.preventDefault();
        const nome = nomear.querySelector<HTMLInputElement>("input")?.value ?? "";
        void salvarGravacao(agenteId, nome);
        return;
      }
      const f = (e.target as HTMLElement).closest<HTMLFormElement>("[data-nv-form=recado]");
      if (!f) return;
      e.preventDefault();
      const input = f.querySelector<HTMLInputElement>("input")!;
      const texto = input.value.trim();
      if (!texto) return;
      input.value = "";
      f.hidden = true;
      dialog.querySelector<HTMLElement>(".nv-recado-bt")!.hidden = false;
      // Mandar recado devolve o controle, como no chat (D1c).
      void o.mandarRecado(agenteId, texto).then(() => { if (v.controleComPessoa()) return v.devolver(); }).catch(o.aoErro);
    });
    v.focar();
  }

  function pintarTelaCheia(): void {
    if (!telaCheia) return;
    const id = telaCheia.agenteId;
    const d = telaCheia.dialog;
    // D1c: o chip "● Ada" do Paper; com a D1d, o passo entra no mesmo chip ("Ada · lendo os voos diretos").
    const tit = d.querySelector<HTMLElement>(".nv-tc-titulo")!;
    const txt = tit.querySelector<HTMLElement>(".nv-tc-titulo-txt")!;
    const texto = legendaDoPasso(nomeDe(id), vistaAtual(id), "tela-cheia");
    if (txt.textContent !== texto) { txt.textContent = texto; tit.title = texto; }
    const lug = d.querySelector<HTMLElement>(".nv-tc-lugares")!;
    const html = htmlLugares(lugaresDe(id), "navegador", pontoDoLugar(vistaAtual(id)), { escuro: true }).replaceAll('data-nv="', 'data-nv-p="');
    if (lug.innerHTML !== html) lug.innerHTML = html;
    pintarGravacao();
  }

  // ---- ensinar uma tarefa (T2): a barra no topo, a moldura vermelha e os passos ao lado ------------------------------------
  function pintarGravacao(): void {
    if (!telaCheia) return;
    const id = telaCheia.agenteId;
    const d = telaCheia.dialog;
    const g = vistaAtual(id)?.gravacao ?? null;
    d.classList.toggle("nv-gravando", g !== null);
    const topoTc = d.querySelector<HTMLElement>(".nv-tc-topo")!;
    const barraG = d.querySelector<HTMLElement>(".nv-grav-topo")!;
    const lado = d.querySelector<HTMLElement>(".nv-tc-lado")!;
    topoTc.hidden = g !== null;
    barraG.hidden = g === null;
    lado.hidden = g === null;
    if (!g) {
      nomeando = false;
      pintadoGravacao = "";
      if (relogio) { window.clearInterval(relogio); relogio = 0; }
      return;
    }
    // A barra só se refaz quando os passos, o teto ou o campo do nome mudam: o relógio anda sozinho (o campo não perde o foco).
    const chave = `${g.desde}|${g.passos.length}|${g.parou ?? ""}|${nomeando ? "n" : ""}|${nomeDe(id)}`;
    if (chave !== pintadoGravacao) {
      const campo = barraG.querySelector<HTMLInputElement>(".nv-grav-nome-campo");
      const digitado = nomeando && campo ? campo.value : null;
      barraG.innerHTML = htmlBarraDeGravacao({ nome: nomeDe(id), gravacao: g, agora: Date.now(), nomeando });
      lado.innerHTML = htmlPassosGravados(g.passos);
      const novo = barraG.querySelector<HTMLInputElement>(".nv-grav-nome-campo");
      if (novo && digitado !== null) novo.value = digitado;
      pintadoGravacao = chave;
    }
    if (!relogio) {
      relogio = window.setInterval(() => {
        const vg = telaCheia ? vistaAtual(telaCheia.agenteId)?.gravacao : null;
        const r = telaCheia?.dialog.querySelector<HTMLElement>(".nv-grav-relogio");
        if (!vg || !r) { window.clearInterval(relogio); relogio = 0; return; }
        const t = rotuloDaGravacao(vg, Date.now());
        if (r.textContent !== t) r.textContent = t;
      }, MS_RELOGIO_GRAVACAO);
    }
  }

  /** A vista nova que uma operação de ensinar devolveu: guarda, repassa à vista montada e redesenha. */
  function aplicarVista(agenteId: string, vista: VistaNavegador): void {
    const r: RespostaNavegador = { vista, disponivel: respostas.get(agenteId)?.disponivel ?? true };
    respostas.set(agenteId, r);
    vistas.get(agenteId)?.atualizar(r);
    o.guardarVista(agenteId, r);
    pintarTopo();
    pintarTelaCheia();
    avisarDescarte(agenteId, vista);
  }

  async function operarEnsinar(agenteId: string, op: "comecar" | "descartar" | "salvar" | "desfazer_descarte", nome?: string): Promise<boolean> {
    const api = o.api();
    if (!api?.ensinarNoNavegador) return false;
    try {
      const r = await api.ensinarNoNavegador(agenteId, op, nome);
      aplicarVista(agenteId, r.vista);
      return true;
    } catch (e) { o.aoErro(e); return false; }
  }

  /**
   * T1: "Ensinar uma tarefa" (o + do campo e o ⋯ do navegador). Liga ou retoma o navegador se precisar, assume o controle,
   * abre a tela cheia e começa a gravar (o servidor só grava com a pessoa no controle).
   */
  async function ensinar(agenteId: string): Promise<void> {
    montar();
    if (!respostas.has(agenteId)) {
      const api = o.api();
      if (api) { try { const r = await api.navegador(agenteId); respostas.set(agenteId, r); o.guardarVista(agenteId, r); } catch (e) { o.aoErro(e); return; } }
    }
    const v = vistaDe(agenteId);
    v.atualizar(respostas.get(agenteId) ?? null);
    const estadoAgora = vistaAtual(agenteId)?.estado;
    if (estadoAgora === "desligado" || estadoAgora === "erro") await v.operar("ligar");
    else if (estadoAgora === "pausa") await v.operar("retomar");
    if (!telaCheia || telaCheia.agenteId !== agenteId) abrirTelaCheia(agenteId);
    if (!v.controleComPessoa()) await v.assumir();
    if (!v.controleComPessoa()) return;
    await operarEnsinar(agenteId, "comecar");
  }

  async function salvarGravacao(agenteId: string, nome: string): Promise<void> {
    const ok = await operarEnsinar(agenteId, "salvar", nome.trim() || undefined);
    if (!ok) return;
    nomeando = false;
    avisar(`Ensinado. A mensagem com os passos foi para ${comArtigo(nomeDe(agenteId))}.`, null);
    // A tarefa foi para a conversa: sair da tela cheia devolve o navegador ao bot.
    if (telaCheia?.agenteId === agenteId) sairDaTelaCheia();
  }

  /** T2: devolver no meio (ou Descartar) jogou a gravação fora; o aviso com Desfazer sai uma vez por descarte. */
  function avisarDescarte(agenteId: string, v: VistaNavegador): void {
    const d = v.descarte;
    if (!d || d.ate <= Date.now() || descartesAvisados.get(agenteId) === d.ate) return;
    descartesAvisados.set(agenteId, d.ate);
    avisar(`Gravação descartada${d.passos ? ` (${d.passos} ${d.passos === 1 ? "passo" : "passos"})` : ""}`, () => void desfazerDescarte(agenteId));
  }

  async function desfazerDescarte(agenteId: string): Promise<void> {
    const v = vistaDe(agenteId);
    if (!telaCheia || telaCheia.agenteId !== agenteId) abrirTelaCheia(agenteId);
    if (!v.controleComPessoa()) await v.assumir();
    await operarEnsinar(agenteId, "desfazer_descarte");
  }

  function sairDaTelaCheia(voltarParaOnde = true): void {
    const t = telaCheia;
    if (!t) return;
    telaCheia = null;
    nomeando = false;
    pintadoGravacao = "";
    if (relogio) { window.clearInterval(relogio); relogio = 0; }
    const v = vistas.get(t.agenteId);
    // Sair no controle devolve ao bot, como a tela cheia do computador.
    if (v?.controleComPessoa()) void v.devolver();
    v?.el.remove();
    t.dialog.close();
    t.dialog.remove();
    if (voltarParaOnde && t.voltar) {
      aberto = null;
      if (t.voltar.modo === "aba") mostrarAba(t.voltar.agenteId);
      else if (t.voltar.modo === "folha") abrirFolha(t.voltar.agenteId, t.voltar.lugar);
      else abrirPainel(t.voltar.agenteId, t.voltar.lugar);
    } else v?.ligar(false);
  }

  // ---- os cliques do painel, da folha e da tela cheia ----------------------------------------------------------------------
  let menuAberto: HTMLElement | null = null;
  function fecharMenu(): void { menuAberto?.remove(); menuAberto = null; }

  function abrirMenu(agenteId: string, ancora: { x: number; y: number }, daAba: boolean): void {
    fecharMenu();
    const v = vistaAtual(agenteId);
    const url = v?.abas.find((a) => a.ativa)?.url ?? "";
    const m = document.createElement("div");
    m.className = "nv-menu";
    m.innerHTML = htmlMenuDoNavegador(nomeDe(agenteId), { daAba, temEndereco: !!url, controle: v?.controle === "pessoa", ensinar: !o.celular() && !!o.api()?.ensinarNoNavegador && !v?.gravacao, trazerDoChrome: !!o.trazerDoChrome });
    const host = telaCheia?.dialog ?? document.body;
    host.append(m);
    const b = m.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(window.innerWidth - b.width - 8, ancora.x))}px`;
    m.style.top = `${Math.max(8, Math.min(window.innerHeight - b.height - 8, ancora.y))}px`;
    menuAberto = m;
    m.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    m.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharMenu(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const itens = [...m.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const i = itens.indexOf(document.activeElement as HTMLElement);
      itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length]?.focus();
    });
    m.addEventListener("click", (e) => {
      const it = (e.target as HTMLElement).closest<HTMLElement>("[data-nv-menu]");
      if (!it || (it as HTMLButtonElement).disabled) return;
      const acao = it.dataset.nvMenu;
      const vm = vistaDe(agenteId);
      const agoraV = vistaAtual(agenteId);
      if (acao === "encerrar" && agoraV && botNoMeio(agoraV, Date.now()) && !m.querySelector(".nv-menu-confirma")) {
        // D1c: Encerrar pergunta antes só se o bot está no meio de algo (é o único item que não dá para desfazer).
        m.innerHTML = `<div class="nv-menu-corpo nv-menu-confirma" role="alertdialog" aria-label="Encerrar o navegador"><p><b>Encerrar o navegador ${esc(deNome(nomeDe(agenteId)))}?</b><span>${esc(fraseMaiuscula(comArtigo(nomeDe(agenteId))))} está no meio de algo. As abas fecham; os logins ficam.</span></p><div class="nv-menu-bts"><button type="button" data-nv-menu="cancelar">Cancelar</button><button type="button" class="danger" data-nv-menu="encerrar">Encerrar</button></div></div>`;
        m.querySelector<HTMLElement>('[data-nv-menu="cancelar"]')?.focus();
        return;
      }
      fecharMenu();
      if (acao === "recarregar") void vm.operar("recarregar");
      else if (acao === "copiar") void navigator.clipboard?.writeText(url).catch(() => undefined);
      else if (acao === "abrir-fora" && url) o.abrirFora(url);
      else if (acao === "logins") o.abrirLogins(agenteId, url);
      else if (acao === "trazer-chrome") o.trazerDoChrome?.(agenteId);
      else if (acao === "ensinar") void ensinar(agenteId);
      else if (acao === "encerrar") void vm.operar("encerrar");
      else if (acao === "ao-lado") { abasDeLugar = new Set(abasDeLugar); abasDeLugar.delete(agenteId); gravarAbas(); desativarAba(agenteId); abrirPainel(agenteId); }
      else if (acao === "assumir") void vm.assumir();
      else if (acao === "tela-cheia") abrirTelaCheia(agenteId);
      else if (acao === "fechar-aba") fecharAba(agenteId);
      else if (acao === "fechar-outras") { for (const id of [...abasDeLugar]) if (id !== agenteId) fecharAba(id, false); }
    });
    depois(() => document.addEventListener("pointerdown", fora, true), 0);
    function fora(e: Event): void {
      if (menuAberto && !menuAberto.contains(e.target as Node)) { fecharMenu(); document.removeEventListener("pointerdown", fora, true); }
    }
  }

  function cliqueDoPainel(e: MouseEvent, agenteIdFixo?: string): void {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-nv-p]");
    const id = agenteIdFixo ?? aberto?.agenteId;
    if (!el || !id) return;
    const c = el.dataset.nvP;
    if (c === "fechar") fechar();
    else if (c === "em-aba") { const ag = id; fecharSemDevolver(); abrirAba(ag); }
    else if (c === "ao-lado") { abasDeLugar = new Set(abasDeLugar); abasDeLugar.delete(id); gravarAbas(); desativarAba(id); abrirPainel(id); }
    else if (c === "tela-cheia") abrirTelaCheia(id);
    else if (c === "sair") sairDaTelaCheia();
    else if (c === "descartar-gravacao") void operarEnsinar(id, "descartar");
    else if (c === "salvar-gravacao") { nomeando = true; pintarGravacao(); const campo = telaCheia?.dialog.querySelector<HTMLInputElement>(".nv-grav-nome-campo"); campo?.focus(); campo?.select(); }
    else if (c === "nomear-cancelar") { nomeando = false; pintarGravacao(); telaCheia?.dialog.querySelector<HTMLElement>('[data-nv-p="salvar-gravacao"]')?.focus(); }
    else if (c === "menu") { const b = el.getBoundingClientRect(); abrirMenu(id, { x: b.right - 240, y: b.bottom + 6 }, false); }
    else if (c === "abrir-computador") o.abrirComputador(id);
    else if (c === "recado") {
      const f = telaCheia?.dialog.querySelector<HTMLFormElement>(".nv-recado-form");
      if (f) { f.hidden = false; el.hidden = true; f.querySelector<HTMLInputElement>("input")?.focus(); }
    } else if (c === "lugar") {
      const l = el.dataset.lugar as LugarDaVista | undefined;
      if (!l) return;
      if (telaCheia) { if (l === "computador") { sairDaTelaCheia(false); o.abrirComputador(id); } return; }
      if (!aberto || aberto.lugar === l) return;
      aberto = { ...aberto, lugar: l };
      // D8: trocar de lugar — a pílula branca desliza e a vista faz um fade cruzado de 180 ms.
      // Com Reduzir movimento, "fade 100 ms" (Paper XKT-0): a animação do elemento vale por cima do corte geral do CSS.
      (aberto.modo === "folha" ? folhaCorpo : corpo).animate?.([{ opacity: 0.2 }, { opacity: 1 }], reduzido() ? { duration: 100, easing: "linear" } : { duration: 180, easing: "ease-out" });
      pintarTopo();
      encaixarVista();
    }
  }

  function fecharSemDevolver(): void {
    if (!aberto) return;
    vistas.get(aberto.agenteId)?.ligar(false);
    painel.hidden = true;
    aberto = null;
    classesDaApp();
  }

  painel.addEventListener("click", (e) => cliqueDoPainel(e));
  folha.addEventListener("click", (e) => cliqueDoPainel(e));

  // D6, B: com o painel cobrindo a conversa, clicar na conversa recolhe.
  document.addEventListener("pointerdown", (e) => {
    if (!aberto || aberto.modo !== "painel" || !painel.classList.contains("nv-cobrindo")) return;
    const t = e.target as HTMLElement;
    if (painel.contains(t) || menuAberto?.contains(t) || !t.closest?.(".stage")) return;
    fechar();
  }, { capture: true, ...sinal });

  // ---- a alça de largura (D5) ---------------------------------------------------------------------------------------------
  {
    let arrasto: { x0: number; l0: number } | null = null;
    let ultimoEncaixe: number | null = null;
    alca.addEventListener("pointerdown", (e) => {
      if (modo() !== "lado") return;
      e.preventDefault();
      arrasto = { x0: e.clientX, l0: largura };
      painel.classList.add("arrastando");
      document.documentElement.classList.add("nv-arrastando");
      try { alca.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    });
    alca.addEventListener("pointermove", (e) => {
      if (!arrasto) return;
      const ar = area();
      const bruto = arrasto.l0 + (arrasto.x0 - e.clientX);
      const solta = soltarFecha(bruto);
      const { largura: l, encaixe } = imantar(Math.min(bruto, ar - 420), ar);
      const final = solta ? PAINEL_MIN : Math.max(PAINEL_MIN, l);
      // D8: o ímã anima 120 ms; fora dele, 1:1.
      app()?.style.setProperty("--nv-dur", encaixe !== ultimoEncaixe && encaixe !== null ? "120ms" : "0ms");
      app()?.classList.toggle("nv-animando", encaixe !== null && encaixe !== ultimoEncaixe);
      ultimoEncaixe = encaixe;
      aplicarLargura(final);
      painel.classList.toggle("soltar-fecha", solta);
      selo.hidden = false;
      selo.textContent = solta ? "Solte para fechar" : `${Math.round((final / ar) * 100)}%`;
    });
    const fim = (): void => {
      if (!arrasto) return;
      arrasto = null;
      app()?.classList.remove("nv-animando");
      painel.classList.remove("arrastando");
      document.documentElement.classList.remove("nv-arrastando");
      selo.hidden = true;
      if (painel.classList.contains("soltar-fecha")) { painel.classList.remove("soltar-fecha"); aplicarLargura(larguraLembrada()); fechar(); return; }
      guardar(chaveDaLargura(), gravarLargura(largura, area()));
    };
    alca.addEventListener("pointerup", fim);
    alca.addEventListener("pointercancel", fim);
    alca.addEventListener("dblclick", () => {
      const l = larguraPadrao(area());
      app()?.classList.add("nv-animando");
      app()?.style.setProperty("--nv-dur", "200ms");
      aplicarLargura(l);
      depois(() => app()?.classList.remove("nv-animando"), 220);
      guardar(chaveDaLargura(), gravarLargura(l, area()));
    });
    alca.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const l = limitarLargura(largura + (e.key === "ArrowLeft" ? 24 : -24), area());
      aplicarLargura(l);
      guardar(chaveDaLargura(), gravarLargura(l, area()));
    });
  }

  function trocarEncaixe(passo: -1 | 1): void {
    if (!aberto || aberto.modo !== "painel" || modo() !== "lado") return;
    const l = proximoEncaixe(largura, area(), passo);
    const a = app();
    if (a && !reduzido()) { a.classList.add("nv-animando"); a.style.setProperty("--nv-dur", "200ms"); depois(() => a.classList.remove("nv-animando"), 220); }
    aplicarLargura(l);
    guardar(chaveDaLargura(), gravarLargura(l, area()));
  }

  // D6, C: girar o celular para paisagem leva a folha à tela cheia (a vista ganha a largura toda); de volta em pé, ela fica
  // onde estava. A altura da folha acompanha a da janela em qualquer giro.
  const paisagem = window.matchMedia?.("(orientation: landscape)");
  let antesDaPaisagem: PosicaoDaFolha | null = null;
  paisagem?.addEventListener?.("change", (e) => {
    if (aberto?.modo !== "folha") return;
    if (e.matches) { antesDaPaisagem = posFolha; moverFolha("cheia"); }
    else { moverFolha(antesDaPaisagem ?? posFolha); antesDaPaisagem = null; }
  }, sinal);

  window.addEventListener("resize", () => {
    if (aberto?.modo === "folha" && !folha.classList.contains("arrastando")) folha.style.setProperty("--nv-folha-alto", `${alturaDaFolha(posFolha, window.innerHeight)}px`);
    if (!aberto || aberto.modo !== "painel") return;
    aplicarLargura(modo() === "cobre" ? Math.min(area(), Math.max(PAINEL_MIN, Math.round(area() * 0.72))) : larguraLembrada());
    classesDaApp();
  }, sinal);

  // ---- o aviso com Desfazer (D4 E; D7; D8: sobe 8 px, 5 s, pausa com o mouse) ---------------------------------------------
  let avisoEl: HTMLElement | null = null;
  function avisar(texto: string, desfazer: (() => void) | null, atalho?: string): void {
    if (o.avisar) { o.avisar(texto, desfazer, atalho); return; }
    avisoEl?.remove();
    const el = document.createElement("div");
    el.className = "nv-aviso";
    el.setAttribute("role", "status");
    el.innerHTML = `<span>${esc(texto)}</span>${desfazer ? `<button type="button" class="nv-aviso-desfazer">Desfazer${atalho ? `<kbd>${esc(atalho)}</kbd>` : ""}</button>` : ""}`;
    document.body.append(el);
    avisoEl = el;
    // D8 (reduzir movimento; Paper XMD-0): o aviso aparece e some num fade de 100 ms. O corte geral de animações CSS do app
    // (interface.css) apaga a animação do CSS; a do elemento (Web Animations) vale.
    if (reduzido()) el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: "linear" });
    let resta = MS_AVISO;
    let desde = Date.now();
    let timer = depois(sair, resta);
    function sair(): void {
      if (avisoEl !== el) return;
      el.classList.add("saindo");
      if (reduzido()) el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "linear", fill: "forwards" });
      depois(() => el.remove(), reduzido() ? 100 : 200);
      avisoEl = null;
    }
    el.addEventListener("mouseenter", () => { window.clearTimeout(timer); resta -= Date.now() - desde; });
    el.addEventListener("mouseleave", () => { desde = Date.now(); timer = depois(sair, Math.max(800, resta)); });
    el.querySelector("button")?.addEventListener("click", () => { window.clearTimeout(timer); sair(); desfazer?.(); });
  }

  // ---- o teclado (D5; D1c; D4 C; D7) --------------------------------------------------------------------------------------
  const noMac = /Mac|iPhone|iPad/.test(navigator.platform);
  window.addEventListener("keydown", (e) => {
    const mod = noMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.repeat) return;
    const k = e.key.toLowerCase();
    const id = telaCheia?.agenteId ?? aberto?.agenteId ?? botDaTela;
    if (!id) return;
    if (k === "\\" && !e.shiftKey && !e.altKey && botDaTela && !telaCheia) { e.preventDefault(); e.stopPropagation(); alternar(botDaTela); return; }
    if (e.shiftKey && k === "f" && (telaCheia || aberto)) { e.preventDefault(); e.stopPropagation(); if (telaCheia) sairDaTelaCheia(); else abrirTelaCheia(id); return; }
    if (e.shiftKey && k === "a") { const v = vistas.get(id); if (v?.controleComPessoa()) { e.preventDefault(); e.stopPropagation(); void v.devolver(); } return; }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && aberto?.modo === "painel") { e.preventDefault(); e.stopPropagation(); trocarEncaixe(e.key === "ArrowLeft" ? -1 : 1); return; }
    if (!e.shiftKey && k === "w" && aberto?.modo === "aba" && !telaCheia) { e.preventDefault(); e.stopPropagation(); fecharAba(aberto.agenteId); return; }
    if (e.shiftKey && k === "t" && fechadas.length && !telaCheia) { e.preventDefault(); e.stopPropagation(); reabrirFechada(); }
  }, { capture: true, ...sinal });

  // ---- a dica da aba de lugar (D7: depois de 600 ms) e o clique do meio ---------------------------------------------------
  {
    let timerDica = 0;
    let dicaEl: HTMLElement | null = null;
    const tirarDica = (): void => { if (timerDica) window.clearTimeout(timerDica); timerDica = 0; dicaEl?.remove(); dicaEl = null; };
    document.addEventListener("pointerover", (e) => {
      const b = (e.target as HTMLElement).closest?.<HTMLElement>(".nv-aba-lugar .at-ir");
      if (!b) { if (dicaEl || timerDica) tirarDica(); return; }
      if (timerDica || dicaEl) return;
      timerDica = depois(() => {
        timerDica = 0;
        const r = b.getBoundingClientRect();
        dicaEl = document.createElement("div");
        dicaEl.className = "nv-dica-aba";
        dicaEl.textContent = b.dataset.dica ?? "";
        dicaEl.style.left = `${r.left}px`;
        dicaEl.style.top = `${r.bottom + 6}px`;
        document.body.append(dicaEl);
      }, MS_DICA_ABA);
    }, sinal);
    document.addEventListener("pointerdown", () => tirarDica(), { capture: true, ...sinal });
    document.addEventListener("auxclick", (e) => {
      const aba = (e.target as HTMLElement).closest?.<HTMLElement>(".nv-aba-lugar");
      if (e.button !== 1 || !aba?.dataset.agente) return;
      e.preventDefault();
      fecharAba(aba.dataset.agente);
    }, sinal);
    document.addEventListener("contextmenu", (e) => {
      const aba = (e.target as HTMLElement).closest?.<HTMLElement>(".nv-aba-lugar");
      if (!aba?.dataset.agente) return;
      e.preventDefault();
      abrirMenu(aba.dataset.agente, { x: e.clientX, y: e.clientY }, true);
    }, sinal);
  }

  function pedirVista(agenteId: string): void {
    if (pedidos.has(agenteId)) return;
    pedidos.add(agenteId);
    o.lerVista(agenteId);
  }

  return {
    /**
     * Depois de cada render: o bot da conversa à vista (da dona; null fora dela), a vista que o reducer tem de cada bot e se
     * a tela é a conversa (a aba e o painel só ficam com a conversa do bot à vista).
     */
    sincronizar(s: { agenteId: string | null; navegadores: Readonly<Record<string, RespostaNavegador | null>> }): void {
      montar();
      botDaTela = s.agenteId;
      for (const [id, r] of Object.entries(s.navegadores)) {
        if (respostas.get(id) === r) continue;
        respostas.set(id, r);
        vistas.get(id)?.atualizar(r);
        if (r) avisarDescarte(id, r.vista);
      }
      if (s.agenteId && !Object.hasOwn(s.navegadores, s.agenteId)) pedirVista(s.agenteId);
      // Saiu da conversa do bot: o painel e a aba somem (o bot continua); a tela cheia fica até a pessoa sair.
      if (aberto && aberto.agenteId !== s.agenteId && aberto.modo !== "folha") {
        if (aberto.modo === "aba") desativarAba(aberto.agenteId);
        else fechar({ aviso: false });
      }
      pintarTopo();
      pintarTelaCheia();
    },
    /** O bot tem o navegador (o botão do canto e a linha só aparecem com ele). */
    tem(agenteId: string): boolean {
      const r = respostas.get(agenteId);
      return !!r && (r.disponivel || r.vista.estado !== "desligado");
    },
    htmlBotaoDoCanto(agenteId: string): string {
      if (!this.tem(agenteId)) return "";
      // C1 e 1a (Paper): com o painel aberto ao lado, o botão do canto sai; o painel tem o × e o ⌘\ fecha.
      if (aberto?.agenteId === agenteId && aberto.modo === "painel") return "";
      return htmlBotaoDoCanto(agenteId, vistaAtual(agenteId), false);
    },
    /**
     * 5c (2 e 3): o lugar ativo do bot (vivo, esperando a pessoa ou com ela no controle), para o botão de abas e a pílula do
     * campo. null = nenhum (parado, desligado, sem navegador).
     */
    lugarAtivo(agenteId: string): LugarAtivo | null {
      if (!this.tem(agenteId)) return null;
      const v = vistaAtual(agenteId);
      if (!lugarFechadoAMao(v)) return null;
      const e = estadoDaAbaDeLugar(v);
      return {
        agenteId,
        rotulo: `Navegador ${deNome(nomeDe(agenteId))}`,
        estado: e === "precisa" ? "precisa de você" : e === "controle" ? "você está no controle" : "ao vivo",
        ponto: e === "precisa" ? "precisa" : "vivo",
        site: v ? tituloDaAbaAtiva(v) : "",
      };
    },
    /** 5c (2): o botão de abas leva o lugar ativo para a fileira, sem abri-lo (a Conversa continua à vista). */
    porNaFileira(agenteId: string): void {
      if (abasDeLugar.has(agenteId)) return;
      abasDeLugar = new Set(abasDeLugar).add(agenteId);
      gravarAbas();
    },
    htmlLinha(agenteId: string): string {
      const v = vistaAtual(agenteId);
      if (!this.tem(agenteId) || !v || !linhaDoNavegadorVisivel(v, Date.now())) return "";
      return htmlLinhaDoNavegador(nomeDe(agenteId), agenteId, v, { modoAbas: o.modoAbas(agenteId) });
    },
    /** A aba de lugar para a fileira (D7), e se ela passa à frente (precisa de você). */
    abaNaFileira(agenteId: string): { html: string; frente: boolean; ativa: boolean } | null {
      if (!abasDeLugar.has(agenteId)) return null;
      const v = vistaAtual(agenteId);
      return { html: htmlAbaDeLugar(agenteId, nomeDe(agenteId), v, abaAtiva === agenteId), frente: estadoDaAbaDeLugar(v) === "precisa" || posicaoDaAba.get(agenteId) === "inicio", ativa: abaAtiva === agenteId };
    },
    /** 5e: os lugares fechados deste bot que ainda estão à mão (o bot vivo neles). */
    lugaresFechados(agenteId: string): { quantos: number; ponto: "vivo" | "precisa" | null; html: string } | null {
      if (abasDeLugar.has(agenteId) || !fechadas.includes(agenteId)) return null;
      const v = vistaAtual(agenteId);
      if (!lugarFechadoAMao(v)) return null;
      const e = estadoDaAbaDeLugar(v);
      return { quantos: 1, ponto: e === "precisa" ? "precisa" : e === "vivo" || e === "controle" ? "vivo" : null, html: htmlLugaresFechados([{ agenteId, nome: nomeDe(agenteId), vista: v }]) };
    },
    abaAberta: (agenteId: string): boolean => abasDeLugar.has(agenteId),
    abaAtiva: (agenteId: string): boolean => abaAtiva === agenteId,
    painelAberto: (agenteId: string): boolean => aberto?.agenteId === agenteId && aberto.modo === "painel",
    /**
     * O painel do bot vai tomar a coluna: o navegador aberto ao lado sai (sem devolver o controle) e fica guardado. Devolve
     * quanto a saída leva (ms; 0 sem animação), para o painel do bot entrar DEPOIS — os dois de uma vez, ele entrava
     * escondido atrás do navegador e aparecia de estalo no fim (2026-11-22, pedido do dono); null = não havia navegador.
     */
    recolherParaOPainelDoBot(): number | null {
      if (aberto?.modo !== "painel") return null;
      const r = { agenteId: aberto.agenteId, lugar: aberto.lugar };
      const anima = !reduzido() && modo() === "lado";
      fechar({ devolver: false, aviso: false });
      recolhido = r;
      return anima ? MS_PAINEL_FECHA : 0;
    },
    /** O painel do bot fechou: o navegador que ele recolheu volta (só o do mesmo bot). */
    voltarDoPainelDoBot(agenteId: string | null): boolean {
      const r = recolhido;
      recolhido = null;
      if (!r || r.agenteId !== agenteId) return false;
      abrirPainel(r.agenteId, r.lugar);
      return true;
    },
    /** D6 B: o painel aberto cobre a conversa (janela estreita). */
    cobrindo: (): boolean => aberto?.modo === "painel" && modo() === "cobre",
    alternar,
    ver,
    abrirPainel,
    abrirAba,
    mostrarAba,
    desativarAba,
    fecharAba,
    abrirTelaCheia,
    reabrirFechada,
    ensinar,
    /** O "Assumir o controle" dos cartões de ajuda: abre a vista e assume. */
    assumir(agenteId: string): void { ver(agenteId); void vistaDe(agenteId).assumir(); },
    /** O "Já resolvi" dos cartões de ajuda. */
    resolver(agenteId: string): Promise<void> { return vistaDe(agenteId).operar("resolver"); },
    fechar: () => fechar(),
    /** Solta tudo (os testes): os ouvintes, as vistas, o painel e a folha. */
    destruir(): void {
      ac.abort();
      for (const t of temporizadores) window.clearTimeout(t);
      temporizadores.clear();
      if (relogio) { window.clearInterval(relogio); relogio = 0; }
      for (const v of vistas.values()) v.destruir();
      vistas.clear();
      telaCheia?.dialog.remove();
      telaCheia = null;
      painel.remove();
      folha.remove();
      avisoEl?.remove();
      fecharMenu();
    },
    /** Para os testes: o hospedeiro atual. */
    onde: (): { agenteId: string; modo: Hospedeiro } | null => telaCheia ? { agenteId: telaCheia.agenteId, modo: "tela-cheia" } : aberto ? { agenteId: aberto.agenteId, modo: aberto.modo } : null,
  };
}
