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
  // 2026-11-23 (QA-202): o ponto final do nome absoluto ("localhost.", "metadata.google.internal.") chega ao mesmo lugar.
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return false;
  if (h.includes(":")) return ipv6Publico(h);
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return ipv4Publico(Number(v4[1]), Number(v4[2]));
  if (/^\d+$/.test(h)) return false;
  return true;
}
function ipv4Publico(a: number, b: number): boolean {
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
}
/**
 * 2026-11-23 (QA-202): o IPv6 que embute um IPv4 (`::ffff:127.0.0.1`, `::127.0.0.1`, NAT64 `64:ff9b::`, 6to4 `2002:`)
 * chega ao IPv4 de dentro; confere o IPv4 embutido. O `URL` já normaliza para hexadecimal (`[::ffff:7f00:1]`).
 */
function ipv6Publico(h: string): boolean {
  const g = gruposIpv6(h);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xff00) === 0xff00) return false; // fc00::/7, fe80::/10, ff00::/8
  const v4De = (alto: number, _baixo: number) => ipv4Publico(alto >> 8, alto & 0xff);
  const zeros5 = g.slice(0, 5).every((x) => x === 0);
  if (zeros5 && (g[5] === 0xffff || g[5] === 0)) return v4De(g[6]!, g[7]!); // ::ffff:a.b.c.d e ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4De(g[6]!, g[7]!); // 64:ff9b::/96
  if (g[0] === 0x2002) return v4De(g[1]!, g[2]!); // 2002:a.b.c.d::/48
  return true;
}
function gruposIpv6(h: string): number[] | null {
  const partes = h.split("::");
  if (partes.length > 2) return null;
  const ler = (s: string) => (s ? s.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)) : []);
  const ini = ler(partes[0]!), fim = partes.length === 2 ? ler(partes[1]!) : [];
  if ([...ini, ...fim].some((x) => Number.isNaN(x))) return null;
  const g = partes.length === 2 ? [...ini, ...Array(8 - ini.length - fim.length).fill(0), ...fim] : ini;
  return g.length === 8 ? g : null;
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
