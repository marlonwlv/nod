import { createServer, request, type IncomingMessage } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GZIP_A_PARTIR_DE, json } from "../../../src/adapters/http/util.ts";

/** Instantâneo (2026-11-13): a resposta JSON grande vai em gzip só quando o cliente aceita; a pequena, nunca. */
describe("json() com gzip", () => {
  const grande = { falas: Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, texto: "uma fala com algum texto repetido ".repeat(4) })) };
  const pequeno = { ok: true };
  const servidor = createServer((req, res) => json(res, 200, req.url === "/pequeno" ? pequeno : grande));
  let porta = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    const e = servidor.address();
    porta = typeof e === "object" && e ? e.port : 0;
  });
  afterAll(async () => { await new Promise<void>((r) => servidor.close(() => r())); });

  async function pedir(caminho: string, aceita: string | null): Promise<{ res: IncomingMessage; corpo: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: porta, path: caminho, headers: aceita ? { "accept-encoding": aceita } : {} }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => resolve({ res, corpo: Buffer.concat(partes) }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("comprime a resposta grande quando o cliente aceita gzip, e o corpo é o mesmo JSON", async () => {
    const { res, corpo } = await pedir("/grande", "gzip, deflate, br");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["vary"]).toBe("accept-encoding");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(gunzipSync(corpo).toString("utf8"))).toEqual(grande);
    expect(corpo.length).toBeLessThan(Buffer.byteLength(JSON.stringify(grande)) / 4);
  });

  it("sem accept-encoding (ou sem gzip nele) vai cru", async () => {
    for (const aceita of [null, "br", "identity"]) {
      const { res, corpo } = await pedir("/grande", aceita);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(JSON.parse(corpo.toString("utf8"))).toEqual(grande);
    }
  });

  it("a resposta pequena vai crua mesmo com gzip aceito", async () => {
    expect(Buffer.byteLength(JSON.stringify(pequeno))).toBeLessThan(GZIP_A_PARTIR_DE);
    const { res, corpo } = await pedir("/pequeno", "gzip");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(corpo.toString("utf8"))).toEqual(pequeno);
  });
});
