/**
 * COP-14 (item 3, definido em 2026-11-12): mensagens seguidas do mesmo remetente formam um grupo. Dentro dele os balões
 * ficam a 4 px um do outro e o canto do lado do remetente vira 6 px onde encosta no vizinho; entre remetentes diferentes,
 * depois de um cartão ou de um separador de hora, 16 px (web/chat.css). Puro: recebe os blocos já na ordem da tela e
 * marca o `<article class="message …">` de cada balão com `data-grupo` (sozinho, primeiro, meio, ultimo) e, no primeiro
 * (ou no sozinho), `data-group-start`.
 */

export type PosicaoNoGrupo = "sozinho" | "primeiro" | "meio" | "ultimo";

type Bloco = { chave: string; html: string };

/** O remetente do balão no começo do bloco (também a fala pendente, que embrulha o balão): só a fala de texto, não o cartão, o artefato nem a pergunta. */
const ARTIGO = /^\s*(?:<div class="fala-pendente"[^>]*>)?<article class="message (you|bot)\b([^"]*)"/;
const NAO_E_BALAO = /\b(?:com-artefato|com-cartoes|pergunta|com-tela|da-frente|fala-viva)\b/;

export function remetenteDoBloco(html: string): "you" | "bot" | null {
  const m = ARTIGO.exec(html);
  if (!m) return null;
  if (NAO_E_BALAO.test(m[2] ?? "")) return null;
  return m[1] === "you" ? "you" : "bot";
}

export function posicoesDosGrupos(remetentes: readonly ("you" | "bot" | null)[]): (PosicaoNoGrupo | null)[] {
  return remetentes.map((r, i) => {
    if (r === null) return null;
    const antes = remetentes[i - 1] === r;
    const depois = remetentes[i + 1] === r;
    return antes ? (depois ? "meio" : "ultimo") : depois ? "primeiro" : "sozinho";
  });
}

export function comGrupos<B extends Bloco>(blocos: readonly B[]): B[] {
  const posicoes = posicoesDosGrupos(blocos.map((b) => remetenteDoBloco(b.html)));
  return blocos.map((b, i) => {
    const p = posicoes[i];
    if (!p) return b;
    const inicio = p === "sozinho" || p === "primeiro" ? " data-group-start" : "";
    return { ...b, html: b.html.replace(/^(\s*(?:<div class="fala-pendente"[^>]*>)?<article )/, `$1data-grupo="${p}"${inicio} `) };
  });
}
