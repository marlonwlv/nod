import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { classificarResultado, interpretarLinhaStreamJson } from "../../src/domain/stream-json.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const loginVencido = () => {
  const erro = "Invalid API key · Please run /login";
  const linhas = [
    { type: "system", subtype: "init", session_id: randomUUID(), tools: [], model: "m", claude_code_version: "v", apiKeySource: "none" },
    { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: erro }] } },
    { type: "result", subtype: "success", is_error: true, result: erro, session_id: randomUUID(), total_cost_usd: 0, usage: {}, num_turns: 1 },
  ].map((l) => interpretarLinhaStreamJson(JSON.stringify(l)));
  return classificarResultado({ eventos: linhas, exitCode: 1, signal: null, stderr: "" });
};

/**
 * QA r227 (lote B, desvios que esperam): a fala que JÁ esperou não espera de novo (adiarFala devolve null). Antes, o cartão
 * saía assim mesmo dizendo "Entre de novo e a mensagem sai em seguida", sem cópia nenhuma na fila: a pessoa entrava e
 * nada saía.
 */
describeIntegracao("desvio que espera, segunda vez (QA r227)", () => {
  it("a cópia que esperou e caiu no mesmo login vencido não promete sair sozinha sem nada na fila", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const t1 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await executar(deps, assentarTurno, { turnoId: t1, machineId: maquina, seqLocal: 1, harness: "claude-cli", fala: { tipo: "texto", texto: "" }, resultado: loginVencido() });
      const pendentes = async () => (await deps.repos.turnos.listarDaConversa(criado.conversa.id, 50)).filter((t) => t.estado === "pendente");
      // A 1ª vez segue igual: o cartão do desvio e a cópia que espera.
      expect((await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).some((m) => m.turnoId === t1 && m.payload?.kind === "desvio")).toBe(true);
      const [copia] = await pendentes();
      expect(copia?.acordarEm).toBeTypeOf("number");
      // As 2 h passam sem a pessoa entrar: a cópia acorda e cai no mesmo login vencido.
      await trx`update turnos set acordar_em = now() - interval '1 second' where id = ${copia!.id}`;
      const t2 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      expect(t2).toBe(copia!.id);
      await executar(deps, assentarTurno, { turnoId: t2, machineId: maquina, seqLocal: 1, harness: "claude-cli", fala: { tipo: "texto", texto: "" }, resultado: loginVencido() });
      expect(await pendentes()).toEqual([]);
      const doT2 = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === t2 && m.kind === "sistema");
      // Nada na fila: nenhuma mensagem do T2 pode dizer que a fala sai sozinha/em seguida.
      expect(doT2.length).toBeGreaterThan(0);
      expect(doT2.map((m) => m.texto).join("\n")).toContain("nada foi reenviado");
      for (const m of doT2) {
        expect(m.texto).not.toMatch(/sai em seguida|sai sozinha|fica guardada|sai assim que/);
        expect(m.payload && "espera" in m.payload ? m.payload.espera : undefined).toBeUndefined();
      }
    });
  });
});
