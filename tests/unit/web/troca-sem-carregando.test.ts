import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { criarEsperaDoSpinner, ESPERA_DO_PREFETCH_MS, ESPERA_DO_SPINNER_MS } from "../../../web/lib/cache-conversas.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * Item 5 do chat: trocar de bot sem "carregando conversa". Sem cache nenhum, a conversa anterior fica até 80 ms; depois a
 * área limpa e mostra só um spinner (anel de 28 px, trilho e topo por token, 700 ms linear infinito), sem texto à vista.
 */
const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

describe("troca sem 'carregando'", () => {
  it("a timeline sem conversa não tem o texto 'carregando conversa' nem o esqueleto: só o spinner (e o 'Carregando' do leitor de tela)", () => {
    const html = renderTimeline(null, estadoInicial);
    expect(html.toLowerCase()).not.toContain("carregando conversa");
    expect(html).not.toContain("esqueleto");
    expect(html).toContain('<span class="giro-conversa" aria-hidden="true"></span>');
    // O único texto é o do leitor de tela, escondido (sr-only).
    expect(html.replace(/<span class="sr-only">[^<]*<\/span>/, "").replace(/<[^>]+>/g, "").trim()).toBe("");
    expect(html).toContain('role="status"');
  });

  it("o spinner só aparece depois de 80 ms: até lá a conversa anterior fica, e um redesenho é agendado para os 80 ms", () => {
    const agendados: { fn: () => void; ms: number }[] = [];
    let redesenhos = 0;
    const espera = criarEsperaDoSpinner((fn, ms) => agendados.push({ fn, ms }), () => redesenhos++);
    expect(ESPERA_DO_SPINNER_MS).toBe(80);
    expect(espera.segurar("c2", 1000)).toBe(true);
    expect(agendados).toEqual([{ fn: expect.any(Function), ms: 80 }]);
    expect(espera.segurar("c2", 1079)).toBe(true);
    // Passou: o redesenho agendado mostra o spinner.
    agendados[0]!.fn();
    expect(redesenhos).toBe(1);
    expect(espera.segurar("c2", 1080)).toBe(false);
    expect(agendados).toHaveLength(1);
  });

  it("trocar de novo para outra conversa sem cache recomeça a espera; a que chegou solta", () => {
    const agendados: number[] = [];
    const espera = criarEsperaDoSpinner((_fn, ms) => agendados.push(ms), () => undefined);
    expect(espera.segurar("c2", 0)).toBe(true);
    expect(espera.segurar("c3", 50)).toBe(true);
    expect(espera.segurar("c3", 129)).toBe(true);
    expect(espera.segurar("c3", 130)).toBe(false);
    espera.soltar();
    expect(espera.segurar("c3", 500)).toBe(true);
    expect(agendados).toEqual([80, 80, 80]);
  });

  it("o spinner: 28 px, borda 2 px no trilho, topo na tinta 3, centrado, 360° em 700 ms linear infinito (só tokens)", () => {
    const c = css("chat-troca.css");
    expect(c).toMatch(/\.carregando-conversa \{[^}]*display: grid; place-items: center;/);
    expect(c).toMatch(/\.giro-conversa \{[^}]*width: 28px; height: 28px;[^}]*border: 2px solid var\(--chat-spinner-trilho\); border-top-color: var\(--chat-tinta-3\); border-radius: 50%; animation: giro-conversa 700ms linear infinite;/);
    expect(c).toContain("@keyframes giro-conversa { to { transform: rotate(360deg); } }");
  });

  it("imagens com skeleton até carregar (preenchido, raio 14) e o campo perde o foco animando a borda em 150 ms", () => {
    const c = css("chat-troca.css");
    expect(c).toMatch(/\.msg-midia-bt:not\(\.carregou\)[^{]*\{ background: var\(--chat-preenchido\); border-radius: 14px; \}/);
    expect(c).toMatch(/\.msg-anexo-img:not\(\.carregou\) \{ background: var\(--chat-preenchido\); \}/);
    expect(c).toContain(".composer .box.saindo-do-foco { animation: campo-sai-do-foco 150ms ease; }");
    expect(c).toContain("@keyframes campo-sai-do-foco { from { border-color: var(--chat-borda-campo-foco); } }");
  });

  it("o prefetch espera 150 ms de mouse parado na linha", () => {
    expect(ESPERA_DO_PREFETCH_MS).toBe(150);
  });
});
