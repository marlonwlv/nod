/**
 * QA-164 (a família do foco no `<body>`, QA-146/149/151/156/157): na Memória do bot, as ações do Histórico tiram do DOM o
 * botão que a pessoa apertou pelo teclado — "Revisado" some quando a entrada fica revisada, "Desfazer" some (com o
 * "Revisado") quando a entrada fica desfeita, "Marcar tudo como revisado" some com o cabeçalho quando não sobra nada, e a
 * linha "Apagada" com o "Desfazer" some quando a memória volta. O redesenho procurava o mesmo botão (`focarDeNovo`), não
 * achava e o foco caía no `<body>`: o próximo Tab voltava ao topo da página.
 *
 * Aqui fica, por ação, a ordem de destinos dentro da gaveta: o que restou da mesma entrada, a própria entrada (que fica
 * na lista, desfeita ou revisada) e, por fim, a aba em que a pessoa estava.
 */
export type AcaoDaMemoria =
  | { tipo: "revisar-entrada"; entradaId: string }
  | { tipo: "desfazer-entrada"; entradaId: string }
  | { tipo: "revisar-tudo" }
  | { tipo: "desfazer-apagada"; memoriaId: string };

const aspas = (v: string): string => `"${v.replace(/["\\]/g, "\\$&")}"`;

export function destinosDoFocoNaMemoria(acao: AcaoDaMemoria): string[] {
  const aba = (qual: "memorias" | "historico") => `#detalhes .mem-aba[data-aba="${qual}"]`;
  switch (acao.tipo) {
    case "revisar-entrada": {
      const e = `#detalhes [data-entrada=${aspas(acao.entradaId)}]`;
      return [`${e} [data-act="desfazer-entrada"]`, e, aba("historico")];
    }
    case "desfazer-entrada": {
      const e = `#detalhes [data-entrada=${aspas(acao.entradaId)}]`;
      return [`${e} [data-act="revisar-entrada"]`, e, aba("historico")];
    }
    case "revisar-tudo":
      return [`#detalhes .mem-entrada [data-act="desfazer-entrada"]`, aba("historico")];
    case "desfazer-apagada":
      return [`#detalhes [data-mem-corpo=${aspas(acao.memoriaId)}]`, aba("memorias")];
  }
}

type Doc = { activeElement: Element | null; body: Element | null; querySelector(s: string): Element | null; contains(n: Node | null): boolean };

/**
 * Leva o foco ao primeiro destino que existe, só se ele caiu (no `<body>` ou num nó que saiu do DOM). Foco que a pessoa
 * já levou para outro controle não é mexido. O item que não é focável por natureza (a `<li>` da entrada) ganha
 * `tabindex="-1"`. Devolve o elemento focado, ou null.
 */
export function focarNaMemoriaSeCaiu(doc: Doc, acao: AcaoDaMemoria): HTMLElement | null {
  const ativo = doc.activeElement;
  if (ativo && ativo !== doc.body && doc.contains(ativo)) return null;
  for (const seletor of destinosDoFocoNaMemoria(acao)) {
    const el = doc.querySelector(seletor) as HTMLElement | null;
    if (!el) continue;
    if (el.tagName === "LI" && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: false });
    return el;
  }
  return null;
}
