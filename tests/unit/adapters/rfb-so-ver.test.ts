import { describe, expect, it } from "vitest";
import { criarFiltroRfb, RFB_MENSAGEM_MAX_BYTES } from "../../../src/adapters/computador/rfb-so-ver.ts";

/** Card D, F3: o filtro do fluxo de quem assiste; o aperto e o que é só para ver passam, o que mexe só com `entrada`. */
const bytes = (...xs: number[]) => new Uint8Array(xs);
const versao = (v: string) => new TextEncoder().encode(`RFB 003.${v}\n`);
const ok = (r: ReturnType<ReturnType<typeof criarFiltroRfb>>) => { if ("erro" in r) throw new Error(r.erro); return [...r.passa]; };

describe("filtro RFB de quem assiste", () => {
  it("3.8: aperto passa; tecla, ponteiro e área de transferência caem; codificações e quadro passam, mesmo em pedaços", () => {
    const f = criarFiltroRfb();
    expect(ok(f(versao("008"), false))).toEqual([...versao("008")]);
    expect(ok(f(bytes(1, 1), false))).toEqual([1, 1]);
    const encodings = bytes(2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1);
    expect(ok(f(encodings.subarray(0, 5), false))).toEqual([]);
    expect(ok(f(encodings.subarray(5), false))).toEqual([...encodings]);
    const tecla = bytes(4, 1, 0, 0, 0, 0, 0, 0x61);
    const ponteiro = bytes(5, 0, 0, 1, 0, 1);
    const cola = bytes(6, 0, 0, 0, 0, 0, 0, 2, 0x61, 0x62);
    const quadro = bytes(3, 1, 0, 0, 0, 0, 5, 0, 3, 32);
    expect(ok(f(new Uint8Array([...tecla, ...ponteiro, ...cola, ...quadro]), false))).toEqual([...quadro]);
    expect(ok(f(new Uint8Array([...tecla, ...ponteiro]), true))).toEqual([...tecla, ...ponteiro]);
  });

  it("3.3 sem byte de segurança; senha VNC traz 16 bytes; QEMU tecla estendida cai", () => {
    const f = criarFiltroRfb();
    ok(f(versao("003"), false));
    expect(ok(f(bytes(1), false))).toEqual([1]); // ClientInit
    expect(ok(f(bytes(255, 0, 0, 1, 0, 0, 0, 0x61, 0, 0, 0, 30), false))).toEqual([]);
    const g = criarFiltroRfb();
    ok(g(versao("008"), false));
    expect(ok(g(new Uint8Array([2, ...new Array(16).fill(7), 1]), false))).toHaveLength(18);
  });

  it("falha fechado: versão estranha, segurança desconhecida, mensagem desconhecida ou grande demais", () => {
    expect("erro" in criarFiltroRfb()(new TextEncoder().encode("GET / HTTP/1."), false)).toBe(true);
    const s = criarFiltroRfb();
    ok(s(versao("008"), false));
    expect("erro" in s(bytes(19), false)).toBe(true);
    expect("erro" in s(bytes(3), false)).toBe(true); // quebrado fica quebrado
    const m = criarFiltroRfb();
    ok(m(new Uint8Array([...versao("008"), 1, 1]), false));
    expect("erro" in m(bytes(77), false)).toBe(true);
    const g = criarFiltroRfb();
    ok(g(new Uint8Array([...versao("008"), 1, 1]), false));
    const n = RFB_MENSAGEM_MAX_BYTES + 1;
    expect("erro" in g(bytes(6, 0, 0, 0, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255), false)).toBe(true);
  });
});
