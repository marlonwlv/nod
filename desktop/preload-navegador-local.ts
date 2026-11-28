import { ipcRenderer } from "electron";
import { CANAIS_NAVEGADOR_LOCAL, type PonteNavegadorLocal } from "../src/contracts/navegador-local.ts";
import type { EntradaNavegador } from "../src/contracts/navegador-do-bot.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a vista local do navegador do bot na janela web, a mesma no Mac e no
 * PC (desktop/navegador-local.ts faz o resto no processo principal). A página não vê porta nem token: só o id da vista.
 */
export const navegadorLocal: PonteNavegadorLocal = {
  abrir: (agenteId: string) => ipcRenderer.invoke(CANAIS_NAVEGADOR_LOCAL.abrir, agenteId),
  enviar: (id: string, e: EntradaNavegador) => ipcRenderer.invoke(CANAIS_NAVEGADOR_LOCAL.enviar, id, e),
  fechar: (id: string) => ipcRenderer.invoke(CANAIS_NAVEGADOR_LOCAL.fechar, id),
  aoMensagem: (fn: (id: string, texto: string) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_NAVEGADOR_LOCAL.mensagem);
    ipcRenderer.on(CANAIS_NAVEGADOR_LOCAL.mensagem, (_e, id: unknown, texto: unknown) => { if (typeof id === "string" && typeof texto === "string") fn(id, texto); });
  },
};
