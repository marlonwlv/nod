import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { criarLoja } from "../../../../web/react/loja.ts";
import { igualRaso, useLoja } from "../../../../web/react/use-loja.ts";

/** ADR-179: a loja do reducer chega ao React por useSyncExternalStore; só o pedaço selecionado redesenha. */
type E = { contador: number; outro: number; nomes: string[] };

function montarLoja(inicial: E) {
  let estado = inicial;
  const loja = criarLoja(() => estado);
  // O mesmo caminho do main.ts: trocar o objeto (reduzir) e avisar.
  const trocar = (mudar: (e: E) => E) => act(() => { estado = mudar(estado); loja.avisar(); });
  return { loja, trocar };
}

describe("criarLoja", () => {
  it("só avisa quando o objeto do estado muda", () => {
    let estado = { n: 1 };
    const loja = criarLoja(() => estado);
    let avisos = 0;
    const cancelar = loja.assinar(() => avisos++);
    loja.avisar();
    expect(avisos).toBe(0);
    estado = { n: 2 };
    loja.avisar();
    expect(avisos).toBe(1);
    cancelar();
    estado = { n: 3 };
    loja.avisar();
    expect(avisos).toBe(1);
  });
});

describe("useLoja", () => {
  it("lê o pedaço do estado e acompanha a mudança", () => {
    const { loja, trocar } = montarLoja({ contador: 1, outro: 0, nomes: [] });
    function Contador() {
      return <span>contador {useLoja(loja, (e) => e.contador)}</span>;
    }
    render(<Contador />);
    expect(screen.getByText("contador 1")).toBeTruthy();
    trocar((e) => ({ ...e, contador: 2 }));
    expect(screen.getByText("contador 2")).toBeTruthy();
  });

  it("não redesenha quando muda só o que o seletor não lê", () => {
    const { loja, trocar } = montarLoja({ contador: 1, outro: 0, nomes: [] });
    let desenhos = 0;
    function Contador() {
      desenhos++;
      return <span>{useLoja(loja, (e) => e.contador)}</span>;
    }
    render(<Contador />);
    const inicial = desenhos;
    trocar((e) => ({ ...e, outro: e.outro + 1 }));
    trocar((e) => ({ ...e, outro: e.outro + 1 }));
    expect(desenhos).toBe(inicial);
    trocar((e) => ({ ...e, contador: 5 }));
    expect(desenhos).toBe(inicial + 1);
  });

  it("seletor que monta objeto novo, com igualRaso, não redesenha nem entra em laço", () => {
    const { loja, trocar } = montarLoja({ contador: 1, outro: 0, nomes: ["a"] });
    let desenhos = 0;
    function Par() {
      desenhos++;
      const { contador, nomes } = useLoja(loja, (e) => ({ contador: e.contador, nomes: e.nomes }), igualRaso);
      return <span>{`${contador}:${nomes.join(",")}`}</span>;
    }
    render(<Par />);
    const inicial = desenhos;
    trocar((e) => ({ ...e, outro: 9 }));
    expect(desenhos).toBe(inicial);
    trocar((e) => ({ ...e, nomes: [...e.nomes, "b"] }));
    expect(screen.getByText("1:a,b")).toBeTruthy();
    expect(desenhos).toBe(inicial + 1);
  });
});

describe("igualRaso", () => {
  it("compara as chaves do primeiro nível por Object.is", () => {
    const lista = [1];
    expect(igualRaso({ a: 1, b: lista }, { a: 1, b: lista })).toBe(true);
    expect(igualRaso({ a: 1, b: [1] }, { a: 1, b: [1] })).toBe(false);
    expect(igualRaso({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(igualRaso(null, null)).toBe(true);
  });
});
