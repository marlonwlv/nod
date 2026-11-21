import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// QA-189: duplo clique em Gerar token, Criar rotina e Criar sala gravava dois (visto no Chrome real: 2 tokens MCP com um só
// mostrado, 2 rotinas, 2 salas). Os formulários que criam algo passam pela trava de um envio por vez.
const main = readFileSync(join(process.cwd(), "web/main.ts"), "utf8");

describe("formulários que criam algo têm um envio por vez", () => {
  it("a lista cobre o token MCP, a rotina, a sala, a memória e o bot, e cada um existe no FORMS", () => {
    const lista = /const FORMS_QUE_CRIAM = \[([^\]]+)\]/.exec(main)?.[1] ?? "";
    const nomes = [...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(nomes).toEqual(["gerar-token-mcp", "criar-rotina", "criar-sala", "criar-memoria", "criar-agente"]);
    for (const n of nomes) expect(main).toContain(`  "${n}": (form) =>`);
  });
  it("a trava é aplicada antes do ouvinte de submit e com a chave própria", () => {
    const trava = main.indexOf("FORMS[qual] = (form) => umEnvioPorVez(`cria:${qual}`, form, () => tratar(form));");
    const ouvinte = main.indexOf('document.addEventListener("submit"');
    expect(trava).toBeGreaterThan(0);
    expect(trava).toBeLessThan(ouvinte);
  });
});
