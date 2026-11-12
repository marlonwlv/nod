import { BrowserWindow, globalShortcut, screen } from "electron";
import { criarQuickChat, posicaoDaJanela, urlDoQuickChat, type JanelaQuickChat, type QuickChat } from "./quick-chat.ts";

/**
 * A cola do Quick Chat com o Electron (ADR-173). A lógica (atalho, alternar, recusa do atalho em uso) é de
 * quick-chat.ts; aqui só a janela de verdade e o `globalShortcut`.
 *
 * A janela: 560×392 (rodada 3 do Paper), sem moldura, flutuando sobre os outros apps e em todas as mesas (como o Spotlight), na partição
 * e com o preload da janela web (`nodDesktop` e nada mais). Perde o foco = esconde; Esc é da página
 * (web/lib/quick-chat.ts chama `quickChatEsconder`). Nunca vira janela principal: o ⤢ abre a conversa na grande.
 */
export type OpcoesQuickChatApp = {
  servidor: string;
  preload: string;
  fundo: () => string;
  /** O mesmo `proteger` da janela principal: links para o navegador, nenhuma permissão. */
  proteger: (w: BrowserWindow, origem: string) => void;
  atalhoInicial: string | null;
};

export type QuickChatApp = QuickChat & { webContents(): Electron.WebContents | null; destruir(): void; abrirNoBot(agenteId: string): void };

export function montarQuickChat(o: OpcoesQuickChatApp): QuickChatApp {
  let viva: BrowserWindow | null = null;
  const criarJanela = (): JanelaQuickChat | null => {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const pos = posicaoDaJanela(area);
    const w = new BrowserWindow({
      ...pos, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, title: "Quick Chat", backgroundColor: o.fundo(), roundedCorners: true, hasShadow: true,
      webPreferences: { partition: "nod-web", preload: o.preload, nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    w.setAlwaysOnTop(true, "floating");
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    o.proteger(w, new URL(o.servidor).origin);
    w.on("blur", () => { if (!w.isDestroyed() && !w.webContents.isDevToolsOpened()) w.hide(); });
    w.on("closed", () => { if (viva === w) viva = null; });
    void w.loadURL(urlDoQuickChat(o.servidor));
    viva = w;
    return {
      visivel: () => !w.isDestroyed() && w.isVisible(),
      mostrar: () => {
        if (w.isDestroyed()) return;
        // Reabre na tela onde o cursor está agora (a pessoa pode ter mudado de monitor).
        w.setBounds(posicaoDaJanela(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));
        w.show(); w.focus();
      },
      esconder: () => { if (!w.isDestroyed()) w.hide(); },
      destruida: () => w.isDestroyed(),
    };
  };
  const qc = criarQuickChat({
    registrar: (atalho, fn) => { try { return globalShortcut.register(atalho, fn); } catch { return false; } },
    desregistrar: (atalho) => { try { globalShortcut.unregister(atalho); } catch { /* já solto */ } },
    criarJanela,
  }, o.atalhoInicial);
  return {
    ...qc,
    webContents: () => (viva && !viva.isDestroyed() ? viva.webContents : null),
    destruir: () => { qc.desligar(); if (viva && !viva.isDestroyed()) viva.destroy(); viva = null; },
    // O avatar da mesa: abre (ou traz) a janela e carrega a conversa daquele bot.
    abrirNoBot: (agenteId) => {
      if (!viva || viva.isDestroyed() || !viva.isVisible()) qc.alternar();
      if (viva && !viva.isDestroyed()) void viva.loadURL(urlDoQuickChat(o.servidor, agenteId));
    },
  };
}
