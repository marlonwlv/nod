import { describe, expect, it } from "vitest";
import { criarChromeDesteMac, ESTE_MAC } from "../../../src/adapters/navegador/chrome-deste-mac.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/** 2026-11-23: o "Mac da pessoa" do servidor de desenvolvimento — só o Chrome deste Mac, sem cofres nem Touch ID. */
describe("o Chrome deste Mac (só no desenvolvimento)", () => {
  it("sempre ligado como Mac; os cookies voltam para o portão aplicar; cofres e Touch ID ficam de fora", async () => {
    const pedidos: string[] = [];
    const mac = criarChromeDesteMac({ home: "/Users/x", ler: async (host) => { pedidos.push(host); return [{ name: "li_at", value: "v", domain: ".linkedin.com", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }]; } });
    expect(mac.maquina(MARLON)).toBe(ESTE_MAC);
    expect(mac.aparelho?.(MARLON)).toBe("mac");
    expect(await mac.listar(MARLON, "a", "linkedin.com")).toEqual([]);
    expect(await mac.cookies(MARLON, "a", "www.linkedin.com", false)).toHaveLength(1);
    expect(pedidos).toEqual(["www.linkedin.com"]);
    expect(await mac.cookies(MARLON, "a", "www.linkedin.com", true)).toBe(0);
    await expect(mac.ler(MARLON, "a", "1password", "", "x.com")).rejects.toMatchObject({ motivo: "indisponivel" });
    expect(await mac.touchId(MARLON, "a", "pagar")).toBe("sem_mac");
  });
});
