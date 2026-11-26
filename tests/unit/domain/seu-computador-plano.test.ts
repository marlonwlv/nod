import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { textoDoSeuComputador } from "../../../src/domain/prompt-sistema.ts";

/**
 * ADR-197 (item 9): as seu_computador_* entram só na conversa da pessoa com o próprio bot, com um Mac ou PC dela
 * atendendo; o prompt diz a ordem dos lugares (app → navegador → computador do bot → computador da pessoa).
 */
const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "", descricao: "PM", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "lança as passagens no Numbers", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);
const MAC = { plataforma: "darwin" as const, nome: "MacBook" };

describe("o computador da pessoa no plano", () => {
  it("entra na conversa com o aparelho; nunca sem ele, em rotina, em sala nem a pedido de outra pessoa", () => {
    const p = montarPlano({ ...base, seuComputador: MAC });
    expect(nomes(p)).toEqual(expect.arrayContaining(["seu_computador_ver", "seu_computador_clicar", "seu_computador_apps"]));
    expect(p.catalogo.ferramentas.find((f) => f.nome === "seu_computador_ver")).toMatchObject({ origem: "seu_computador", readOnlyHint: true });
    expect(p.catalogo.ferramentas.find((f) => f.nome === "seu_computador_clicar")).toMatchObject({ readOnlyHint: false });
    expect(nomes(montarPlano(base)).some((n) => n.startsWith("seu_computador_"))).toBe(false);
    expect(nomes(montarPlano({ ...base, seuComputador: MAC, modo: "rotina" })).some((n) => n.startsWith("seu_computador_"))).toBe(false);
    expect(nomes(montarPlano({ ...base, seuComputador: MAC, modo: "sala" })).some((n) => n.startsWith("seu_computador_"))).toBe(false);
    expect(nomes(montarPlano({ ...base, seuComputador: MAC, turno: { ...turno, sobProcuracaoDe: "outra" } })).some((n) => n.startsWith("seu_computador_"))).toBe(false);
  });

  it("o prompt traz a ordem dos lugares e o aparelho certo", () => {
    const mac = montarPlano({ ...base, seuComputador: MAC, navegador: true });
    expect(mac.promptSistema).toContain("Onde trabalhar, nesta ordem");
    expect(mac.promptSistema).toContain("o Mac da pessoa (seu_computador_*)");
    const pc = montarPlano({ ...base, seuComputador: { plataforma: "win32", nome: "PC da Ana" } });
    expect(pc.promptSistema).toContain("o PC da pessoa (seu_computador_*)");
    expect(montarPlano(base).promptSistema).not.toContain("seu_computador_");
  });

  it("a ordem numera só os lugares que existem no turno", () => {
    expect(textoDoSeuComputador("Mac", { navegador: true, computador: true })).toMatch(/1\) um app conectado.*2\) o seu navegador.*3\) o seu computador na nuvem.*4\) o Mac da pessoa/);
    expect(textoDoSeuComputador("PC", { navegador: false, computador: false })).toMatch(/1\) um app conectado.*2\) o PC da pessoa/);
  });
});
