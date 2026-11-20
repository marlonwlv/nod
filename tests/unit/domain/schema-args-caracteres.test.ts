import { describe, expect, it } from "vitest";
import { errosDoSchema } from "../../../src/domain/schema-args.ts";
import { FERRAMENTAS_ARTEFATO } from "../../../src/contracts/ferramentas-artefato.ts";
import { caracteres } from "../../../src/domain/artefato.ts";

// QA-71 (2026-11-19): o JSON Schema conta caracteres (pontos de código); o validador contava UTF-16.
describe("errosDoSchema: minLength/maxLength em caracteres", () => {
  const s = { type: "string", minLength: 2, maxLength: 3 } as const;

  it("emoji fora do BMP conta 1 caractere", () => {
    expect(errosDoSchema(s, "ab😀")).toEqual([]);
    expect(errosDoSchema(s, "😀😀")).toEqual([]);
    expect(errosDoSchema(s, "ab😀c")).toEqual(["$: máximo 3 caracteres"]);
    expect(errosDoSchema(s, "😀")).toEqual(["$: mínimo 2 caracteres"]);
  });

  it("substituto solto segue contando 1", () => {
    expect(errosDoSchema(s, "ab\ud83d")).toEqual([]);
    expect(errosDoSchema(s, "\udc00\ud83dab")).toEqual(["$: máximo 3 caracteres"]);
  });

  it("título de artefato com 120 caracteres e emoji no fim passa no schema e no domínio", () => {
    const titulo = `${"a".repeat(119)}😀`;
    expect(titulo.length).toBe(121);
    expect(caracteres(titulo)).toBe(120);
    expect(errosDoSchema(FERRAMENTAS_ARTEFATO.publicar_artefato, { titulo, html: "<p>x</p>" })).toEqual([]);
    expect(errosDoSchema(FERRAMENTAS_ARTEFATO.publicar_artefato, { titulo: `${titulo}b`, html: "<p>x</p>" })).toEqual(["$.titulo: máximo 120 caracteres"]);
  });
});
