import { describe, expect, it, vi } from "vitest";
import { decidirContraEstadoVelho } from "../../../web/lib/decidir-contra-estado-velho.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";

describe("decidir contra um cartão com estado velho", () => {
  it("absorve o 409 somente quando a releitura confirma que a decisão fechou", async () => {
    const erro = new ErroApi(409, "estado_invalido", "Isso não pode ser feito agora.");
    const reler = vi.fn(async () => true);

    await expect(decidirContraEstadoVelho(async () => { throw erro; }, reler)).resolves.toBe("reconciliada");
    expect(reler).toHaveBeenCalledOnce();
  });

  it("mantém o erro quando a decisão segue aberta ou a falha não é o conflito esperado", async () => {
    const conflito = new ErroApi(409, "estado_invalido", "Isso não pode ser feito agora.");
    await expect(decidirContraEstadoVelho(async () => { throw conflito; }, async () => false)).rejects.toBe(conflito);

    const rede = new ErroApi(0, "servidor_indisponivel", "Servidor fora.");
    const reler = vi.fn(async () => true);
    await expect(decidirContraEstadoVelho(async () => { throw rede; }, reler)).rejects.toBe(rede);
    expect(reler).not.toHaveBeenCalled();
  });
});
