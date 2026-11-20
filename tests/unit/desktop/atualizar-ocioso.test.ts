import { describe, expect, it } from "vitest";
import { deveAtualizarOcioso, ESPERA_ENTRE_TENTATIVAS_MS, OCIOSO_MIN_S, type SinaisOcioso } from "../../../desktop/atualizar-ocioso.ts";

const BASE: SinaisOcioso = { pronta: true, ociosoSegundos: OCIOSO_MIN_S, turnos: 0, telas: 0, emLigacao: false, janelaEmFoco: false, ultimaTentativaEm: null, agora: 10_000_000 };

describe("atualizar com o Mac ocioso (ADR-173)", () => {
  it("reinicia só com a versão pronta, a pessoa longe e nada rodando", () => {
    expect(deveAtualizarOcioso(BASE)).toBe(true);
    expect(deveAtualizarOcioso({ ...BASE, pronta: false })).toBe(false);
    expect(deveAtualizarOcioso({ ...BASE, ociosoSegundos: OCIOSO_MIN_S - 1 })).toBe(false);
    expect(deveAtualizarOcioso({ ...BASE, turnos: 1 })).toBe(false);
    expect(deveAtualizarOcioso({ ...BASE, telas: 1 })).toBe(false);
    expect(deveAtualizarOcioso({ ...BASE, emLigacao: true })).toBe(false);
    expect(deveAtualizarOcioso({ ...BASE, janelaEmFoco: true })).toBe(false);
  });

  it("não insiste: espera meia hora depois de uma tentativa", () => {
    expect(deveAtualizarOcioso({ ...BASE, ultimaTentativaEm: BASE.agora - ESPERA_ENTRE_TENTATIVAS_MS + 1 })).toBe(false);
    expect(deveAtualizarOcioso({ ...BASE, ultimaTentativaEm: BASE.agora - ESPERA_ENTRE_TENTATIVAS_MS })).toBe(true);
  });
});
