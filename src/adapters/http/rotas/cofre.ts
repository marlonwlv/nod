import { listarCofre } from "../../../use-cases/cofre.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/** GET /cofre (Paper 07, rodada 2): nome, app e data das credenciais guardadas — nunca o valor. Só leitura. */
export function criarRotasCofre(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [{ metodo: "GET", padrao: /^\/cofre$/, async handler(ctx) { ctx.json(200, await executar(ctx.escopo, listarCofre, {})); } }];
}
