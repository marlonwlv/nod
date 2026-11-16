import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { cartaoDoTempoDaFrente } from "../../../web/telas/trabalhos.ts";

// Casca, rodada 4 (Paper 15b): o cartão "Aberta há 18 min" da frente — a barra em dois segmentos na proporção (o
// trabalhado na cor do bot) e a legenda "Trabalhando 14 min" × "Esperando 4 min".
const MIN = 60_000;
const AGORA = 1_800_000_000_000;
const frente = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({ id: "w3", agenteId: "dante", conversaId: "c", titulo: "PR #491", estado: "rodando", criadoEm: AGORA - 18 * MIN, iniciadoEm: AGORA - 18 * MIN, terminadoEm: null, trabalhouMs: 14 * MIN, forma: "frente", ...extra }) as unknown as TrabalhoDto;

describe("cartaoDoTempoDaFrente (Paper 15b)", () => {
  it("aberta há 18 min: dois segmentos na proporção 14 × 4, a cor do bot e a legenda embaixo", () => {
    const html = cartaoDoTempoDaFrente(frente(), AGORA, "c-orange");
    expect(html).toContain('<div class="tk-pop tk-pop-frente c-orange" role="group" aria-label="Tempo da frente">');
    expect(html).toContain('<div class="tk-pop-total">Aberta há 18 min</div>');
    expect(html).toContain('<span class="tk-pop-seg trabalhou" style="flex-grow:840"></span><span class="tk-pop-seg esperou" style="flex-grow:240"></span>');
    expect(html).toContain('<div class="tk-pop-pe"><span>Trabalhando 14 min</span><span class="tk-pop-esperou">Esperando 4 min</span></div>');
  });
  it("sem espera, um segmento só; cor fora do formato c-<nome> não entra na classe", () => {
    const html = cartaoDoTempoDaFrente(frente({ trabalhouMs: 18 * MIN }), AGORA, 'x" onclick="y');
    expect(html).not.toContain("tk-pop-seg esperou");
    expect(html).toContain('class="tk-pop tk-pop-frente"');
  });
});
