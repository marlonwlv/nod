import { svgQr } from "../lib/qr.ts";

/**
 * #84: conectar o celular pelo QR. O computador que já está na conta mostra, junto do código de 6 números (ADR-124), um
 * QR com o link `<endereço do nod>/#parear=<código>`. O celular abre o link, o código sai da URL na hora e espera a
 * sessão; com ela aberta, o celular mostra o código e só o manda quando a pessoa toca em "Conectar a esta conta" (revisão
 * do PR #85: mandar sozinho deixava um link de outra pessoa trocar a sessão deste aparelho, CSRF de login). Depois, o
 * computador confirma com os símbolos, como no código digitado. Nada muda no servidor: o QR é só outro jeito de digitar
 * o mesmo código (5 minutos, uso único, confirmação no computador, limite de tentativas).
 *
 * O código vai no fragmento (`#`), que o navegador não manda ao servidor: não entra em log de acesso nem no Referer.
 */

/** A chave da sessionStorage onde o código do link espera a sessão existir (primeira visita: o espaço provisório). */
export const CHAVE_PAREAR_CONTA = "nod-parear-conta";

/** Só os 6 números do pareamento; qualquer outra coisa no fragmento não é um código. */
export function codigoDoFragmento(hash: string): string | null {
  return /^#parear=(\d{6})$/.exec(hash)?.[1] ?? null;
}

/** O pedaço da janela que o link do QR usa no boot (na página, `window`; nos testes, um falso). */
export type JanelaDoLink = {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(dados: unknown, titulo: string, url: string): void };
  readonly sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
};

/**
 * No boot, antes da sessão: o `#parear=<código>` sai da URL na hora (não fica no histórico) e o código, se tiver o
 * formato, espera a sessão na sessionStorage da aba. Devolve true quando havia o fragmento (quem chamou limpa o hash da
 * URL que ainda vai regravar).
 */
export function guardarCodigoDoLink(j: JanelaDoLink): boolean {
  if (!j.location.hash.startsWith("#parear=")) return false;
  const codigo = codigoDoFragmento(j.location.hash);
  if (codigo) { try { j.sessionStorage.setItem(CHAVE_PAREAR_CONTA, codigo); } catch { /* sem storage: a pessoa digita o código */ } }
  j.history.replaceState(null, "", j.location.pathname + j.location.search);
  return true;
}

/**
 * Se há código do link esperando a sessão. Na primeira visita, ele pula a tela "Já usa o nod?" (#81): quem leu o QR já
 * disse que quer entrar numa conta, e a confirmação "Conectar a esta conta" vem logo depois do espaço provisório.
 */
export function codigoDoLinkGuardado(j: Pick<JanelaDoLink, "sessionStorage">): boolean {
  try { return /^\d{6}$/.test(j.sessionStorage.getItem(CHAVE_PAREAR_CONTA) ?? ""); } catch { return false; }
}

/**
 * No boot, com a sessão aberta (a da pessoa ou o espaço provisório da primeira visita): tira o código guardado (uma vez
 * só), fecha o que estiver na frente e abre a confirmação. Não manda o código: isso é do clique em "Conectar a esta conta".
 */
export async function abrirCodigoGuardado(
  j: Pick<JanelaDoLink, "sessionStorage">,
  d: { tirarDaFrente: () => Promise<void> | void; conta: { confirmarCodigoDoLink: (codigo: string) => Promise<void> } },
): Promise<boolean> {
  let codigo: string | null = null;
  try { codigo = j.sessionStorage.getItem(CHAVE_PAREAR_CONTA); j.sessionStorage.removeItem(CHAVE_PAREAR_CONTA); } catch { return false; }
  if (!codigo || !/^\d{6}$/.test(codigo)) return false;
  await d.tirarDaFrente();
  await d.conta.confirmarCodigoDoLink(codigo);
  return true;
}

/**
 * O link do QR, a partir do endereço onde este nod está aberto. Sem link quando o celular não teria como abrir esse
 * endereço: fora de http(s) (o arquivo local do app) ou no próprio computador (localhost, 127.x, ::1).
 */
export function urlDoPareamento(origem: string | null, codigo: string): string | null {
  if (!origem || !/^\d{6}$/.test(codigo)) return null;
  let u: URL;
  try { u = new URL(origem); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1" || host === "0.0.0.0") return null;
  return `${u.origin}/#parear=${codigo}`;
}

/** O QR do link, pronto para o cartão; vazio sem link (o código digitado continua valendo). */
export function htmlQrDoPareamento(origem: string | null, codigo: string): string {
  const url = urlDoPareamento(origem, codigo);
  const svg = url ? svgQr(url, "QR code para conectar o celular") : null;
  return svg ? `<div class="cc-qr">${svg}</div>` : "";
}
