import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { reinstalarETentar, responderComOutraIa } from "../../src/use-cases/contas-ia.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { retomarTurno } from "../../src/use-cases/retomar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** QA-199 (r198): o cartão do desvio ficou na tela, o bot foi excluído (outra aba) e a pessoa clica num botão do cartão. */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };
const SINAIS = { attempted: true, rejected: true, promptSubmitted: false, producedOutput: false };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const rejeitada: ResultadoTurno = {
  desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", texto: "", sessaoCli: null, sinais: SINAIS,
  custoUsd: null, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
};
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function noCartao(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const a = randomUUID();
  const plano = (turnoId: string, ias: readonly IdHarness[]) => emitirPlanoTurno(deps, { turnoId, machineId: a, executor: "local", harnesses: Object.fromEntries(ias.map((ia) => [ia, pronto])), sessaoPorMaquina: true });
  await base.repos.conversas.atualizarSessaoCli(base.conversaId, "sessao-que-sumiu", "local", "claude-cli", a);
  const t1 = (await base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  for (const id of [t1.id, null]) {
    const turnoId = id ?? (await trx<{ id: string }[]>`select id from turnos where conversa_id = ${base.conversaId} and id <> ${t1.id}`)[0]!.id;
    await base.repos.turnos.reivindicar({ machineId: a, agora: Date.now() });
    await plano(turnoId, ["claude-cli"]);
    await assentarTurno(deps, { turnoId, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
  }
  const rep = (await trx<{ id: string }[]>`select id from turnos where conversa_id = ${base.conversaId} and id <> ${t1.id}`)[0]!.id;
  const cartao = (await base.repos.mensagens.listarDaConversa(base.conversaId)).some((m) => m.turnoId === rep && m.payload?.kind === "desvio" && m.payload.forma === "cartao");
  expect(cartao).toBe(true);
  await base.repos.agentes.excluir(base.agenteId, Date.now());
  return { ...base, deps, rep };
}

describeIntegracao("QA-199: botão do cartão do desvio com o bot já excluído", () => {
  for (const [nome, chamar] of [
    ["Responder com outra IA", (m: Awaited<ReturnType<typeof noCartao>>) => responderComOutraIa(m.deps, { conversaId: m.conversaId, turnoId: m.rep, ia: "codex-cli", prontos: ["codex-cli"] })],
    ["Retomar com uma frase", (m: Awaited<ReturnType<typeof noCartao>>) => retomarTurno(m.deps, { turnoId: m.rep, texto: "pode seguir" })],
    ["Reinstalar e tentar", (m: Awaited<ReturnType<typeof noCartao>>) => reinstalarETentar(m.deps, { conversaId: m.conversaId, turnoId: m.rep, ia: "claude-cli", maquina: "MacBook" })],
  ] as const) {
    it(`${nome}: recusa como não encontrado (404), não estoura o gatilho do banco (500)`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await noCartao(trx);
        const erro = await chamar(m).then(() => null, (e: unknown) => e);
        expect(erro).toBeInstanceOf(ErroDeDominio);
        expect((erro as ErroDeDominio).codigo).toBe("nao_encontrado");
      });
    });
  }
});
