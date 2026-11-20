import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Conector } from "../../../../../src/contracts/conector.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaConectoresAvancado } from "../../../../../web/react/telas/conectores-avancado.tsx";

/**
 * QA-159 (família do QA-157): em Conectores avançados (React, #230), "revogar" pelo teclado tira a linha da concessão
 * quando as concessões voltam do servidor (o main invalida `concessoes:<bot>`), e o foco caía no <body>.
 */
const mcp = (id: string): Conector => ({
  tenantId: "t", id, ownerId: "p", visibility: "privado", nome: `MCP ${id}`, slug: id, transporte: "stdio", comando: "node", args: [], url: null, env: {} as never, declaracao: "nao-toca",
  habilitado: true, catalogo: [{ nome: "LER", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }, { nome: "ESCREVER", descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" }],
  sondadoEm: 100, ultimaFalha: null, criadoEm: 0,
}) as Conector;
type G = { id: string; conectorId: string; capacidade: string };
let desmontar: (() => void) | null = null;
afterEach(() => { desmontar?.(); desmontar = null; document.body.innerHTML = ""; });
function montar(gs: G[]) {
  let e: Estado = { ...estadoInicial, agora: 65_000, sessao: { tenantId: "t", pessoaId: "p" }, composioConfigurado: true,
    frota: { agentes: [{ id: "a1", nome: "Nina", ownerId: "p", cor: "c-blue", forma: "shape-circle", confirmado: true }] } as never,
    conectores: [mcp("m1"), mcp("m2")], concessoes: { a1: gs } as never, tela: { tipo: "conectores", avancado: true } as never };
  const loja = criarLoja(() => e);
  const revogar = (id: string) => act(() => { e = { ...e, concessoes: { a1: (e.concessoes as Record<string, G[]>)["a1"]!.filter((g) => g.id !== id) } as never }; loja.avisar(); });
  const t = render(<TelaConectoresAvancado loja={loja} acoes={{ formulario: () => {}, acao: () => {} }} />, { container: document.body.appendChild(document.createElement("div")) });
  desmontar = t.unmount;
  const botao = (id: string) => t.container.querySelector<HTMLElement>(`button[data-id="${id}"][data-agente]`)!;
  const conceder = (c: string) => t.container.querySelector<HTMLElement>(`[data-conector="${c}"] form.linha button[type=submit]`)!;
  return { ...t, revogar, botao, conceder };
}

describe("QA-159: o foco em Conectores avançados ao revogar pelo teclado", () => {
  it("revogada a do meio, vai ao revogar da seguinte do mesmo conector; na última, à anterior", () => {
    const t = montar([{ id: "g1", conectorId: "m1", capacidade: "LER" }, { id: "g2", conectorId: "m1", capacidade: "ESCREVER" }, { id: "g3", conectorId: "m2", capacidade: "LER" }]);
    t.botao("g1").focus();
    t.revogar("g1");
    expect(document.activeElement).toBe(t.botao("g2"));
    t.revogar("g2");
    expect(document.activeElement).not.toBe(t.botao("g3"));
    expect(document.activeElement).toBe(t.conceder("m1"));
  });

  it("revogada a única do conector, vai ao Conceder do mesmo conector, não ao <body> nem a outro conector", () => {
    const t = montar([{ id: "g1", conectorId: "m1", capacidade: "LER" }, { id: "g3", conectorId: "m2", capacidade: "LER" }]);
    t.botao("g3").focus();
    t.revogar("g3");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(t.conceder("m2"));
  });

  it("foco fora da tela não é mexido", () => {
    const t = montar([{ id: "g1", conectorId: "m1", capacidade: "LER" }]);
    const fora = document.body.appendChild(document.createElement("button"));
    fora.focus();
    t.revogar("g1");
    expect(document.activeElement).toBe(fora);
  });
});
