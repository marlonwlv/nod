import { describe, expect, it } from "vitest";
import { criarBarramento } from "../../../src/services/barramento.ts";
import { comAvisoDeMensagem, criarAvisoDeMensagem } from "../../../src/services/aviso-de-mensagem.ts";

/** C1 (2026-11-12): a fala vai ao executor por evento — o long-poll acorda com o frame que pode trazer fala. */
describe("aviso de mensagem", () => {
  it("acorda quem espera a pessoa com `true`; outra pessoa não acorda", async () => {
    const aviso = criarAvisoDeMensagem();
    const minha = aviso.aguardar("p1", 10_000);
    const outra = aviso.aguardar("p2", 30);
    expect(aviso.esperando("p1")).toBe(1);
    aviso.avisar("p1");
    expect(await minha).toBe(true);
    expect(await outra).toBe(false);
    expect(aviso.esperando("p1") + aviso.esperando("p2")).toBe(0);
  });

  it("vence sem novidade com `false` e sai da fila", async () => {
    const aviso = criarAvisoDeMensagem();
    expect(await aviso.aguardar("p1", 5)).toBe(false);
    expect(aviso.esperando("p1")).toBe(0);
  });

  it("o barramento decorado acorda com mensagem.nova, turno.iniciado, trabalho.mudou e quadro.mudou — não com o resto", async () => {
    const aviso = criarAvisoDeMensagem();
    const b = comAvisoDeMensagem(criarBarramento(), aviso);
    const espera = aviso.aguardar("p1", 50);
    b.publicar("p1", "agente.estado", {});
    b.publicar("p1", "turno.atividade", {});
    expect(await espera).toBe(false);
    for (const tipo of ["mensagem.nova", "turno.iniciado", "trabalho.mudou", "quadro.mudou"] as const) {
      const e = aviso.aguardar("p1", 10_000);
      expect(b.publicar("p1", tipo, {})).not.toBeNull();
      expect(await e).toBe(true);
    }
  });
});
