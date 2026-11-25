/**
 * O que o navegador do bot aceita abrir (ADR-190). Sem estado: o servidor recusa o `abrir` e o motor da máquina confere cada
 * salto do download direto (motor-agent-browser.ts) pela mesma regra.
 */

/**
 * definido em 2026-11-20: o Chrome no servidor alcança a rede de dentro (o próprio nod, o metadata da nuvem). `abrir` e
 * a aba nova recusam endereço que não seja http(s) público. TODO(2026-11-20): bloquear também na rede (proxy ou
 * firewall do processo) — um link clicado ou um redirect ainda chegam à rede de dentro, e DNS que aponta para dentro
 * passa pelo nome.
 */
export function enderecoPermitido(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return false;
  if (h === "::1" || h === "::" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return false;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (/^\d+$/.test(h)) return false;
  return true;
}

/**
 * definido em 2026-11-25 (QA do navegador no Windows): o endereço que nem é URL ("htps//g1 globo com", "g1 com"). Ele
 * ganha uma recusa própria; o localhost e a rede interna seguem com a de `enderecoPermitido`.
 */
export function enderecoMalformado(url: string): boolean {
  const t = url.trim();
  if (/\s/.test(t)) return true;
  let u: URL;
  try { u = new URL(t); } catch { return true; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return !/^(file|javascript|data|about|chrome|blob):/i.test(t);
  return !u.hostname || (!u.hostname.includes(".") && u.hostname !== "localhost" && !u.hostname.startsWith("["));
}
