import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { reinstalarETentar, responderComOutraIa } from "../../src/use-cases/contas-ia.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** QA-198 (r197): "Reinstalar e tentar" e "Responder com outra IA" do cartão do desvio, repetidos (duas abas, recarregar). */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const pronto: Inventario = { estado: "pronto", versao: "teste", em: AGORA };
const MODELO: Record<"claude-cli" | "codex-cli", string> = { "claude-cli": "sonnet", "codex-cli": "gpt-6-astra" };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const rejeitada: ResultadoTurno = {
  desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", texto: "", sessaoCli: null, sinais: { ...SINAIS, rejected: true, promptSubmitted: false, producedOutput: false },
  custoUsd: null, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
};

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const enfileirar = (harness: "claude-cli" | "codex-cli", extra: Record<string, unknown> = {}) =>
    base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: MODELO[harness], harness, ...extra });
  const plano = async (turnoId: string, p: { machineId: string; ias: readonly IdHarness[]; ponte?: boolean; capacidades?: Parameters<typeof emitirPlanoTurno>[1]["capacidadesDaMaquina"] }) =>
    (await emitirPlanoTurno(deps, {
      turnoId, machineId: p.machineId, executor: "local", harnesses: Object.fromEntries(p.ias.map((ia) => [ia, pronto])),
      ...(p.ponte ? { sessaoPorMaquina: true } : {}), ...(p.capacidades ? { capacidadesDaMaquina: p.capacidades } : {}),
    })).data;
  return { ...base, deps, enfileirar, plano };
}


describeIntegracao("QA-198: os botões do cartão do desvio refazem a fala uma vez só", () => {
  async function noCartao(trx: Trx) {
    const m = await montar(trx);
    const a = randomUUID();
    await m.repos.conversas.atualizarSessaoCli(m.conversaId, "sessao-que-sumiu", "local", "claude-cli", a);
    const t1 = (await m.enfileirar("claude-cli"))!;
    await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() });
    await m.plano(t1.id, { machineId: a, ias: ["claude-cli"], ponte: true });
    await assentarTurno(m.deps, { turnoId: t1.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
    const rep = (await trx<{ id: string }[]>`select id from turnos where conversa_id = ${m.conversaId} and id <> ${t1.id}`)[0]!.id;
    await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() });
    await m.plano(rep, { machineId: a, ias: ["claude-cli"], ponte: true });
    await assentarTurno(m.deps, { turnoId: rep, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
    const contar = async () => {
      const t = await trx<{ estado: string; n: number }[]>`select estado, count(*)::int as n from turnos where conversa_id = ${m.conversaId} group by estado order by estado`;
      const linhas = (await m.repos.mensagens.listarDaConversa(m.conversaId)).filter((x) => x.kind === "sistema" && x.payload?.kind !== "desvio" || x.texto?.startsWith("Reinstalando")).length;
      return { turnos: Object.fromEntries(t.map((x) => [x.estado, x.n])), linhas };
    };
    return { m, rep, contar };
  }

  it("Reinstalar e tentar duas vezes (duas abas ou recarregar): o 2º diz já refeito, sem cancelar e recriar a fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const { m, rep, contar } = await noCartao(trx);
      const p = { conversaId: m.conversaId, turnoId: rep, ia: "claude-cli" as const, maquina: "MacBook" };
      const r1 = await reinstalarETentar(m.deps, p);
      expect(r1.data.turnoId).not.toBeNull();
      const antes = await contar();
      const r2 = await reinstalarETentar(m.deps, p);

      expect(r2.data).toMatchObject({ turnoId: null, motivo: "ja_refeito" });
      expect(await contar()).toEqual(antes);
    });
  });

  it("Responder com outra IA duas vezes: o 2º diz já refeito", async () => {
    await withRollback(MARLON, async (trx) => {
      const { m, rep, contar } = await noCartao(trx);
      const p = { conversaId: m.conversaId, turnoId: rep, ia: "codex-cli" as const, prontos: ["codex-cli" as const] };
      await responderComOutraIa(m.deps, p);
      const antes = await contar();
      const r2 = await responderComOutraIa(m.deps, p);

      expect(r2.data).toMatchObject({ turnoId: null, motivo: "ja_refeito" });
      expect(await contar()).toEqual(antes);
    });
  });
});
