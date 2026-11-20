import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import {
  alternarCompacta, aplicarBarra, arrasto, BARRA_PADRAO, barraPelaTecla, CHAVE_BARRA, CHAVE_DENSIDADE_ANTIGA, desserializar, iguais, lerBarra, limitar,
  maximo, migrarAntiga, pedidoDoChat, pintarBarra, pxDaBarra, rotuloDaLargura, serializar, type Barra,
} from "../../../web/lib/densidade.ts";

const raiz = () => {
  const props = new Map<string, string>();
  return { dataset: {} as Record<string, string | undefined>, style: { setProperty: (n: string, v: string) => void props.set(n, v), removeProperty: (n: string) => void props.delete(n) }, props };
};
const armazem = (inicial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const B = (larguraExpandida: number, compacta = false): Barra => ({ larguraExpandida, compacta });

describe("ADR-179: os limites da largura", () => {
  it("abre em 340; compacta em 88; expandida entre 240 e 400", () => {
    expect(BARRA_PADRAO).toEqual(B(340));
    expect(pxDaBarra(BARRA_PADRAO)).toBe(340);
    expect(pxDaBarra(B(300, true))).toBe(88);
    expect(limitar(100)).toBe(240);
    expect(limitar(999)).toBe(400);
    expect(limitar(287.6)).toBe(288);
    expect(limitar(Number.NaN)).toBe(340);
  });

  it("o máximo pela janela: min(400, janela − 424 − painel), nunca menos de 240", () => {
    expect(maximo(1440)).toBe(400);
    expect(maximo(1440, 360)).toBe(400);
    expect(maximo(1100, 360)).toBe(316);
    expect(maximo(800)).toBe(376);
    expect(maximo(600)).toBe(240);
    expect(limitar(400, 1100, 360)).toBe(316);
    // A janela encolhe: a tela mostra o limite, a guardada não muda.
    expect(pxDaBarra(B(400), 800)).toBe(376);
    expect(serializar(B(400))).toEqual({ larguraExpandida: 400, compacta: false });
  });
});

describe("ADR-179: o arrasto do puxador", () => {
  it("1:1 e parado no máximo, sem elástico", () => {
    expect(arrasto(301, B(340), B(340))).toEqual(B(301));
    expect(arrasto(520, B(340), B(340))).toEqual(B(400));
    expect(arrasto(520, B(340), B(340), 1100, 360)).toEqual(B(316));
    expect(arrasto(220, B(340), B(340))).toEqual(B(240));
  });

  it("abaixo de 208 recolhe para 88 e guarda a largura do início", () => {
    expect(arrasto(208, B(340), B(240))).toEqual(B(240));
    expect(arrasto(207, B(340), B(240))).toEqual(B(340, true));
    expect(pxDaBarra(arrasto(150, B(300), B(300)))).toBe(88);
  });

  it("a compacta reabre a partir de 216, em 240, e segue o ponteiro", () => {
    const c = B(340, true);
    expect(arrasto(212, c, c)).toEqual(c);
    expect(arrasto(215, c, c)).toEqual(c);
    expect(arrasto(216, c, c)).toEqual(B(240));
    expect(arrasto(230, c, c)).toEqual(B(240));
    expect(arrasto(260, c, B(240))).toEqual(B(260));
    // Recolhida no meio do arrasto: entre 208 e 216 continua compacta (a histerese).
    expect(arrasto(210, B(340), B(340, true))).toEqual(B(340, true));
  });
});

describe("ADR-179: teclas e ⌘B", () => {
  it("← → mudam 16 px, parados nas pontas; outras teclas não são do puxador", () => {
    expect(barraPelaTecla(B(340), "ArrowLeft")).toEqual(B(324));
    expect(barraPelaTecla(B(340), "ArrowRight")).toEqual(B(356));
    expect(barraPelaTecla(B(250), "ArrowLeft")).toEqual(B(240));
    expect(barraPelaTecla(B(392), "ArrowRight")).toEqual(B(400));
    expect(barraPelaTecla(B(316), "ArrowRight", 1100, 360)).toEqual(B(316));
    expect(barraPelaTecla(B(340, true), "ArrowLeft")).toEqual(B(340, true));
    expect(barraPelaTecla(B(340, true), "ArrowRight")).toEqual(B(240));
    expect(barraPelaTecla(B(340), "Home")).toBeNull();
    expect(barraPelaTecla(B(340), "Enter")).toBeNull();
  });

  it("⌘B alterna a compacta e volta à última largura expandida (340 → 88 → 340)", () => {
    const c = alternarCompacta(B(340));
    expect(pxDaBarra(c)).toBe(88);
    expect(alternarCompacta(c)).toEqual(B(340));
    expect(alternarCompacta(alternarCompacta(B(287)))).toEqual(B(287));
  });
});

describe("ADR-179: o card do chat", () => {
  it("só avatares = compacta; compacta = 240; normal = a última largura expandida", () => {
    expect(pedidoDoChat(B(320), "so_avatares")).toEqual(B(320, true));
    expect(pedidoDoChat(B(320, true), "compacta")).toEqual(B(240));
    expect(pedidoDoChat(B(320, true), "normal")).toEqual(B(320));
    expect(iguais(pedidoDoChat(B(320), "normal"), B(320))).toBe(true);
    expect(rotuloDaLargura(B(320, true))).toBe("Só avatares");
    expect(rotuloDaLargura(B(240))).toBe("Compacta, 240 px");
    expect(rotuloDaLargura(B(320))).toBe("320 px");
  });
});

describe("ADR-179: a memória e a migração", () => {
  it("serializa {larguraExpandida, compacta}; o valor estranho volta ao padrão", () => {
    expect(desserializar(JSON.stringify(serializar(B(288, true))))).toEqual(B(288, true));
    expect(desserializar('{"larguraExpandida":999,"compacta":false}')).toEqual(B(400));
    for (const v of ["", "x", "{", "null", "[]", '{"larguraExpandida":"300","compacta":false}', '{"larguraExpandida":300}', "__proto__", null, undefined]) {
      expect(desserializar(v)).toEqual(BARRA_PADRAO);
    }
  });

  it("a chave antiga migra uma vez: recolhidas → compacta (340); compacta → 240; o resto → 340", () => {
    expect(migrarAntiga("compacta:recolhida")).toEqual(B(340, true));
    expect(migrarAntiga("confortavel:recolhida")).toEqual(B(340, true));
    expect(migrarAntiga("compacta")).toEqual(B(240));
    expect(migrarAntiga("compacta:larga")).toEqual(B(340));
    for (const v of ["x", "__proto__", "constructor", null]) expect(migrarAntiga(v)).toEqual(B(340));
    const a = armazem({ [CHAVE_DENSIDADE_ANTIGA]: "compacta" });
    expect(lerBarra(a)).toEqual(B(240));
    expect(a.m.has(CHAVE_DENSIDADE_ANTIGA)).toBe(false);
    expect(JSON.parse(a.m.get(CHAVE_BARRA)!)).toEqual({ larguraExpandida: 240, compacta: false });
    // A chave nova vence a antiga.
    expect(lerBarra(armazem({ [CHAVE_BARRA]: '{"larguraExpandida":300,"compacta":true}', [CHAVE_DENSIDADE_ANTIGA]: "compacta" }))).toEqual(B(300, true));
    expect(lerBarra(armazem())).toEqual(BARRA_PADRAO);
    expect(lerBarra({ getItem: () => { throw new Error("bloqueado"); } })).toEqual(BARRA_PADRAO);
  });

  it("aplicarBarra grava a chave nova, apaga a antiga e manda para fora", () => {
    const a = armazem({ [CHAVE_DENSIDADE_ANTIGA]: "compacta" });
    const fora: unknown[] = [];
    aplicarBarra(B(300, true), raiz(), false, a, (v) => fora.push(v));
    expect(JSON.parse(a.m.get(CHAVE_BARRA)!)).toEqual({ larguraExpandida: 300, compacta: true });
    expect(a.m.has(CHAVE_DENSIDADE_ANTIGA)).toBe(false);
    expect(fora).toEqual([{ larguraExpandida: 300, compacta: true }]);
  });
});

describe("ADR-179: pintarBarra", () => {
  it("o computador leva data-barra e --largura-barra; a compacta, data-largura=recolhida; o celular, nada", () => {
    const r = raiz();
    pintarBarra(B(300), r, false);
    expect(r.dataset).toEqual({ barra: "expandida" });
    expect(r.props.get("--largura-barra")).toBe("300px");
    pintarBarra(B(300), r, false, false, 1000, 360);
    expect(r.props.get("--largura-barra")).toBe("240px");
    pintarBarra(B(300, true), r, false);
    expect(r.dataset).toEqual({ barra: "compacta", largura: "recolhida" });
    expect(r.props.get("--largura-barra")).toBe("88px");
    pintarBarra(B(300, true), r, false, true);
    expect(r.dataset).toEqual({ barra: "compacta", sobreposta: "300" });
    expect(r.props.get("--largura-sobreposta")).toBe("300px");
    pintarBarra(B(300, true), r, true, true);
    expect(r.dataset).toEqual({});
    expect([...r.props]).toEqual([]);
  });
});

describe("ADR-179: o script do index.html pinta igual a pintarBarra antes do primeiro quadro", () => {
  const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
  const script = /<script>(try \{ var s = localStorage\.getItem\("nod\.barra\.largura"\)[\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const rodar = (guardado: Record<string, string>, celular: boolean, janela: number) => {
    const r = raiz();
    const consultas: string[] = [];
    const fn = new Function("localStorage", "matchMedia", "document", "innerWidth", script);
    fn({ getItem: (k: string) => guardado[k] ?? null }, (q: string) => { consultas.push(q); return { matches: celular }; }, { documentElement: r }, janela);
    return { r, consultas };
  };

  it("usa as mesmas chaves e a mesma consulta do celular", () => {
    expect(script).toContain(`"${CHAVE_BARRA}"`);
    expect(script).toContain(`"${CHAVE_DENSIDADE_ANTIGA}"`);
    expect(rodar({}, false, 1440).consultas).toEqual([CONSULTA_CELULAR]);
  });

  const casos: Record<string, string>[] = [
    {},
    { [CHAVE_BARRA]: '{"larguraExpandida":300,"compacta":false}' },
    { [CHAVE_BARRA]: '{"larguraExpandida":388,"compacta":true}' },
    { [CHAVE_BARRA]: '{"larguraExpandida":9999,"compacta":false}' },
    { [CHAVE_BARRA]: '{"larguraExpandida":287.4,"compacta":false}' },
    { [CHAVE_BARRA]: "lixo" },
    { [CHAVE_BARRA]: "null" },
    { [CHAVE_BARRA]: '{"larguraExpandida":300}' },
    ...["compacta", "compacta:recolhida", "compacta:larga", "confortavel:recolhida", "x", "__proto__", "constructor"].map((v) => ({ [CHAVE_DENSIDADE_ANTIGA]: v })),
    { [CHAVE_BARRA]: '{"larguraExpandida":260,"compacta":false}', [CHAVE_DENSIDADE_ANTIGA]: "compacta:recolhida" },
  ];
  it.each(casos.map((c) => [JSON.stringify(c), c] as const))("guardado %s: mesmos atributos que pintarBarra", (_nome, guardado) => {
    for (const celular of [false, true]) {
      for (const janela of [1440, 1000, 700]) {
        const { r } = rodar(guardado, celular, janela);
        const esperado = raiz();
        pintarBarra(lerBarra(armazem(guardado)), esperado, celular, false, janela, 0);
        expect(r.dataset).toEqual(esperado.dataset);
        expect([...r.props]).toEqual([...esperado.props]);
      }
    }
  });
});
