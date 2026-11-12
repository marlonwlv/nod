import { PARAMETRO_QUICK_CHAT } from "./quick-chat.ts";

/**
 * Avatar do bot solto na área de trabalho (ADR-173, definido em 2026-11-12; o "Mount on Desktop" do Grok Bot, tela 14
 * do protótipo). Uma janelinha transparente, sem moldura, por cima dos apps, só com o mascote do bot: clicar abre o
 * Quick Chat já na conversa daquele bot (o mini-composer e o popout são o próprio Quick Chat). Arrastar move; a posição
 * fica guardada em preferencias.json e o avatar volta no próximo conectar. Puro aqui; a janela mora em main.ts.
 */
export const TAMANHO_AVATAR = 88;
export const MAX_AVATARES = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AvatarNaMesa = { agenteId: string; x: number; y: number };

export function ehIdDeBot(x: unknown): x is string {
  return typeof x === "string" && UUID.test(x);
}

/** Lê a lista guardada; descarta o que não for um avatar válido e corta no teto. */
export function lerAvatares(bruto: unknown): AvatarNaMesa[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const lista: AvatarNaMesa[] = [];
  for (const a of bruto) {
    if (typeof a !== "object" || a === null) continue;
    const { agenteId, x, y } = a as Record<string, unknown>;
    if (!ehIdDeBot(agenteId) || vistos.has(agenteId) || typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    vistos.add(agenteId);
    lista.push({ agenteId, x: Math.round(x), y: Math.round(y) });
    if (lista.length >= MAX_AVATARES) break;
  }
  return lista;
}

/** Onde nasce um avatar novo: canto de baixo à direita da tela, um ao lado do outro. */
export function posicaoNova(area: { x: number; y: number; width: number; height: number }, jaMontados: number): { x: number; y: number } {
  const margem = 24;
  return { x: area.x + area.width - margem - TAMANHO_AVATAR * (jaMontados + 1), y: area.y + area.height - margem - TAMANHO_AVATAR };
}

/** Põe o avatar inteiro dentro de alguma tela (o monitor dele pode ter sido desligado). */
export function dentroDeUmaTela(p: { x: number; y: number }, telas: readonly { x: number; y: number; width: number; height: number }[]): { x: number; y: number } {
  const cabe = telas.some((t) => p.x >= t.x && p.y >= t.y && p.x + TAMANHO_AVATAR <= t.x + t.width && p.y + TAMANHO_AVATAR <= t.y + t.height);
  if (cabe || telas.length === 0) return p;
  return posicaoNova(telas[0]!, 0);
}

export function urlDoAvatar(servidor: string, agenteId: string): string {
  const u = new URL(servidor);
  u.pathname = "/"; u.search = ""; u.hash = "";
  u.searchParams.set(PARAMETRO_QUICK_CHAT, "avatar");
  u.searchParams.set("bot", agenteId);
  return u.toString();
}
