/**
 * Chat (polimento, medido em 13/11 com o Claude): o balão da pessoa era recriado duas vezes nos primeiros 250 ms (a
 * pendente que ganha o id gravado, depois a gravada que a substitui), e cada nó novo refazia a entrada de 12 px — o balão
 * "piscava". `morfarDom` leva o nó que está na tela à forma do HTML novo sem trocá-lo: atributos e texto mudam no lugar e
 * só a parte de estrutura diferente (outra tag) nasce de novo.
 *
 * Preserva o que é da tela, não do HTML: o `open` de um <details> (da pessoa) e a classe `chegou` (a entrada em curso,
 * `animarChegada` em main.ts).
 */
const DA_TELA = ["chegou"] as const;

export function morfarDom(velho: Element, novo: Element): void {
  const guardadas = DA_TELA.filter((c) => velho.classList.contains(c));
  for (const nome of velho.getAttributeNames()) if (nome !== "open" && !novo.hasAttribute(nome)) velho.removeAttribute(nome);
  for (const nome of novo.getAttributeNames()) {
    const lido = novo.getAttribute(nome) ?? "";
    const valor = nome === "class" ? [lido, ...guardadas.filter((c) => !novo.classList.contains(c))].filter(Boolean).join(" ") : lido;
    if (velho.getAttribute(nome) !== valor) velho.setAttribute(nome, valor);
  }
  for (const c of guardadas) velho.classList.add(c);
  // Filhos casados pela "espécie" (tag + primeira classe), na ordem: a gravada ganha a barra de ações ANTES do autor e do
  // balão, e casar por posição transformava o balão no autor (o balão nascia de novo, a entrada era cortada).
  const antes = [...velho.childNodes];
  const casados = new Set<ChildNode>();
  let cursor = 0;
  const ordem: ChildNode[] = [];
  for (const y of [...novo.childNodes]) {
    let j = cursor;
    while (j < antes.length && especie(antes[j]!) !== especie(y)) j++;
    const x = j < antes.length ? antes[j]! : null;
    if (!x) { ordem.push(y); continue; }
    casados.add(x);
    cursor = j + 1;
    if (x.nodeType === 1) morfarDom(x as Element, y as Element);
    else if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
    ordem.push(x);
  }
  for (const x of antes) if (!casados.has(x)) x.remove();
  let ref: ChildNode | null = velho.firstChild;
  for (const no of ordem) {
    if (no === ref) ref = ref.nextSibling;
    else velho.insertBefore(no, ref);
  }
}

/** A espécie do nó: a tag e a primeira classe do elemento ("DIV.bubble"); o tipo para texto e comentário. */
function especie(no: ChildNode): string {
  if (no.nodeType !== 1) return `#${no.nodeType}`;
  const el = no as Element;
  return `${el.tagName}.${el.classList[0] ?? ""}`;
}
