import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Conector } from "../../../../../src/contracts/conector.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderConectores } from "../../../../../web/telas/conectores.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaConectoresAvancado } from "../../../../../web/react/telas/conectores-avancado.tsx";

/** ADR-179 (item 2): a tela avançada dos Conectores em React — o DOM da string, os formulários e botões pelos handlers. */
const mcp: Conector = {
  tenantId: "t", id: "c-mcp", ownerId: "p", visibility: "privado", nome: "Meu <MCP>", slug: "meu-mcp", transporte: "stdio", comando: "node", args: ["a.mjs", "--x"], url: null, env: { TOKEN: true } as never, declaracao: "nao-declarou",
  habilitado: false, catalogo: [{ nome: "LER", descricao: "lê <coisas>", schema: {}, readOnlyHint: true, grupo: "ler" }, { nome: "ESCREVER", descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" }],
  sondadoEm: 100, ultimaFalha: { causa: "outra", motivo: "timeout_transporte", em: 5_000 } as never, criadoEm: 0,
};
const github: Conector = { ...mcp, id: "c-gh", nome: "GitHub", slug: "github", transporte: "stdio", comando: "nod:github", args: [], env: { GITHUB_TOKEN: true } as never, declaracao: "nao-toca", habilitado: true,
  catalogo: [{ nome: "pr_ver", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }], ultimaFalha: null, sondadoEm: null };
const base: Estado = {
  ...estadoInicial, agora: 65_000, sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "a1", nome: "Nina", ownerId: "p", cor: "c-blue", forma: "shape-circle", confirmado: true }] } as never,
  concessoes: { a1: [{ id: "g1", conectorId: "c-mcp", capacidade: "LER" }] } as never,
  tela: { tipo: "conectores", avancado: true } as never,
};

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-form]")) n.removeAttribute("data-form");
  for (const n of c.querySelectorAll("[data-act]")) n.removeAttribute("data-act");
  for (const n of c.querySelectorAll("option[selected]")) n.removeAttribute("selected");
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.name === "class" ? a.value.trim() : a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><").replace(/\s+</g, "<").replace(/>\s+/g, ">");
}
const porString = (e: Estado): Element => { const d = document.createElement("div"); d.innerHTML = renderConectores(e); return d.firstElementChild!; };
const montar = (e: Estado, acoes = { formulario: vi.fn(), acao: vi.fn() }) => ({ ...render(<TelaConectoresAvancado loja={criarLoja(() => e)} acoes={acoes} />), acoes });

describe("a tela avançada dos Conectores em React", () => {
  it.each([
    ["sem conectores, Composio por configurar", { ...base, conectores: [], composioConfigurado: false }],
    ["com o MCP próprio (falha, catálogo, concessão) e o GitHub nativo com token", { ...base, conectores: [mcp, github], composioConfigurado: true, avisoConexao: "Conectado <ok>" }],
  ] as [string, unknown][])("%s: o DOM da string", (_, e) => {
    const { container } = montar(e as Estado);
    expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(e as Estado)));
  });

  it("os formulários e os botões chamam os handlers do main com o formulário e o botão (o dataset)", () => {
    const { container, acoes } = montar({ ...base, conectores: [mcp], composioConfigurado: true } as Estado);
    fireEvent.submit(container.querySelector(".composio-form")!);
    expect(acoes.formulario).toHaveBeenLastCalledWith("configurar-composio", container.querySelector(".composio-form"));
    fireEvent.submit(container.querySelector('form.linha[data-id="c-mcp"]')!);
    expect(acoes.formulario).toHaveBeenLastCalledWith("conceder", container.querySelector('form.linha[data-id="c-mcp"]'));
    const sondar = [...container.querySelectorAll<HTMLButtonElement>(".acoes button")].find((b) => b.textContent === "Sondar")!;
    fireEvent.click(sondar);
    expect(acoes.acao).toHaveBeenLastCalledWith("sondar-conector", sondar);
    expect(sondar.dataset["id"]).toBe("c-mcp");
    const revogar = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "revogar")!;
    fireEvent.click(revogar);
    expect(acoes.acao).toHaveBeenLastCalledWith("revogar", revogar);
    expect(revogar.dataset).toMatchObject({ id: "g1", agente: "a1" });
    fireEvent.click(container.querySelector(".bt.link")!);
    expect(acoes.acao).toHaveBeenLastCalledWith("navegar-marketplace", container.querySelector(".bt.link"));
  });

  it("os selects do Conceder têm nome acessível nas duas versões (QA-186)", () => {
    const e = { ...base, conectores: [mcp], composioConfigurado: true } as Estado;
    const { container } = montar(e);
    for (const raiz of [container, porString(e)]) {
      const nomes = [...raiz.querySelectorAll<HTMLSelectElement>('form.linha select')].map((s) => s.getAttribute("aria-label"));
      expect(nomes).toEqual(["Bot", "Ação"]);
    }
  });
});
