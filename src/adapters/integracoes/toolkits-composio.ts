/**
 * definido em 2026-11-18 (emenda ADR-057): aliases explícitos preservam o contrato
 * [a-z0-9-] do conector e do banco. Não normalizar toolkits desconhecidos: a troca
 * genérica de underscore por hífen colidiria com outros slugs do provedor.
 */
const TOOLKITS: Readonly<Record<string, string>> = {
  "microsoft-teams": "microsoft_teams",
  "one-drive": "one_drive",
  "share-point": "share_point",
  "granola-mcp": "granola_mcp",
  "read-ai-mcp": "read_ai_mcp",
  "otter-ai-mcp": "otter_ai_mcp",
};

export function toolkitComposio(slug: string): string {
  return Object.hasOwn(TOOLKITS, slug) ? TOOLKITS[slug]! : slug;
}

export function slugDoToolkit(toolkit: string): string {
  return Object.entries(TOOLKITS).find(([, valor]) => valor === toolkit)?.[0] ?? toolkit;
}
