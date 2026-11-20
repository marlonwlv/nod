// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderItens, type ItemAnexo } from "../../../web/lib/anexos.ts";
import { devolverFocoNaFila, lugarDoFocoNaFila } from "../../../web/lib/anexos-foco.ts";

/** QA-149: remover um anexo pelo teclado não deixa o foco cair no corpo da página. */
const item = (chave: string): ItemAnexo => ({ chave, nome: `${chave}.txt`, mime: "text/plain", tamanho: 10, estado: "pronto", progresso: 1 }) as ItemAnexo;

function montar(chaves: string[]): HTMLElement {
  document.body.innerHTML = '<div class="composer"><div id="composer-anexos"></div><textarea id="composer-texto"></textarea></div><button id="fora">x</button>';
  const fila = document.getElementById("composer-anexos")!;
  fila.innerHTML = renderItens(chaves.map(item));
  return fila;
}

function remover(fila: HTMLElement, chaves: string[], chave: string): string[] {
  const lugar = lugarDoFocoNaFila(chave);
  const resto = chaves.filter((c) => c !== chave);
  fila.innerHTML = renderItens(resto.map(item));
  devolverFocoNaFila(lugar);
  return resto;
}

describe("o foco depois de remover um anexo pelo teclado", () => {
  it("vai ao × que ficou no mesmo lugar, depois ao anterior e, sem anexo, ao texto do campo", () => {
    let chaves = ["a", "b", "c"];
    const fila = montar(chaves);
    fila.querySelector<HTMLElement>('.anexo-x[data-id="b"]')!.focus();
    chaves = remover(fila, chaves, "b");
    expect((document.activeElement as HTMLElement).dataset.id).toBe("c");
    chaves = remover(fila, chaves, "c");
    expect((document.activeElement as HTMLElement).dataset.id).toBe("a");
    remover(fila, chaves, "a");
    expect(document.activeElement?.id).toBe("composer-texto");
  });

  it("sem o foco no × removido, não mexe no foco", () => {
    const chaves = ["a", "b"];
    const fila = montar(chaves);
    document.getElementById("fora")!.focus();
    remover(fila, chaves, "a");
    expect(document.activeElement?.id).toBe("fora");
  });
});
