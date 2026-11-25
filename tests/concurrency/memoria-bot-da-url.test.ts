import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";

/**
 * QA-125: `PATCH/DELETE /agentes/:id/memoria/:mid` ignoravam o `:id`. A memória do bot A era editada e apagada pela URL
 * do bot B (mesma dona), e um `:mid` fora de uuid chegava cru ao Postgres. Agora a memória precisa ser do bot da URL;
 * senão é "não encontrada", sem mudar nada.
 */
describeIntegracao("QA-125: editar e apagar memória só pelo bot dono dela", () => {
  let srv: ServidorCompleto;
  const agentes: string[] = [];
  const conversas: string[] = [];
  let a = "", b = "", mid = "";
  beforeAll(async () => {
    srv = await servidorCompleto();
    for (const nome of ["Bot A QA125", "Bot B QA125"]) {
      const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "x" });
      agentes.push(bot.agente.id); conversas.push(bot.conversa.id);
    }
    [a, b] = agentes as [string, string];
    const r = await srv.json<{ memoria: Memoria }>("POST", `agentes/${a}/memoria`, { tipo: "fato", texto: "o repo é o nod" });
    mid = r.memoria.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  });

  const memoriasDe = async (id: string) => (await srv.json<{ memorias: Memoria[] }>("GET", `agentes/${id}/memoria`)).memorias;

  it("PATCH pela URL de outro bot é 404 e não muda a memória", async () => {
    const r = await srv.chamar("PATCH", `agentes/${b}/memoria/${mid}`, { texto: "trocado pelo B" });
    expect(r.status).toBe(404);
    expect((await memoriasDe(a)).map((m) => m.texto)).toEqual(["o repo é o nod"]);
  });

  it("DELETE pela URL de outro bot é 404 e a memória continua no bot dela", async () => {
    const r = await srv.chamar("DELETE", `agentes/${b}/memoria/${mid}`);
    expect(r.status).toBe(404);
    expect(await memoriasDe(a)).toHaveLength(1);
  });

  it("id de memória fora de uuid é 404, não erro do banco", async () => {
    expect((await srv.chamar("PATCH", `agentes/${a}/memoria/nao-e-uuid`, { texto: "x" })).status).toBe(404);
    expect((await srv.chamar("DELETE", `agentes/${a}/memoria/nao-e-uuid`)).status).toBe(404);
  });

  it("pelo bot certo editar e apagar seguem funcionando", async () => {
    expect((await srv.chamar("PATCH", `agentes/${a}/memoria/${mid}`, { texto: "o repo é o nod (editado)" })).status).toBe(200);
    expect((await memoriasDe(a)).map((m) => m.texto)).toEqual(["o repo é o nod (editado)"]);
    expect((await srv.chamar("DELETE", `agentes/${a}/memoria/${mid}`)).status).toBe(200);
    expect(await memoriasDe(a)).toHaveLength(0);
  });
});
