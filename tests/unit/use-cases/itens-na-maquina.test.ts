import { describe, expect, it, vi } from "vitest";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { concluirItemNaMaquina, PRAZO_ITEM_NA_MAQUINA_MS } from "../../../src/use-cases/itens-na-maquina.ts";

describe("item que roda na máquina", () => {
  it("recusa o relato que chega no limite de 24 h e deixa o varredor assentar a falha", async () => {
    const registrarDesfechoSeAberto = vi.fn();
    const deps = {
      agora: () => PRAZO_ITEM_NA_MAQUINA_MS,
      repos: {
        itensAprovacao: {
          pendentesNaMaquina: async () => [
            {
              item: { id: "item-1", decisaoId: "decisao-1", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {}, execucao: "maquina" } },
              decididaEm: 0,
              porRegra: false,
            },
          ],
          registrarDesfechoSeAberto,
        },
      },
    } as unknown as Deps;

    expect(await concluirItemNaMaquina(deps, { itemId: "item-1", desfecho: "executado" })).toEqual({ events: [] });
    expect(registrarDesfechoSeAberto).not.toHaveBeenCalled();
  });
});
