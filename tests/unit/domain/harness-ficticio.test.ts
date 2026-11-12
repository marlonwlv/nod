import { describe, expect, it, vi } from "vitest";
import type { CapacidadesHarness, CatalogoHarness, IdHarness } from "../../../src/contracts/harness.ts";

/**
 * NOD-207 (ADR-083), teste de contrato: um harness que só existe no catálogo (HARNESSES + CAPACIDADES_HARNESS) ganha
 * anexo, /uso → /cost, caminho da pasta e o modelo do automático sem nenhuma linha fora do contrato mencionar o id.
 */
const FICTICIO = "ficticio-cli" as IdHarness;
const CAPACIDADES_FICTICIO: CapacidadesHarness = { mensagemNoMeio: false, retomaSessao: false, bifurcaSessao: false, processoProprio: true, terminal: false, anexos: ["imagem", "pdf"], comandosDoCli: true, pastaDeTrabalho: true, anexarMidia: false };

vi.mock("../../../src/contracts/harness.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/contracts/harness.ts")>();
  const ficticio = { id: FICTICIO, nome: "Fictício", descricao: "Harness fictício do teste de contrato.", integrado: true, modelos: [{ id: "ficticio-9", nome: "Fictício 9", descricao: "fictício", raciocinios: ["low", "medium", "high"] }], recomendado: { modelo: "ficticio-9", raciocinio: "medium" } } as const;
  return { ...original, HARNESSES: [...original.HARNESSES, ficticio], CAPACIDADES_HARNESS: { ...original.CAPACIDADES_HARNESS, [FICTICIO]: CAPACIDADES_FICTICIO } };
});

const { motorLe } = await import("../../../src/domain/anexo.ts");
const { traduzirParaOCli } = await import("../../../src/domain/comandos.ts");
const { capacidadesDe, opcoesDoCatalogo, resolverHarness } = await import("../../../src/domain/harness.ts");
const { aceitaDoBot, mostraCaminhoDaPasta } = await import("../../../web/lib/capacidades.ts");
const { HARNESS_LEGADO } = await import("../../../src/contracts/harness.ts");

describe("NOD-207: harness fictício só no catálogo", () => {
  const catalogo: CatalogoHarness = { padrao: null, simulacao: false, legado: HARNESS_LEGADO, opcoes: opcoesDoCatalogo(() => ({ estado: "pronto", versao: "1", em: 0 })) };

  it("o domínio lê as capacidades declaradas", () => {
    expect(capacidadesDe(FICTICIO)).toEqual(CAPACIDADES_FICTICIO);
    expect(catalogo.opcoes.find((o) => o.id === FICTICIO)?.capacidades).toEqual(CAPACIDADES_FICTICIO);
  });

  it("anexo: o servidor aceita imagem e PDF e recusa texto; o composer oferece tudo (tem PDF)", () => {
    expect([motorLe(FICTICIO, "imagem"), motorLe(FICTICIO, "pdf"), motorLe(FICTICIO, "texto")]).toEqual([true, true, false]);
    expect(aceitaDoBot(catalogo, FICTICIO)).toBe("tudo");
  });

  it("/uso vira /cost porque declarou comandosDoCli", () => {
    expect(traduzirParaOCli("/uso", FICTICIO)).toBe("/cost");
  });

  it("a gaveta mostra o caminho porque declarou pastaDeTrabalho", () => {
    expect(mostraCaminhoDaPasta(catalogo, FICTICIO)).toBe(true);
  });

  it("o automático usa o Recomendado dele quando é o único pronto", () => {
    expect(resolverHarness({ modelo: "auto", prontos: [FICTICIO] })).toEqual({ harness: FICTICIO, modelo: "ficticio-9", raciocinio: "medium" });
  });

  it("os harnesses reais seguem iguais com o fictício no catálogo", () => {
    expect(aceitaDoBot(catalogo, "codex-cli")).toBe("sem_pdf");
    expect(traduzirParaOCli("/uso", "claude-cli")).toBe("/cost");
    expect(mostraCaminhoDaPasta(catalogo, "codex-cli")).toBe(true);
  });
});
