import { BrowserWindow, screen } from "electron";
import { ALTURA_ILHA, HTML_BORDA, htmlDaIlha, LARGURA_ILHA, SOME_MS } from "./ilha-html.ts";

export { htmlDaIlha };

/**
 * A ilha do computador da pessoa (ADR-197, item 6; Paper "Seu computador", S2/S3): enquanto um bot mexe num app do
 * Mac ou do PC, uma pílula escura no topo da tela diz quem, onde e o passo, com "Parar". Some sozinha depois de
 * SOME_MS sem ação. É uma janela do próprio nod (transparente, sem foco, por cima de tudo e em todas as mesas), então
 * nunca rouba o teclado da pessoa. "Parar" derruba o driver na hora (o bot recebe "a pessoa parou").
 *
 * O texto vem do app (nome do bot e do app como o sistema dá), escapado; a página não carrega nada de fora.
 */
export type CaixaNaTela = { x: number; y: number; largura: number; altura: number };
export type Ilha = { mostrar(p: { bot: string; app: string; acao: string; janela?: CaixaNaTela | null }): void; esconder(): void };

export function criarIlha(o: { aparelho: "Mac" | "PC"; aoParar: () => void }): Ilha {
  let janela: BrowserWindow | null = null;
  let borda: BrowserWindow | null = null;
  let relogio: ReturnType<typeof setTimeout> | null = null;

  /** A borda âmbar em volta da janela que o bot usa: por cima, transparente e sem receber clique (passa para o app). */
  function mostrarBorda(c: CaixaNaTela): void {
    const folga = 3;
    const caixa = { x: Math.round(c.x - folga), y: Math.round(c.y - folga), width: Math.round(c.largura + 2 * folga), height: Math.round(c.altura + 2 * folga) };
    if (!borda || borda.isDestroyed()) {
      borda = new BrowserWindow({ ...caixa, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, title: "nod",
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false } });
      borda.setIgnoreMouseEvents(true);
      borda.setAlwaysOnTop(true, "floating");
      borda.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      borda.on("closed", () => { borda = null; });
      void borda.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML_BORDA)}`);
    } else borda.setBounds(caixa);
    if (!borda.isVisible()) borda.showInactive();
  }
  let ultimo = "";

  function abrir(): BrowserWindow {
    if (janela && !janela.isDestroyed()) return janela;
    const area = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({
      x: Math.round(area.x + (area.width - LARGURA_ILHA) / 2), y: area.y + 8, width: LARGURA_ILHA, height: ALTURA_ILHA,
      show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, title: "nod",
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false },
    });
    w.setAlwaysOnTop(true, "screen-saver");
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // O único link da página é "Parar": a navegação é interceptada e nunca acontece.
    w.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (url === "nod-ilha://parar") { esconder(); o.aoParar(); } });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.on("closed", () => { janela = null; ultimo = ""; });
    janela = w;
    return w;
  }

  function esconder(): void {
    if (relogio) { clearTimeout(relogio); relogio = null; }
    if (janela && !janela.isDestroyed()) janela.hide();
    if (borda && !borda.isDestroyed()) borda.hide();
  }

  return {
    mostrar(p) {
      const w = abrir();
      const html = htmlDaIlha({ ...p, aparelho: o.aparelho });
      if (html !== ultimo) { ultimo = html; void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`); }
      if (!w.isVisible()) w.showInactive();
      if (p.janela) mostrarBorda(p.janela);
      if (relogio) clearTimeout(relogio);
      relogio = setTimeout(esconder, SOME_MS);
      relogio.unref?.();
    },
    esconder,
  };
}
