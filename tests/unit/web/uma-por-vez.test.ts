import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { umaPorVez } from "../../../web/lib/uma-por-vez.ts";

const pendente = () => {
  let concluir!: () => void;
  let falhar!: (erro: Error) => void;
  const promessa = new Promise<void>((ok, erro) => { concluir = ok; falhar = erro; });
  return { promessa, concluir, falhar };
};

describe("umaPorVez", () => {
  it("protege a emissão manual de chave na interface", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/const emitirChavePelaTela = umaPorVez\([\s\S]{0,500}api!\.emitirChave/);
    expect(main).toContain('"emitir-chave": async (form) => { await emitirChavePelaTela(form); }');
  });

  it("ignora o segundo envio enquanto o primeiro está pendente", async () => {
    const primeira = pendente();
    const executar = vi.fn(async (_nome: string) => primeira.promessa);
    const protegida = umaPorVez(executar);

    const a = protegida("primeira");
    await expect(protegida("segunda")).resolves.toBe(false);
    expect(executar).toHaveBeenCalledTimes(1);

    primeira.concluir();
    await expect(a).resolves.toBe(true);
    await expect(protegida("terceira")).resolves.toBe(true);
    expect(executar).toHaveBeenLastCalledWith("terceira");
  });

  it("libera uma nova tentativa depois de falha", async () => {
    const primeira = pendente();
    const executar = vi.fn(async () => primeira.promessa);
    const protegida = umaPorVez(executar);

    const a = protegida();
    primeira.falhar(new Error("rede"));
    await expect(a).rejects.toThrow("rede");
    executar.mockResolvedValueOnce(undefined);
    await expect(protegida()).resolves.toBe(true);
    expect(executar).toHaveBeenCalledTimes(2);
  });
});
