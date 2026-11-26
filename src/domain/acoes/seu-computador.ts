import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * O computador da pessoa (ADR-197; NOD-391, ADR-135). As rotas são da dona (src/adapters/http/rotas/seu-computador.ts).
 *
 * definido em 2026-11-26: liberar um app é sempre pelo cartão que o próprio bot pede (o `sempre`/desta vez de uma
 * aprovação). Tirar um app ou todos ainda não têm ferramenta no chat (a pessoa tira em Ajustes › Seu Mac); Parar é o
 * botão da ilha no próprio computador e a parada da conversa, que já existe.
 */
const falta = { estado: "falta", onda: "NOD-396" } as const;

export const ACOES_SEU_COMPUTADOR = [
  {
    id: "seu_computador.tirar_app",
    titulo: "Tirar um app (ou todos) do que um bot pode usar no Mac ou PC da pessoa",
    schema: { type: "object", properties: { agenteId: { type: "string", maxLength: 36 }, appId: { type: "string", maxLength: 400 } }, required: [], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: false,
    chat: falta,
  },
] as const satisfies readonly DefinicaoAcao[];
