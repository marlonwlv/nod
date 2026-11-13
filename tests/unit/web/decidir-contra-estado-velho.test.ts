import { readFileSync } from "node:fs";
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

  it("não absorve estado_invalido fora do 409", async () => {
    const erro = new ErroApi(400, "estado_invalido", "O pedido está inválido.");
    const reler = vi.fn(async () => true);

    await expect(decidirContraEstadoVelho(async () => { throw erro; }, reler)).rejects.toBe(erro);
    expect(reler).not.toHaveBeenCalled();
  });

  it("mantém o 409 com motivo de negócio mesmo quando o servidor fechou o cartão", async () => {
    const conflito = new ErroApi(409, "estado_invalido", "Este pedido mudou.");
    conflito.motivo = "limite_atingido";
    const reler = vi.fn(async () => true);

    await expect(decidirContraEstadoVelho(async () => { throw conflito; }, reler)).rejects.toBe(conflito);
    expect(reler).not.toHaveBeenCalled();
  });

  it("todo gesto da web que chama decidir passa pela reconciliação", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main.match(/api!?\.decidir\(/g)).toHaveLength(1);
    expect(main).toContain("() => api!.decidir(id, corpo)");
  });
});
