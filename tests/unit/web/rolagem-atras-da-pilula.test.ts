import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ligarAlturaDoCampo } from "../../../web/lib/altura-do-campo.ts";

/**
 * Paridade com o Grok Bot (2026-11-22): a timeline rola por trás da pílula (esmaece no topo) e por trás do campo (só some
 * no fim dele). O CSS puxa a timeline por baixo do cabeçalho e do campo; `--campo-h` é a altura do campo, medida no TS.
 */
const chat = readFileSync(new URL("../../../web/chat.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const regra = (seletor: string): string => {
  const i = chat.indexOf(seletor);
  expect(i).toBeGreaterThan(-1);
  return chat.slice(chat.indexOf("{", i) + 1, chat.indexOf("}", i));
};

describe("a rolagem passa por trás da pílula e do campo", () => {
  it("a timeline sobe por baixo do cabeçalho, desce por baixo do campo e esmaece no topo", () => {
    const r = regra(".stage > .cabecalho-pilula:not(.cabecalho-abas) ~ #timeline");
    expect(r).toMatch(/margin-top:\s*calc\(-1 \* var\(--cab-h\)\)/);
    expect(r).toMatch(/margin-bottom:\s*calc\(-1 \* var\(--campo-h\)\)/);
    expect(r).toMatch(/padding-top:\s*calc\(var\(--cab-h\) \+ 12px\)/);
    expect(r).toMatch(/padding-bottom:\s*calc\(16px \+ var\(--campo-h\)\)/);
    expect(r).toMatch(/mask-image:\s*linear-gradient\(to bottom, transparent 0, #000 var\(--esmaecer-topo\)\)/);
  });

  it("o cabeçalho e o campo não têm fundo cheio por cima do texto", () => {
    expect(regra(".stage > .cabecalho-pilula:not(.cabecalho-abas) {")).toMatch(/background:\s*transparent/);
    expect(regra(".stage > .cabecalho-pilula:not(.cabecalho-abas) ~ .composer-wrap")).toMatch(/background:\s*transparent/);
  });

  it("sem a medida do campo o CSS cai em 0 px (o layout antigo)", () => {
    expect(regra(".stage { --cab-h")).toMatch(/--campo-h:\s*0px/);
  });
});

describe("ligarAlturaDoCampo", () => {
  function docDe(altura: () => number, comObservador = true) {
    const props = new Map<string, string>();
    const palco = { style: { getPropertyValue: (k: string) => props.get(k) ?? "", setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } };
    const campo = { get offsetHeight() { return altura(); } };
    let aoMudar: () => void = () => {};
    const disconnect = vi.fn();
    class RO { constructor(cb: () => void) { aoMudar = cb; } observe() {} disconnect = disconnect; }
    const doc = { querySelector: () => palco, getElementById: () => campo, defaultView: comObservador ? { ResizeObserver: RO } : {} } as unknown as Document;
    return { doc, props, aoMudar: () => aoMudar(), disconnect };
  }

  it("publica a altura do campo e a atualiza quando ele cresce", () => {
    let h = 66;
    const t = docDe(() => h);
    const desligar = ligarAlturaDoCampo(t.doc);
    expect(t.props.get("--campo-h")).toBe("66px");
    h = 110;
    t.aoMudar();
    expect(t.props.get("--campo-h")).toBe("110px");
    desligar();
    expect(t.disconnect).toHaveBeenCalled();
    expect(t.props.has("--campo-h")).toBe(false);
  });

  it("sem ResizeObserver não faz nada (fica o CSS de 0 px)", () => {
    const t = docDe(() => 66, false);
    ligarAlturaDoCampo(t.doc)();
    expect(t.props.size).toBe(0);
  });
});
