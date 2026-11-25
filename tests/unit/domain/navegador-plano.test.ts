import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../../src/contracts/ferramentas-navegador.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { composicaoDoPlano } from "../../../src/domain/raio-x.ts";
import { nomeDaFerramenta, rotuloAgora, rotuloFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";

/** ADR-190: as 12 diretas entram no plano com origem "navegador", o prompt explica, o Raio-X agrupa e os rótulos dizem. */
const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "", descricao: "compra passagens", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
const doNavegador = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.filter((f) => f.origem === "navegador");

describe("o navegador no plano (ADR-190)", () => {
  it("ligado, as 12 diretas entram (o catálogo fica atrás de buscar/usar) e as de leitura levam readOnlyHint", () => {
    const p = montarPlano({ ...base, navegador: true });
    const f = doNavegador(p);
    expect(f.map((x) => x.nome).sort()).toEqual(Object.keys(FERRAMENTAS_NAVEGADOR_DIRETAS).sort());
    expect(f).toHaveLength(12);
    expect(f.filter((x) => x.readOnlyHint).map((x) => x.nome).sort()).toEqual(["navegador_buscar", "navegador_esperar", "navegador_ler", "navegador_ver"]);
    expect(f.every((x) => x.nomeMcp === `mcp__nod__${x.nome}` && x.conectorId === null)).toBe(true);
    expect(p.catalogo.ferramentas.some((x) => x.nome === "navegador_texto")).toBe(false);
    expect(p.catalogo.ferramentas.some((x) => x.nome === "ler_mais")).toBe(true);
    expect(p.promptSistema).toContain("Você tem um navegador só seu");
    expect(p.promptSistema).toContain("Nunca peça senha no chat");
    // T3: a tarefa ensinada vira a pergunta com as duas respostas rápidas (pedir_a_pessoa com opções).
    expect(p.promptSistema).toContain("pergunte com pedir_a_pessoa se você faz sozinho, com duas opções curtas: um ritmo que caiba na tarefa (como “Todo dia 5”) e “Só quando eu pedir”");
  });

  it("com o computador no mesmo turno, site é do navegador: o computador não manda abrir sites (QA do Windows)", () => {
    const juntos = montarPlano({ ...base, navegador: true, computador: true }).promptSistema;
    expect(juntos).toContain("Sites vão pelo seu navegador (navegador_*), mesmo quando a pessoa diz \"abre o Chrome\" ou \"no computador\"");
    expect(juntos).toContain("siga pelo navegador sem contar a falha do computador à pessoa");
    expect(juntos).not.toContain("Use computador_navegar para abrir sites");
    // Só o computador: ele segue abrindo os sites, como antes.
    const so = montarPlano({ ...base, computador: true }).promptSistema;
    expect(so).toContain("Use computador_navegar para abrir sites");
    expect(so).not.toContain("Sites vão pelo seu navegador");
  });

  it("desligado (sem motor em lugar nenhum), nada do navegador entra nem no prompt", () => {
    const p = montarPlano(base);
    expect(doNavegador(p)).toEqual([]);
    expect(p.promptSistema).not.toContain("Você tem um navegador");
  });

  it("o Raio-X conta o grupo do navegador e o parágrafo cai na seção do computador", () => {
    const p = montarPlano({ ...base, navegador: true });
    const c = composicaoDoPlano({ ...p, machineId: "m1", tokenDeTurno: "tok" }, { modo: "conversa", comTexto: false });
    expect(c.ferramentas.find((g) => g.grupo === "navegador")).toMatchObject({ origem: "navegador", quantidade: 12 });
  });
});

describe("rótulos das navegador_* (não o servidor MCP de fora chamado navegador)", () => {
  it("agora, feito e nome", () => {
    expect(rotuloAgora("mcp__nod__navegador_abrir", "https://www.example.com/x?q=1")).toBe("Abrindo example.com");
    expect(rotuloAgora("mcp__nod__navegador_clicar", "@e3")).toBe("Clicando");
    expect(rotuloAgora("mcp__nod__navegador_ler")).toBe("Lendo a página");
    expect(rotuloAgora("mcp__nod__navegador_usar")).toBe("Usando o navegador");
    expect(rotuloFerramenta("mcp__nod__navegador_clicar")).toBe("Usou o navegador");
    expect(nomeDaFerramenta("mcp__nod__navegador_ver")).toBe("Navegador");
    // O servidor MCP de fora com nome de navegador segue como antes.
    expect(rotuloFerramenta("mcp__navegador__click")).toBe("Usou o navegador");
  });
});
