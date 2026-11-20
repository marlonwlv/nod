/**
 * QA-162: o foco volta ao botão que pediu uma confirmação, mesmo que ele esteja desligado ao fechar. O Testar agora pergunta
 * "Rodar mais uma?" dentro do `agir()`, que liga o `ocupado` antes (o botão fica `disabled`, e o Chrome tira o foco dele) e
 * só desliga depois da resposta. Devolver o foco na hora do fechamento não pegava (botão desligado não recebe foco) e ele
 * ficava no `<body>`: o próximo Tab voltava ao topo. Aqui o foco espera o botão reabilitar (ou o que a tela por string
 * redesenhou no lugar dele, pelo mesmo `data-act`/`data-id`/`id`) por até `ateMs`; se outro controle pegou o foco nesse
 * meio-tempo (a conversa aberta pelo "Rodar mais uma"), nada é mexido.
 */
const seletorDe = (el: HTMLElement): string | null => {
  const css = (v: string): string => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));
  if (el.id) return `#${css(el.id)}`;
  const act = el.dataset["act"];
  if (!act) return null;
  const id = el.dataset["id"];
  return `[data-act="${css(act)}"]${id ? `[data-id="${css(id)}"]` : ""}`;
};

const semDono = (doc: Document): boolean => {
  const a = doc.activeElement;
  return !a || a === doc.body || !a.isConnected;
};

export function devolverFocoQuandoPuder(origem: HTMLElement, ateMs = 3000): void {
  const doc = origem.ownerDocument;
  const seletor = seletorDe(origem);
  const fim = Date.now() + ateMs;
  const tentar = (): void => {
    if (!semDono(doc) && doc.activeElement !== origem) return;
    const alvo = origem.isConnected ? origem : seletor ? doc.querySelector<HTMLElement>(seletor) : null;
    if (alvo && !(alvo as HTMLButtonElement).disabled) {
      alvo.focus({ preventScroll: true });
      if (doc.activeElement === alvo) return;
    }
    if (Date.now() < fim) setTimeout(tentar, 50);
  };
  tentar();
}
