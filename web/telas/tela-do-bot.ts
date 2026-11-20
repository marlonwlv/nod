import type { Api } from "../lib/api.ts";
import type { EstadoComputadorBot } from "../estado/reducer.ts";
import { estadoDoComputador } from "../lib/computador.ts";
import { telaCheiaAberta } from "./tela-cheia.ts";

/**
 * O pulso do computador do bot no painel (definido em 2026-10-16; ADR-125). Sem o computador da pessoa (v1), lê o estado
 * a cada 3 s com o cartão à vista (`[data-comp-bot]`) e o entrega por `aoVer` (ligado, dormindo, sem computador, fora
 * do ar). Card D (2026-11-12): a miniatura nunca mostra a imagem da tela; o pulso não observa mais (sem captura a cada
 * 3 s). A tela só se vê no visualizador em tela cheia (web/telas/tela-cheia.ts).
 */
let alvo: { api: Api; agenteId: string } | null = null;
let timer = 0;
let emCurso = false;
let vistaAntes = false;
/** O bot da última leitura que deu certo: um erro solto depois dela não troca o estado por "erro". */
let lido = "";
let aoVer: (agenteId: string, estado: EstadoComputadorBot) => void = () => {};

/** Quem recebe o estado lido a cada pulso (o main.ts grava no estado da gaveta). */
export function aoVerComputador(f: (agenteId: string, estado: EstadoComputadorBot) => void): void {
  aoVer = f;
}

export function definirTelaDoBot(api: Api | null, agenteId: string | null): void {
  if (!api || !agenteId) {
    alvo = null;
    vistaAntes = false;
    if (timer) { window.clearInterval(timer); timer = 0; }
    return;
  }
  alvo = { api, agenteId };
  // O cartão acabou de aparecer: lê agora, sem esperar o próximo tique (um pulso por abertura, não por render).
  const vista = cartaoAVista();
  const abriu = vista && !vistaAntes;
  vistaAntes = vista;
  if (timer) { if (abriu) void pulso(); return; }
  void pulso();
  timer = window.setInterval(() => void pulso(), 3000);
}

function cartaoAVista(): boolean {
  return !!alvo && !!document.querySelector(`[data-comp-bot="${CSS.escape(alvo.agenteId)}"]`) && painelAVista();
}

function painelAVista(): boolean {
  const app = document.querySelector(".app");
  if (!app?.classList.contains("com-detalhes") || document.hidden) return false;
  if (window.matchMedia("(max-width: 1099px)").matches) return app.classList.contains("detalhes-abertos");
  return !app.classList.contains("detalhes-ocultos");
}

async function pulso(): Promise<void> {
  // Com a tela aberta (a cheia ou o diálogo do Modo dev), quem lê o computador é ela.
  if (!alvo || emCurso || !cartaoAVista() || telaCheiaAberta() || document.querySelector(".computador-dialog")) return;
  const { api, agenteId } = alvo;
  emCurso = true;
  try {
    const dto = await api.computador(agenteId);
    if (alvo?.agenteId !== agenteId) return;
    lido = agenteId;
    aoVer(agenteId, estadoDoComputador(dto, Date.now()));
  } catch {
    if (alvo?.agenteId === agenteId && lido !== agenteId) aoVer(agenteId, "erro");
  } finally {
    emCurso = false;
  }
}
