import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasContasIa, type DepsRotasContas } from "../../../src/adapters/http/rotas/contas-ia.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../../helpers/servidor-de-teste.ts";

/**
 * QA-198 (r197): os botões do cartão do desvio. A resposta vem no topo ({ turnoId, motivo }) — a web lia `data.motivo`,
 * que não existe, e marcava o cartão como feito quando nada foi refeito. E o "Reinstalar e tentar" que não refez a fala
 * (2º clique, turno já refeito) não pede outra reinstalação à máquina.
 */
const CONVERSA = "11111111-1111-4111-8111-111111111111";
const TURNO = "22222222-2222-4222-8222-222222222222";
const MAQUINA = "33333333-3333-4333-8333-333333333333";

describe("QA-198: rotas do cartão do desvio", () => {
  let srv: ServidorDeTeste;
  let resultado: { turnoId: string | null; motivo: string | null } = { turnoId: null, motivo: "ja_refeito" };
  const pedidos: string[] = [];
  const deps: DepsRotasContas = {
    // 1ª transação: a máquina (exigirMaquina); a do caso de uso devolve o resultado do teste.
    dentro: (async (_e: unknown, fn: (d: unknown) => Promise<unknown>) => {
      const txt = fn.toString();
      if (txt.includes("exigirMaquina")) return { id: MAQUINA, nome: "MacBook" };
      return resultado;
    }) as never,
    logins: { pedirAtualizacao: (_e: unknown, _m: string, ia: string) => void pedidos.push(ia) } as never,
    dispositivo: {} as never,
    compartilhado: true,
    avisar: () => undefined,
    maquinaViva: () => true,
    maquinaAtualizaIas: () => true,
    prontosDaPessoa: () => ["codex-cli"],
  };
  beforeAll(async () => {
    srv = await servidorDeTeste(rotasContasIa(deps));
  });
  afterAll(() => srv.close());

  it("Reinstalar e tentar que não refez: motivo no topo e nenhuma reinstalação pedida", async () => {
    const s = await srv.entrar("marlon");
    resultado = { turnoId: null, motivo: "ja_refeito" };
    const r = await srv.chamar(s, "POST", `/conversas/${CONVERSA}/reinstalar-e-tentar`, { turnoId: TURNO, maquinaId: MAQUINA, ia: "claude-cli" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ turnoId: null, motivo: "ja_refeito" });
    expect(pedidos).toEqual([]);
    resultado = { turnoId: TURNO, motivo: null };
    await srv.chamar(s, "POST", `/conversas/${CONVERSA}/reinstalar-e-tentar`, { turnoId: TURNO, maquinaId: MAQUINA, ia: "claude-cli" });
    expect(pedidos).toEqual(["claude-cli"]);
  });

  it("Responder com outra IA: motivo no topo, como a web lê", async () => {
    const s = await srv.entrar("marlon");
    resultado = { turnoId: null, motivo: "conta_fora_da_maquina" };
    const r = await srv.chamar(s, "POST", `/conversas/${CONVERSA}/responder-com-outra-ia`, { turnoId: TURNO, ia: "codex-cli" });
    expect(await r.json()).toEqual({ turnoId: null, motivo: "conta_fora_da_maquina" });
  });
});
