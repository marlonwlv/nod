import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_NAVEGADOR_LOCAL, type PonteNavegadorLocal } from "../../../src/contracts/navegador-local.ts";
import type { EntradaNavegador } from "../../../src/contracts/navegador-do-bot.ts";

// A mesma ponte de desktop/preload-web.ts (lá ela mora dentro do preload: a janela web só leva contratos).
const navegadorLocal: PonteNavegadorLocal = {
  abrir: (agenteId: string) => ipcRenderer.invoke(CANAIS_NAVEGADOR_LOCAL.abrir, agenteId),
  enviar: (id: string, e: EntradaNavegador) => ipcRenderer.invoke(CANAIS_NAVEGADOR_LOCAL.enviar, id, e),
  fechar: (id: string) => ipcRenderer.invoke(CANAIS_NAVEGADOR_LOCAL.fechar, id),
  aoMensagem: (fn: (id: string, texto: string) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_NAVEGADOR_LOCAL.mensagem);
    ipcRenderer.on(CANAIS_NAVEGADOR_LOCAL.mensagem, (_e, id: unknown, texto: unknown) => { if (typeof id === "string" && typeof texto === "string") fn(id, texto); });
  },
};
contextBridge.exposeInMainWorld("nodDesktop", { navegadorLocal });
contextBridge.exposeInMainWorld("prova", { centro: (sel: string) => ipcRenderer.invoke("prova:centro", sel), fim: (r: unknown) => ipcRenderer.invoke("prova:fim", r), url: () => ipcRenderer.invoke("prova:url"), valor: (sel: string) => ipcRenderer.invoke("prova:valor", sel), avaliar: (js: string) => ipcRenderer.invoke("prova:avaliar", js) });
