import { canalDasFlags } from "../../../domain/flags-remotas.ts";
import type { FonteDeFlags } from "../../flags/fonte-flags.ts";
import type { Rota } from "../roteador.ts";

/**
 * ADR-168 (definido em 2026-11-12): `GET /api/t/:t/flags` — as flags remotas desta pessoa, já avaliadas no servidor (a
 * web e o app nunca veem as regras, nem quem mais está num teste). Só leitura; `no-store` para a troca valer no próximo
 * pedido.
 */
export function rotasFlags(o: { fonte: FonteDeFlags }): Rota[] {
  return [{
    metodo: "GET",
    padrao: /^\/flags$/,
    async handler(ctx) {
      ctx.res.setHeader("cache-control", "no-store");
      const flags = o.fonte.avaliar(ctx.escopo);
      ctx.json(200, { flags, canal: canalDasFlags(flags) });
    },
  }];
}
