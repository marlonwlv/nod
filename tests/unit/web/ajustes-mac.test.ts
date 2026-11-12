import { describe, expect, it } from "vitest";
import { atalhoDoTeclado, atalhoLegivel, htmlAjustesDoMac } from "../../../web/telas/ajustes-mac.ts";
import { TODAS_DESLIGADAS } from "../../../src/adapters/conectores-locais/mac/familias.ts";

describe("Configurações › Máquinas no Mac (ADR-171)", () => {
  it("as nove famílias aparecem desligadas por padrão, cada uma com o switch dela", () => {
    const html = htmlAjustesDoMac({ atalho: "Alt+Space", familias: TODAS_DESLIGADAS });
    expect(html.match(/data-act="alternar-ferramenta-mac"/g)?.length).toBe(9);
    expect(html).not.toContain('aria-checked="true"');
    expect(html).toContain('data-familia="imessage_enviar"');
    expect(html).toContain("⌥ Espaço");
  });

  it("gravando pede o atalho; a recusa aparece no lugar do apoio", () => {
    expect(htmlAjustesDoMac({ atalho: null, familias: TODAS_DESLIGADAS, gravando: true })).toContain("Aperte o atalho novo");
    expect(htmlAjustesDoMac({ atalho: "Alt+Space", familias: TODAS_DESLIGADAS, recusaAtalho: "Outro app já usa esse atalho. Escolha outro." })).toContain("Outro app já usa");
    expect(atalhoLegivel(null)).toBe("Desligado");
  });

  it("lê o atalho do teclado pelo código físico da tecla", () => {
    expect(atalhoDoTeclado({ key: " ", code: "Space", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false })).toBe("Alt+Space");
    expect(atalhoDoTeclado({ key: "∆", code: "KeyJ", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe("Command+Shift+J");
    expect(atalhoDoTeclado({ key: "Meta", code: "MetaLeft", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBeNull();
  });
});
