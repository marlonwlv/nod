import { describe, expect, it } from "vitest";
import { destinoAoFechar } from "../../../../web/react/dialogos/confirmar.tsx";

// QA r235: o `origem` do diálogo de confirmar não era usado; o foco caía no <body> quando o botão fora redesenhado.
describe("diálogo de confirmar: para onde o foco volta (QA r235)", () => {
  it("a origem se ainda está na página; senão o que reencontrar acha; senão o padrão", () => {
    const viva = { isConnected: true } as HTMLElement;
    const velha = { isConnected: false } as HTMLElement;
    const nova = { isConnected: true, id: "nova" } as unknown as HTMLElement;
    expect(destinoAoFechar({ origem: viva, reencontrar: () => nova })).toBe(viva);
    expect(destinoAoFechar({ origem: velha, reencontrar: () => nova })).toBe(nova);
    expect(destinoAoFechar({ origem: velha, reencontrar: () => null })).toBe(true);
    expect(destinoAoFechar({})).toBe(true);
  });
});
