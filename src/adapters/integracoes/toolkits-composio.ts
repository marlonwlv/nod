/**
 * definido em 2026-11-18 (emenda ADR-057): o conector e o banco aceitam [a-z0-9-], o Composio
 * usa [a-z0-9_]. A tradução é geral: `_` do provedor vira `-` no Nod e volta a `_` em toda chamada.
 * Ela é inversível porque o slug remoto com hífen é recusado (`toolkitAceito`): sem ele, nenhum
 * slug do Nod tem duas origens. Catálogo de 2026-11-18: 1.818 toolkits, nenhum com hífen, 25 com
 * login gerenciado escondidos pelo sublinhado. A lista fixa de apelidos que existia antes cobria 6.
 *
 * Gatilho de reversão: o provedor publicar um slug com hífen. Ele fica fora da grade (não colide),
 * e a regra precisa de outra forma de distinguir `a-b` de `a_b`.
 */
export function toolkitComposio(slug: string): string {
  return slug.replace(/-/g, "_");
}

export function slugDoToolkit(toolkit: string): string {
  return toolkit.replace(/_/g, "-");
}

/** O slug remoto que a tradução consegue ida e volta. */
export function toolkitAceito(toolkit: string): boolean {
  return !toolkit.includes("-");
}
