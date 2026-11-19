import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpile } from "typescript";
import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { htmlRodapeLegal } from "../../../web/telas/rodape-legal.ts";
import { htmlEtapa } from "../../../web/telas/conta-no-chat.ts";
import { htmlEntrarPrimeiro } from "../../../web/telas/entrar-primeiro.ts";
import { abreNoNavegador } from "../../../desktop/links-externos.ts";
import { esc } from "../../../web/lib/render.ts";

function conferir(html: string) {
  const document = new Window().document;
  document.body.innerHTML = html;
  const rodapes = document.querySelectorAll(".rodape-legal");
  expect(rodapes).toHaveLength(1);
  expect(rodapes[0]?.closest("form")).toBeNull();
  const links = document.querySelectorAll(".rodape-legal a");
  expect(links).toHaveLength(2);
  for (const [i, [nome, caminho]] of [["Privacidade", "privacidade"], ["Termos", "termos"]].entries()) {
    const link = links[i];
    expect(link?.textContent).toBe(nome);
    expect(link?.getAttribute("href")).toBe(`https://nodbot.ai/${caminho}`);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
    expect(link?.hasAttribute("data-act")).toBe(false);
  }
}

describe("rodapé legal na entrada", () => {
  // Executa a função real sem iniciar SSE, timers e o boot inteiro de main.ts.
  const main = readFileSync("web/main.ts", "utf8");
  const inicio = main.indexOf("function renderEntrada(): string {");
  const render = transpile(main.slice(inicio, main.indexOf("\n/**", inicio)));
  const contas = { google: true, onboardingTexto: true };
  it.each([
    { modo: null },
    { redefinir: true, modo: null },
    { modo: { modo: "google" } },
    { recusado: true, modo: { modo: "google", contas } },
    { modo: { modo: "stub", pessoas: [] } },
    { modo: { modo: "stub", pessoas: [{ id: "p", nome: "Pessoa" }], contas } },
    { primeiro: { ocupado: false, erro: null }, modo: { modo: "google", contas } },
  ])("mantém os links no ramo %j", (entrada) => {
    const html: string = runInNewContext(`${render}\nrenderEntrada()`, {
      entrada, htmlRodapeLegal, htmlEntrarPrimeiro, esc,
      pedidoPendente: () => ({ nome: "Computador" }),
      htmlEntradaConta: () => '<form data-form="entrada-conta"></form>',
      linkDaEquipe: () => "/api/sessao/google", sessaoApi: { urlGoogle: "/api/sessao/google" },
      botao: () => '<button type="button">Entrar</button>',
    });
    conferir(html);
  });
});

describe("rodapé legal nos cartões", () => {
  for (const tipo of ["inicio", "cadastro"] as const) {
    it.each([true, false])(`${tipo}: Google %s, inclusive ocupado e com erro`, (google) => {
      conferir(htmlEtapa({ tipo, erro: "Falhou" }, { ocupado: true, google, agora: 0 }));
    });
  }
});

it("desktop abre as URLs legais externamente e nega uma janela interna (ADR-053)", () => {
  const main = readFileSync("desktop/main.ts", "utf8");
  const inicio = main.indexOf("w.webContents.setWindowOpenHandler(");
  const trecho = main.slice(inicio, main.indexOf("\n  w.webContents.on", inicio));
  const openExternal = vi.fn();
  let handler: ((p: { url: string }) => { action: string }) | undefined;
  runInNewContext(trecho, {
    w: { webContents: { setWindowOpenHandler: (h: typeof handler) => { handler = h; } } },
    origem: "https://app.example.com", abreNoNavegador, shell: { openExternal },
  });
  for (const caminho of ["privacidade", "termos"]) {
    const url = `https://nodbot.ai/${caminho}`;
    expect(handler?.({ url })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenLastCalledWith(url);
  }
});
