import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderFaixaParada } from "../../../web/telas/faixa-parada.ts";

const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

describe("o Parar é uma linha discreta, não uma caixa vermelha", () => {
  it("o caso comum diz só 'Parado por você', sem contagens nem ×", () => {
    const h = renderFaixaParada({ interrompidas: 2, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(h).toContain("<span>Parado por você</span>");
    expect(h).not.toMatch(/interrompida\(s\)|não interrompida|já entregue|Nada foi reenviado|fechar-faixa/);
  });

  it("os números só aparecem quando contam algo inesperado, com o detalhe no title", () => {
    const h = renderFaixaParada({ interrompidas: 1, naoInterrompidas: [{ turnoId: "abcdef1234", motivo: "em outra máquina" }], jaEntregues: [{ id: "m1", em: "2026-11-16T22:00:00Z" }], nadaRodando: false });
    expect(h).toContain("1 continuou rodando");
    expect(h).toContain('title="abcdef12: em outra máquina"');
    expect(h).toContain("1 resposta já tinha saído");
  });

  it("'Nada estava rodando' continua escrito", () => {
    expect(renderFaixaParada({ interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true })).toContain("Nada estava rodando.");
  });

  it("na conversa: sem caixa e sem vermelho, cinza em corpo 2; some com a próxima mensagem", () => {
    const c = css("casca.css");
    expect(c).toMatch(/\.timeline \.faixa\.faixa-parada \{[^}]*border: 0;[^}]*background: none; color: var\(--ink-3\); font-size: var\(--fs-corpo-2\);/);
    const m = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(m).toContain('if (estado.faixaParada) dispatch({ tipo: "faixa", faixa: null });');
  });
});
