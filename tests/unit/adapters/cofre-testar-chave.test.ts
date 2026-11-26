import { describe, expect, it } from "vitest";
import { criarTestarChave } from "../../../src/adapters/cofre/testar-chave.ts";
import { appDoCofre, nomeDeVariavelDoCofre, tituloDoPedidoDeChave } from "../../../src/domain/apps-do-cofre.ts";

/** ADR-195 (Entrega 3): o teste da chave de um app conhecido e o catálogo do Cofre. */
describe("testar a chave no app (Paper C3, O2 e O3)", () => {
  const chamadas: { url: string; auth: string | undefined }[] = [];
  const comStatus = (status: number | "erro") => criarTestarChave({
    fetchImpl: async (url, init) => {
      chamadas.push({ url, auth: init.headers.authorization });
      if (status === "erro") throw new Error("sem rede");
      return { status, body: { cancel: async () => undefined } };
    },
  });

  it("2xx aceita, 401/403 recusa, o resto (e sem rede) é indisponível; a chave vai só no cabeçalho da Orgo", async () => {
    expect(await comStatus(200)("orgo", "sk_teste")).toBe("aceita");
    expect(await comStatus(401)("orgo", "sk_teste")).toBe("recusada");
    expect(await comStatus(403)("orgo", "sk_teste")).toBe("recusada");
    for (const s of [404, 429, 500, 503] as const) expect(await comStatus(s)("orgo", "sk_teste")).toBe("indisponivel");
    expect(await comStatus("erro")("orgo", "sk_teste")).toBe("indisponivel");
    expect(chamadas[0]).toEqual({ url: "https://www.orgo.ai/api/workspaces", auth: "Bearer sk_teste" });
    expect(chamadas.every((c) => !c.url.includes("sk_teste"))).toBe(true);
  });

  it("o prazo vence: indisponível (o cartão mostra Tentar de novo)", async () => {
    const lento = criarTestarChave({ prazoMs: 5, fetchImpl: (_u, init) => new Promise((_ok, falha) => init.signal.addEventListener("abort", () => falha(new Error("abortado")))) });
    expect(await lento("orgo", "sk_teste")).toBe("indisponivel");
  });
});

describe("catálogo do Cofre", () => {
  it("o nome da variável é maiúsculo, de ambiente e nunca de sistema", () => {
    for (const ok of ["ORGO_API_KEY", "X", "_TOKEN", "A1_B2"]) expect(nomeDeVariavelDoCofre(ok)).toBe(true);
    for (const nao of ["orgo_api_key", "1ABC", "COM-HIFEN", "PATH", "NODE_OPTIONS", "LD_PRELOAD", "NOD_X", "", "A".repeat(129)]) expect(nomeDeVariavelDoCofre(nao)).toBe(false);
  });

  it("só apps do catálogo; o título segue o artigo do app", () => {
    expect(appDoCofre("orgo")?.variavel).toBe("ORGO_API_KEY");
    expect(appDoCofre("toString")).toBeNull();
    expect(appDoCofre(undefined)).toBeNull();
    expect(tituloDoPedidoDeChave({ alvo: "app", app: "Orgo", appId: "orgo" })).toBe("Chave da Orgo");
    expect(tituloDoPedidoDeChave({ alvo: "conector", app: "Exemplo" })).toBe("Chave para Exemplo");
    expect(tituloDoPedidoDeChave({ alvo: "github_token", app: "GitHub" })).toBe("Token do GitHub");
  });
});
