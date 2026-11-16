import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderChipModo } from "../../../web/telas/aprovacoes.ts";
import { botoesDoCampo, htmlComposer } from "../../../web/telas/conversa.ts";

/**
 * Acessos do campo (3c): a IA e o modo de aprovação voltam ao campo do computador, entre o texto e o 🎤, revelados no
 * hover e no foco — montados no seu lugar o tempo todo (visibility hidden em repouso: nada pula e saem do Tab). O
 * celular não muda (o caminho segue o ＋ e a folha).
 */
const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

/** O bloco `@media (hover: hover) and (pointer: fine) { … }` do casca.css, com as chaves equilibradas. */
function blocoDoMouseFino(fonte: string): string {
  const inicio = fonte.indexOf("@media (hover: hover) and (pointer: fine) {");
  expect(inicio).toBeGreaterThan(-1);
  let nivel = 0;
  for (let i = fonte.indexOf("{", inicio); i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}" && --nivel === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error("bloco sem fim");
}

describe("IA e modo no campo do computador (acessos 3c)", () => {
  it("a ordem segue a visual: texto, IA, modo, 🎤, Parar, Enviar — nada à esquerda do texto além do ＋", () => {
    const h = htmlComposer("Escreva…", [], { anexos: "tudo", comandos: true, aprovacao: true, bot: "Ada" });
    const pos = ["<textarea", 'id="composer-ia"', 'id="composer-modo"', 'class="mic"', 'class="parar-envio"', 'class="send"'].map((s) => h.indexOf(s));
    for (const p of pos) expect(p).toBeGreaterThan(-1);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(h.indexOf('class="mais-campo"')).toBeLessThan(h.indexOf("<textarea"));
  });

  it("o casca.css não tira mais a IA e o modo do layout; só o clipe continua no ＋", () => {
    const c = css("casca.css");
    expect(c).not.toMatch(/#composer-modo[^{]*\{\s*display:\s*none/);
    expect(c).not.toMatch(/#composer-ia[^{]*\{\s*display:\s*none/);
    expect(c).toContain(".composer .box > .clipe { display: none; }");
  });

  it("com mouse: escondidos em repouso (visibility), à vista no hover, no foco e com o menu aberto", () => {
    const b = blocoDoMouseFino(css("casca.css"));
    expect(b).toMatch(/\.composer \.box > :is\(#composer-ia, #composer-modo\) \{\s*visibility: hidden; opacity: 0;/);
    expect(b).toMatch(/\.composer \.box:is\(:hover, :focus-within\) > :is\(#composer-ia, #composer-modo\)[^{]*\{\s*visibility: visible; opacity: 1;/);
    // Com o menu de um aberto, os DOIS ficam (antes o outro sumia e deixava o buraco do lugar guardado).
    expect(b).toMatch(/\.composer \.box:has\(> :is\(#composer-ia, #composer-modo\)\[aria-expanded="true"\]\) > :is\(#composer-ia, #composer-modo\)[^{]*\{\s*visibility: visible; opacity: 1;/);
    // A transição usa o token de duração, nunca um tempo solto.
    expect(b).toContain("var(--dur-normal)");
  });

  it("o celular não muda: lá a IA e o modo continuam na folha do ＋", () => {
    const m = css("mobile.css");
    expect(m).toContain(".composer .box.com-mais > .clipe, .composer .box.com-mais > .modo-chip, .composer .box.com-mais > .seletor-ia { display: none; }");
    // O casca.css só vale fora do toque.
    expect(css("casca.css")).toContain("@media not ((hover: none) and (pointer: coarse)) {");
  });
});

describe("Ignorar todas as aprovações sempre à vista no campo (acessos 3a)", () => {
  it("o chip do total fica visível fora do hover, e só ele: a IA ao lado continua escondida em repouso", () => {
    const b = blocoDoMouseFino(css("casca.css"));
    const regra = /\.composer \.box > #composer-modo\[data-modo="total"\] \{([^}]*)\}/.exec(b);
    expect(regra?.[1]).toContain("visibility: visible");
    expect(regra?.[0]).not.toContain(":hover");
    expect(regra?.[0]).not.toContain("composer-ia");
  });

  it("o chip pinta o total em âmbar por token e diz o modo no nome, para a dona e para o colega", () => {
    expect(css("interface.css")).toContain('.modo-chip[data-modo="total"] { color: var(--warning); }');
    expect(renderChipModo("total", true).titulo).toBe("Ignorar todas as aprovações · clique para mudar");
    expect(renderChipModo("total", false).titulo).toBe("Ignorar todas as aprovações · só a dona do bot muda");
    // A cor não é o único sinal: o ícone do total é outro.
    expect(renderChipModo("total", true).html).not.toBe(renderChipModo("manual", true).html.replace("manual", "total"));
  });

  it("no celular o ＋ segue âmbar com o ponto", () => {
    const m = css("mobile.css");
    expect(m).toContain(".composer .mais-campo[data-atencao] { position: relative; color: var(--warning); }");
    expect(m).toMatch(/\.composer \.mais-campo\[data-atencao\]::after \{[^}]*background: var\(--warning\)/);
  });
});

describe("Parar o turno sem apagar o rascunho (acessos 3b)", () => {
  it("o Parar fica enquanto o bot trabalha; com rascunho ou ditado, ao lado do Enviar", () => {
    expect(botoesDoCampo({ trabalhando: true, temConteudo: true, ditando: false })).toEqual({ enviar: true, parar: true });
    expect(botoesDoCampo({ trabalhando: true, temConteudo: false, ditando: false })).toEqual({ enviar: false, parar: true });
    expect(botoesDoCampo({ trabalhando: false, temConteudo: false, ditando: false })).toEqual({ enviar: true, parar: false });
    expect(botoesDoCampo({ trabalhando: true, temConteudo: false, ditando: true })).toEqual({ enviar: true, parar: true });
  });

  it("o Parar vem logo antes do Enviar no DOM (o seletor do secundário depende disso)", () => {
    const h = htmlComposer("x", [], { aprovacao: true, bot: "Ada" });
    expect(h).toMatch(/<button type="button" class="parar-envio"[^>]*>.*?<\/button><button class="send"/);
  });

  it("ao lado do Enviar à vista o Parar é secundário (sem fundo, só tokens); gravando, o celular segue com o dele", () => {
    for (const [arquivo, tinta, hover] of [["casca.css", "--ink-2", "--hover"], ["chat.css", "--chat-tinta-2", "--chat-preenchido"]] as const) {
      const c = css(arquivo);
      const repouso = /\.composer \.box:not\(\.gravando\) > \.parar-envio:has\(\+ \.send:not\(\[hidden\]\)\) \{([^}]*)\}/.exec(c);
      expect(repouso?.[1]).toContain("background: transparent");
      expect(repouso?.[1]).toContain(`color: var(${tinta})`);
      const realce = /\.parar-envio:has\(\+ \.send:not\(\[hidden\]\)\):is\(:hover, :focus-visible\) \{([^}]*)\}/.exec(c);
      expect(realce?.[1]).toContain(`background: var(${hover})`);
      expect(repouso?.[1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgb/);
    }
  });
});

describe("o menu do modo no tamanho dos outros menus", () => {
  it("segue o menu da IA: 336 de largura, itens 8/10, ícone de 16 e a descrição em rótulo", () => {
    const c = css("interface.css");
    expect(c).toContain(".bot-menu.modo-menu { width: min(336px, calc(100vw - 24px)); padding: 6px; border-radius: var(--raio-14); }");
    expect(c).toContain(".bot-menu.ia-sel-menu { width: min(336px, calc(100vw - 24px));");
    expect(c).toContain(".bot-menu.modo-menu button.modo-item { align-items: flex-start; gap: 10px; padding: 8px 10px;");
    expect(c).toContain(".modo-item .modo-ic svg { width: 16px; height: 16px; }");
    expect(c).toContain(".modo-item .modo-txt small { font-size: var(--fs-rotulo);");
  });
});
