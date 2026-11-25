import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  chaveMestraKms,
  chaveMestraLocal,
  escolherChaveMestra,
  MARGEM_TOKEN_MS,
  recusasDoCofre,
  REF_MESTRA_LOCAL,
  tokenDoMetadata,
  URL_KMS,
  URL_METADATA_TOKEN,
} from "../../../src/adapters/cofre/chave-mestra.ts";
import { FalhaDoCofre, gerarChave } from "../../../src/db/cifra-envelope.ts";

/** ADR-195 §2: os dois provedores da chave mestra. Nenhum valor real: chave, projeto e token são de exemplo. */
const CREDENCIAL = "ab".repeat(32);
const NOME = "projects/projeto-exemplo/locations/southamerica-east1/keyRings/nod/cryptoKeys/cofre";
const AAD = "nod-cofre-v2-tenant|00000000-0000-4000-8000-000000000001|1";

async function falhaCom(p: Promise<unknown>): Promise<FalhaDoCofre> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(FalhaDoCofre);
    return e as FalhaDoCofre;
  }
  throw new Error("não falhou");
}

/**
 * Um KMS de mentira: guarda o que cifrou por um id e devolve só se a AAD for a mesma. Responde como o Cloud KMS
 * (ciphertext/name no encrypt, plaintext no decrypt, tudo em base64) e conta as chamadas.
 */
function kmsFalso(o: { versao?: number } = {}) {
  const guardado = new Map<string, { claro: string; aad: string }>();
  const chamadas: { url: string; corpo: Record<string, string> | null; autorizacao: string | null }[] = [];
  let tokens = 0;
  let falharCom: number | "rede" | null = null;
  let corpoErro = "";
  const fetchImpl: typeof fetch = async (entrada, init) => {
    const url = String(entrada);
    const headers = new Headers(init?.headers);
    if (url === URL_METADATA_TOKEN) {
      expect(headers.get("Metadata-Flavor")).toBe("Google");
      tokens++;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 3600, token_type: "Bearer" });
    }
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : null;
    chamadas.push({ url, corpo, autorizacao: headers.get("authorization") });
    if (falharCom === "rede") throw new TypeError("fetch failed: getaddrinfo cloudkms.googleapis.com");
    if (falharCom !== null) return new Response(corpoErro, { status: falharCom });
    if (url === `${URL_KMS}/${NOME}:encrypt`) {
      const id = randomBytes(24).toString("base64");
      guardado.set(id, { claro: corpo!.plaintext!, aad: corpo!.additionalAuthenticatedData! });
      return Response.json({ name: `${NOME}/cryptoKeyVersions/${o.versao ?? 1}`, ciphertext: id });
    }
    if (url === `${URL_KMS}/${NOME}:decrypt`) {
      const g = guardado.get(corpo!.ciphertext!);
      if (!g || g.aad !== corpo!.additionalAuthenticatedData) return Response.json({ error: { code: 400, message: "Decryption failed" } }, { status: 400 });
      return Response.json({ plaintext: g.claro });
    }
    return new Response("", { status: 404 });
  };
  return {
    fetchImpl,
    chamadas,
    tokens: () => tokens,
    falhar(status: number | "rede" | null, corpo = "") {
      falharCom = status;
      corpoErro = corpo;
    },
  };
}

describe("chave mestra local (HKDF da NOD_CREDENTIAL_KEY)", () => {
  it("embrulha e desembrulha com a AAD; mestraRef local:v1; AAD trocada falha", async () => {
    const m = chaveMestraLocal(CREDENCIAL);
    const chave = gerarChave();
    const { embrulhada, mestraRef } = await m.embrulhar(chave, AAD);
    expect(mestraRef).toBe(REF_MESTRA_LOCAL);
    expect(embrulhada).toMatch(/^v2:1:/);
    expect((await m.desembrulhar(embrulhada, AAD)).equals(chave)).toBe(true);
    expect((await falhaCom(m.desembrulhar(embrulhada, AAD.replace("|1", "|2")))).motivo).toBe("cifra_invalida");
  });

  it("outra NOD_CREDENTIAL_KEY não abre; a mesma (outro processo) abre; sem chave é config_invalida", async () => {
    const { embrulhada } = await chaveMestraLocal(CREDENCIAL).embrulhar(gerarChave(), AAD);
    expect((await chaveMestraLocal(CREDENCIAL).desembrulhar(embrulhada, AAD)).length).toBe(32);
    expect((await falhaCom(chaveMestraLocal("cd".repeat(32)).desembrulhar(embrulhada, AAD))).motivo).toBe("cifra_invalida");
    expect(() => chaveMestraLocal("")).toThrow(FalhaDoCofre);
  });

  it("a KEK é derivada, não a NOD_CREDENTIAL_KEY crua: embrulhar com a credencial direto não abre", async () => {
    const { cifrarV2 } = await import("../../../src/db/cifra-envelope.ts");
    const direto = cifrarV2(gerarChave(), Buffer.from(CREDENCIAL, "hex"), AAD, 1);
    expect((await falhaCom(chaveMestraLocal(CREDENCIAL).desembrulhar(direto, AAD))).motivo).toBe("cifra_invalida");
  });
});

describe("chave mestra no Cloud KMS (REST, fetch injetado)", () => {
  it("encrypt e decrypt pela API com plaintext e AAD em base64; mestraRef é a versão que embrulhou", async () => {
    const k = kmsFalso({ versao: 7 });
    const m = chaveMestraKms({ nome: NOME, fetchImpl: k.fetchImpl });
    const chave = gerarChave();
    const { embrulhada, mestraRef } = await m.embrulhar(chave, AAD);
    expect(mestraRef).toBe(`${NOME}/cryptoKeyVersions/7`);
    expect(k.chamadas[0]).toMatchObject({
      url: `${URL_KMS}/${NOME}:encrypt`,
      corpo: { plaintext: chave.toString("base64"), additionalAuthenticatedData: Buffer.from(AAD).toString("base64") },
      autorizacao: "Bearer token-1",
    });
    expect((await m.desembrulhar(embrulhada, AAD)).equals(chave)).toBe(true);
    expect(k.chamadas[1]?.url).toBe(`${URL_KMS}/${NOME}:decrypt`);
    // A AAD errada: o KMS recusa (400) e vira falha fechada.
    expect((await falhaCom(m.desembrulhar(embrulhada, `${AAD}x`))).motivo).toBe("mestra_recusou");
  });

  it("o token do metadata fica em cache até perto de vencer, e um pedido em voo só", async () => {
    const k = kmsFalso();
    let agora = 1_000_000;
    const token = tokenDoMetadata({ fetchImpl: k.fetchImpl, agora: () => agora });
    const [a, b] = await Promise.all([token(), token()]);
    expect([a, b, k.tokens()]).toEqual(["token-1", "token-1", 1]);
    agora += 3600_000 - MARGEM_TOKEN_MS - 1;
    expect(await token()).toBe("token-1");
    agora += 2;
    expect(await token()).toBe("token-2");

    const m = chaveMestraKms({ nome: NOME, fetchImpl: k.fetchImpl, agora: () => agora });
    await m.embrulhar(gerarChave(), AAD);
    await m.embrulhar(gerarChave(), AAD);
    expect(k.tokens()).toBe(3);
  });

  it("erro HTTP e rede viram falha fechada tipada, sem o corpo da resposta nem a URL", async () => {
    const k = kmsFalso();
    const m = chaveMestraKms({ nome: NOME, fetchImpl: k.fetchImpl });
    const { embrulhada } = await m.embrulhar(gerarChave(), AAD);
    const casos: [number | "rede", string][] = [
      [403, "mestra_recusou"],
      [400, "mestra_recusou"],
      [429, "mestra_indisponivel"],
      [503, "mestra_indisponivel"],
      ["rede", "mestra_indisponivel"],
    ];
    for (const [status, motivo] of casos) {
      k.falhar(status, JSON.stringify({ error: { message: `Permission denied on ${NOME} for a conta de serviço do projeto-exemplo` } }));
      const f = await falhaCom(m.desembrulhar(embrulhada, AAD));
      expect(f.motivo).toBe(motivo);
      expect(f.status).toBe(status === "rede" ? null : status);
      const tudo = `${f.message} ${String(f.cause ?? "")}`;
      expect(tudo).not.toContain("Permission denied");
      expect(tudo).not.toContain("projeto-exemplo");
      expect(tudo).not.toContain("cloudkms");
    }
  });

  it("resposta fora do formato e prazo estourado falham fechado", async () => {
    const mal: typeof fetch = async (u) => (String(u) === URL_METADATA_TOKEN ? Response.json({ access_token: "t", expires_in: 60 }) : Response.json({ ciphertext: "x", name: "outra/chave" }));
    expect((await falhaCom(chaveMestraKms({ nome: NOME, fetchImpl: mal }).embrulhar(gerarChave(), AAD))).motivo).toBe("mestra_resposta_invalida");
    const curta: typeof fetch = async (u) => (String(u) === URL_METADATA_TOKEN ? Response.json({ access_token: "t", expires_in: 60 }) : Response.json({ plaintext: Buffer.alloc(8).toString("base64") }));
    expect((await falhaCom(chaveMestraKms({ nome: NOME, fetchImpl: curta }).desembrulhar("x", AAD))).motivo).toBe("mestra_resposta_invalida");
    // O prazo vale por chamada: um KMS que nunca responde vira mestra_indisponivel.
    const parado: typeof fetch = (u, init) =>
      String(u) === URL_METADATA_TOKEN
        ? Promise.resolve(Response.json({ access_token: "t", expires_in: 60 }))
        : new Promise((_, rejeitar) => init?.signal?.addEventListener("abort", () => rejeitar(init.signal?.reason)));
    expect((await falhaCom(chaveMestraKms({ nome: NOME, fetchImpl: parado, prazoMs: 20 }).desembrulhar("x", AAD))).motivo).toBe("mestra_indisponivel");
    // O metadata fora: o token falha fechado também.
    const semMetadata: typeof fetch = async () => new Response("", { status: 500 });
    expect((await falhaCom(chaveMestraKms({ nome: NOME, fetchImpl: semMetadata }).embrulhar(gerarChave(), AAD))).motivo).toBe("mestra_indisponivel");
  });

  it("nome da chave fora do formato é config_invalida na hora", () => {
    expect(() => chaveMestraKms({ nome: "cofre" })).toThrow(FalhaDoCofre);
    expect(() => chaveMestraKms({ nome: `${NOME}/cryptoKeyVersions/1` })).toThrow(FalhaDoCofre);
  });
});

describe("escolha do provedor e recusa de produção", () => {
  it("NOD_COFRE_KMS presente → kms; ausente → local", () => {
    expect(escolherChaveMestra({ NOD_COFRE_KMS: NOME }).tipo).toBe("kms");
    expect(escolherChaveMestra({ NOD_CREDENTIAL_KEY: CREDENCIAL }).tipo).toBe("local");
    expect(escolherChaveMestra({ NOD_COFRE_KMS: "  ", NOD_CREDENTIAL_KEY: CREDENCIAL }).tipo).toBe("local");
  });

  it("produção (NODE_ENV=production) sem NOD_COFRE_KMS é recusada; fora dela, não; nome torto é recusado sempre", () => {
    expect(recusasDoCofre({ NODE_ENV: "production" })).toHaveLength(1);
    expect(recusasDoCofre({ NODE_ENV: "production", NOD_COFRE_KMS: NOME })).toEqual([]);
    expect(recusasDoCofre({ NODE_ENV: "development" })).toEqual([]);
    expect(recusasDoCofre({})).toEqual([]);
    expect(recusasDoCofre({ NOD_COFRE_KMS: "cofre" })).toHaveLength(1);
  });
});
