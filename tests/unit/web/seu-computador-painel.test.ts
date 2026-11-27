import { describe, expect, it } from "vitest";
import { htmlPainelSeuComputador } from "../../../web/lib/seu-computador-painel.ts";
import { htmlLugares } from "../../../web/lib/navegador-vista.ts";

/** ADR-197 (S4): a aba "Seu Mac" do painel. */
describe("a aba Seu Mac do painel", () => {
  const vista = { agenteId: "a", aparelho: "Mac" as const, app: "Numbers", quadro: "data:image/jpeg;base64,QUFB", ativoEm: 1_000_000, passos: [
    { acao: "abrir_app" as const, app: "Numbers", efeito: null, ok: true, em: 990_000 },
    { acao: "digitar" as const, app: "Numbers", efeito: "confirmado", ok: true, em: 1_000_000 },
  ] };
  it("ao vivo: o quadro com a borda, os passos e o último em âmbar como agora", () => {
    const h = htmlPainelSeuComputador({ vista, nomeBot: "Ada", aparelho: "Mac", agora: 1_005_000 });
    expect(h).toContain("Ao vivo no seu Mac");
    expect(h).toContain('class="sc-quadro sc-quadro-vivo" src="data:image/jpeg;base64,QUFB"');
    expect(h).toContain("O que Ada fez");
    expect(h).toContain('<li class="sc-agora"><span class="sc-hora">agora</span><span>Digitou no Numbers</span></li>');
  });
  it("parado: a hora, sem âmbar; quadro estranho não entra; sem passos, o vazio explica", () => {
    const h = htmlPainelSeuComputador({ vista: { ...vista, quadro: "javascript:alert(1)" }, nomeBot: "Ada", aparelho: "PC", agora: 9_000_000 });
    expect(h).not.toContain("Ao vivo");
    expect(h).not.toContain("javascript:");
    expect(h).toContain("Sem imagem da janela");
    expect(htmlPainelSeuComputador({ vista: null, nomeBot: "Ada", aparelho: "PC", agora: 0 })).toContain("Quando Ada usar um app do seu PC");
  });
  it("o seletor de lugares ganha Seu Mac / Seu PC", () => {
    expect(htmlLugares(["navegador", "seu_computador"], "seu_computador", null, { aparelho: "PC" })).toContain("Seu PC");
  });
});
