import type { Server } from "node:net";
export const PRAZO_TERMINAL_MS: number;
export const SAIDA_MAXIMA: number;
export const ID_VALIDO: RegExp;
export function rodarComando(e: { workspace: string; comando: string; prazoMs?: number; path?: string; bwrap?: string | null; raiz?: string | null }): Promise<{ saida: string; codigoSaida: number }>;
export function criarServidorTerminal(e: { raiz: string; bwrap?: string | null }): Server;
export function escutar(servidor: Server, caminho: string): Promise<void>;
