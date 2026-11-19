import { describe, expect, it, vi } from "vitest";
import worker, { destinoCanonico } from "../../../site/worker.ts";

describe("site: domínio canônico", () => {
  it("leva www para https://nodbot.ai preservando caminho e query", async () => {
    expect(destinoCanonico("https://www.nodbot.ai/a/b?x=1#trecho")?.href).toBe("https://nodbot.ai/a/b?x=1#trecho");

    const assets = { fetch: vi.fn<() => Promise<Response>>() };
    const resposta = await worker.fetch(new Request("http://www.nodbot.ai/a/b?x=1"), { ASSETS: assets });
    expect(resposta.status).toBe(301);
    expect(resposta.headers.get("location")).toBe("https://nodbot.ai/a/b?x=1");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("mantém nodbot.ai e entrega a requisição aos assets", async () => {
    const esperado = new Response("ok");
    const assets = { fetch: vi.fn().mockResolvedValue(esperado) };
    const request = new Request("https://nodbot.ai/termos");

    expect(destinoCanonico(request.url)).toBeNull();
    await expect(worker.fetch(request, { ASSETS: assets })).resolves.toBe(esperado);
    expect(assets.fetch).toHaveBeenCalledWith(request);
  });
});
