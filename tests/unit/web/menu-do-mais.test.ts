// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abrirMenuDoMais, htmlMenuDoMais } from "../../../web/telas/menu-do-mais.ts";
import { atalhoDoNovoBot } from "../../../web/lib/atalhos.ts";

/** O + da barra abre o menu "Novo" (Novo bot e Novo chat em grupo), no computador ancorado e no celular como folha. */
const esvaziar = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function montarMais(): HTMLButtonElement {
  document.body.innerHTML = '<div id="sidebar"><button class="create-trigger" data-act="menu-do-mais" aria-haspopup="menu" aria-expanded="false">+</button></div>';
  const mais = document.querySelector<HTMLButtonElement>(".create-trigger")!;
  mais.focus();
  return mais;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("menu Novo do +", () => {
  it("o clique no + abre role=menu com Novo bot e Novo chat em grupo, foco no primeiro item e aria-expanded", () => {
    const mais = montarMais();
    const d = abrirMenuDoMais(mais, { atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: false, escolher: vi.fn() });
    const itens = [...d.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
    expect(itens.map((i) => i.textContent)).toEqual(["Novo bot⌘N", "Novo chat em grupo⇧⌘N"]);
    expect(document.activeElement).toBe(itens[0]);
    expect(mais.getAttribute("aria-expanded")).toBe("true");
    expect(d.classList.contains("folha")).toBe(false);
  });

  it("escolher o grupo chama nova-sala; escolher o bot chama novo-bot", async () => {
    const escolher = vi.fn();
    const d = abrirMenuDoMais(montarMais(), { atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: false, escolher });
    d.querySelector<HTMLElement>('[data-mais="nova-sala"]')!.click();
    await esvaziar();
    expect(escolher).toHaveBeenCalledWith("nova-sala");
    const d2 = abrirMenuDoMais(montarMais(), { atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: false, escolher });
    d2.querySelector<HTMLElement>('[data-mais="novo-bot"]')!.click();
    await esvaziar();
    expect(escolher).toHaveBeenLastCalledWith("novo-bot");
  });

  it("setas, Home e End andam entre os itens", () => {
    const d = abrirMenuDoMais(montarMais(), { atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: false, escolher: vi.fn() });
    const [bot, grupo] = [...d.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(grupo);
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(bot);
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(grupo);
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(bot);
  });

  it("fechar sem escolha (Esc) devolve o foco ao + e não escolhe nada", async () => {
    const escolher = vi.fn();
    const mais = montarMais();
    const d = abrirMenuDoMais(mais, { atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: false, escolher });
    d.close();
    await esvaziar();
    expect(document.activeElement).toBe(mais);
    expect(mais.getAttribute("aria-expanded")).toBe("false");
    expect(escolher).not.toHaveBeenCalled();
  });

  it("no celular o menu sai como folha, com o título Novo e sem os atalhos de teclado", () => {
    const d = abrirMenuDoMais(montarMais(), { atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: true, escolher: vi.fn() });
    expect(d.classList.contains("folha")).toBe(true);
    expect(d.querySelector(".menu-nome")?.textContent).toBe("Novo");
    expect(d.querySelector(".mc-meta")).toBeNull();
    expect(htmlMenuDoMais({ atalhoBot: "⌘N", atalhoGrupo: "⇧⌘N", folha: true })).toContain("Novo chat em grupo");
  });

  // ADR-187 §7 (2026-11-18): o ⌘⇧N passou do grupo para o novo bot (o ⌘N é da nova tarefa); o grupo ficou sem tecla.
  it("o atalho do novo bot segue o lugar, e o grupo sem tecla não mostra nenhuma", () => {
    expect(atalhoDoNovoBot("app-mac")).toEqual({ texto: "⇧⌘N", aria: "Meta+Shift+N" });
    expect(atalhoDoNovoBot("outro")).toEqual({ texto: "Alt+Shift+N", aria: "Alt+Shift+N" });
    const html = htmlMenuDoMais({ atalhoBot: "⇧⌘N", atalhoGrupo: "", folha: false });
    expect(html.match(/class="mc-meta"/g)).toHaveLength(1);
  });
});

describe("ligação no app", () => {
  const main = readFileSync(join(import.meta.dirname, "../../../web/main.ts"), "utf8");
  const mobile = readFileSync(join(import.meta.dirname, "../../../web/mobile.css"), "utf8");

  it("os dois + (barra e topo do início no celular) abrem o menu e seguram para criar o bot na hora", () => {
    expect(main.match(/class="create-trigger[^"]*" data-act="menu-do-mais" data-segurar="segurar-mais" aria-haspopup="menu"/g)?.length).toBe(2);
    expect(main).not.toMatch(/class="create-trigger[^"]*" data-act="novo-bot-dialogo"/);
    expect(main).toContain("folha: celular.ativo(),");
  });

  it("no celular a folha tem itens de pelo menos 44 px", () => {
    expect(mobile).toMatch(/\.bot-menu\.menu-mais\.folha button\[role="menuitem"\] \{ min-height: 48px;/);
  });
});
