import { describe, expect, it } from "vitest";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { dispensarVencidos } from "../../../web/lib/limpar-vencidos.ts";

/** Um servidor de mentira com a regra de `podeDispensar`: o que já saiu responde 409 (estado_invalido). */
function servidor(jaSairam: readonly string[] = []) {
  const fora = new Set(jaSairam);
  const chamadas: string[] = [];
  const dispensar = async (id: string) => {
    chamadas.push(id);
    if (id === "sumiu") throw new ErroApi(404, "nao_encontrado", "Não encontramos o que você pediu.");
    if (fora.has(id)) throw new ErroApi(409, "estado_invalido", "Isso não pode ser feito agora. Atualize a página e tente de novo.");
    fora.add(id);
    return { ok: true };
  };
  return { dispensar, fora, chamadas };
}

describe("QA-166: Limpar vencidos não para no que já saiu", () => {
  it("o vencido já dispensado em outra aba (409) não deixa os seguintes na tela", async () => {
    const s = servidor(["b"]);
    const r = await dispensarVencidos(["a", "b", "c"], s.dispensar);
    expect(r).toEqual({ dispensados: ["a", "c"], jaTinhamSaido: ["b"] });
    expect([...s.fora].sort()).toEqual(["a", "b", "c"]);
  });

  it("o apagado (404) também segue", async () => {
    const s = servidor();
    expect((await dispensarVencidos(["sumiu", "x"], s.dispensar)).dispensados).toEqual(["x"]);
  });

  it("dois lotes ao mesmo tempo (duplo clique) terminam sem erro e com tudo dispensado", async () => {
    const s = servidor();
    const ids = ["a", "b", "c"];
    await expect(Promise.all([dispensarVencidos(ids, s.dispensar), dispensarVencidos(ids, s.dispensar)])).resolves.toHaveLength(2);
    expect([...s.fora].sort()).toEqual(ids);
  });

  it("id repetido no lote vai uma vez só", async () => {
    const s = servidor();
    await dispensarVencidos(["a", "a"], s.dispensar);
    expect(s.chamadas).toEqual(["a"]);
  });

  it("falha que não é 'já saiu' (rede) para o lote e sobe para o agir mostrar", async () => {
    const chamadas: string[] = [];
    const rede = async (id: string) => { chamadas.push(id); if (id === "b") throw new ErroApi(0, "servidor_indisponivel", "O servidor está reiniciando."); };
    await expect(dispensarVencidos(["a", "b", "c"], rede)).rejects.toMatchObject({ codigo: "servidor_indisponivel" });
    expect(chamadas).toEqual(["a", "b"]);
  });

  it("o laço antigo da main (for…await sem tratar o 409) parava no meio — a regressão", async () => {
    const s = servidor(["b"]);
    const antigo = async (ids: readonly string[]) => { for (const id of ids) await s.dispensar(id); };
    await expect(antigo(["a", "b", "c"])).rejects.toMatchObject({ status: 409 });
    expect(s.fora.has("c")).toBe(false);
  });
});
