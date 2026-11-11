/**
 * NOD-468: o texto que a pessoa lê na tarefa aberta fica parado quando o conteúdo acima dele muda de altura (o log do
 * trabalho, a descrição relida, um bloco que abre). A rolagem guardada (rolagem-guardada.ts, alvo-de-rolagem.ts) é um
 * número: o mesmo scrollTop, com 20–85 px a mais ou a menos acima, mostra outro texto. O `overflow-anchor` do navegador
 * não ajuda porque o innerHTML recria os nós a cada desenho (e o Safari não o tem).
 *
 * Aqui a âncora é de conteúdo: antes de regravar, o primeiro bloco com chave estável que aparece no topo da caixa e a
 * distância dele ao topo da vista; depois, o mesmo bloco (pela chave) e o scrollTop que o deixa à mesma distância. Quem
 * está colada no fim não usa âncora (segue o fim, ADA-12 revisão 3); quem chama decide.
 *
 * As posições vêm do layout (offsetTop/offsetHeight), não do getBoundingClientRect: no Chrome com toque (medido em
 * 2026-11-11 a 390 px) o retângulo lido logo depois de escrever o scrollTop no mesmo desenho ainda era o de antes, e a
 * compensação contava a escrita da rolagem guardada como se fosse conteúdo que mudou (−47 px em vez de 0).
 *
 * Só no desenho (ADR-061: o caminho do scroll não busca no DOM).
 */

/** Os blocos que servem de âncora: a chave é o `data-ancora` ou o `id` (o comentário, a descrição, o trabalho). */
export const SELETOR_DE_ANCORAS = "[data-ancora], [id]:not(textarea):not(input):not(select)";

export type Ancora = { readonly chave: string; readonly desvio: number };

/** O pedaço do HTMLElement que a âncora lê. */
export type Caixa = { offsetTop: number; offsetParent: unknown; clientTop: number; scrollTop: number; clientHeight: number };
export type Bloco = { offsetTop: number; offsetParent: unknown; offsetHeight: number; id?: string; getAttribute(n: string): string | null };
type Conteudo<B extends Bloco> = { querySelectorAll(sel: string): ArrayLike<B> };
type ComOffset = { offsetTop: number; offsetParent: unknown };

function chaveDe(b: Bloco): string | null {
  const a = b.getAttribute("data-ancora");
  if (a) return `a:${a}`;
  const id = b.id ?? b.getAttribute("id");
  return id ? `i:${id}` : null;
}

/** O topo do elemento no documento pela cadeia de offsetParent (o layout, sem a rolagem de ninguém). */
function topoNoLayout(e: ComOffset): number {
  let y = 0;
  let atual: ComOffset | null = e;
  for (let i = 0; atual && i < 64; i++) { y += atual.offsetTop; atual = (atual.offsetParent as ComOffset | null) ?? null; }
  return y;
}

/** O topo do bloco dentro do conteúdo que rola na caixa (0 = o começo do que rola). */
export function topoNaCaixa(b: ComOffset, caixa: Caixa): number {
  return topoNoLayout(b) - topoNoLayout(caixa) - caixa.clientTop;
}

/**
 * O bloco que segura a leitura: entre os que aparecem na caixa, o que começa no topo ou abaixo dele mais perto do topo;
 * se nenhum começa à vista, o que cruza o topo e começa mais embaixo (o mais interno). Sem bloco à vista, sem âncora.
 * A chave repetida (o mesmo id em duas formas) não serve: depois não se sabe qual é o mesmo bloco.
 */
export function acharAncora<B extends Bloco>(caixa: Caixa, conteudo: Conteudo<B>): Ancora | null {
  const topo = caixa.scrollTop;
  const fundo = topo + caixa.clientHeight;
  const blocos = conteudo.querySelectorAll(SELETOR_DE_ANCORAS);
  const contagem = new Map<string, number>();
  const candidatos: { chave: string; y: number }[] = [];
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    if (!b) continue;
    const k = chaveDe(b);
    if (!k) continue;
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
    if (b.offsetHeight <= 0 || !b.offsetParent) continue;
    const y = topoNaCaixa(b, caixa);
    if (y + b.offsetHeight <= topo || y >= fundo) continue;
    candidatos.push({ chave: k, y });
  }
  let abaixo: { chave: string; y: number } | null = null;
  let cruza: { chave: string; y: number } | null = null;
  for (const c of candidatos) {
    if (contagem.get(c.chave) !== 1) continue;
    if (c.y >= topo) { if (!abaixo || c.y < abaixo.y) abaixo = c; }
    else if (!cruza || c.y > cruza.y) cruza = c;
  }
  const e = abaixo ?? cruza;
  return e ? { chave: e.chave, desvio: e.y - topo } : null;
}

/** O scrollTop que põe a âncora à mesma distância do topo da vista; null se ela sumiu (ou não é mais única). */
export function topoPelaAncora<B extends Bloco>(ancora: Ancora, caixa: Caixa, conteudo: Conteudo<B>): number | null {
  const blocos = conteudo.querySelectorAll(SELETOR_DE_ANCORAS);
  let achado: B | null = null;
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    if (!b || chaveDe(b) !== ancora.chave) continue;
    if (achado) return null;
    achado = b;
  }
  if (!achado || achado.offsetHeight <= 0 || !achado.offsetParent) return null;
  return topoNaCaixa(achado, caixa) - ancora.desvio;
}
