import { expect, it } from "vitest";
import type { ExecucaoRaioX } from "../../src/contracts/raio-x.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Issue #168: o aviso de contexto cheio compara o turno com o turno anterior do bot NA CONVERSA DA PESSOA. A leitura
 * pula turnos de rotina, frente e procuração (sessão própria, contexto pequeno): eles fariam o aviso se repetir.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const execucao = (contexto: number): ExecucaoRaioX => ({
  chamadas: [{ em: 1, contexto, entrada: 0, cacheLido: contexto, cacheNovo: 0, saida: 1, pensamento: 0, subagente: false, ferramentas: [] }],
  chamadasOmitidas: 0, compactacoes: [], janela: 1_000_000, modelo: "opus", versaoCli: "2.1.309", custoSessaoUsd: null, ferramentasNoInit: 0, buscaDeFerramentas: false, duracaoMs: 1,
});
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function cenario(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Atlas" });
  let em = Date.now() - 3_600_000;
  /** Um turno do bot com a execução gravada; `criado_em` crescente, um segundo por turno (sem empate de ms). */
  const turno = async (contexto: number | null, origem: "conversa" | "rotina" = "conversa") => {
    const t = (await base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "opus", harness: "claude-cli" }))!;
    em += 1_000;
    await trx`update turnos set criado_em = ${new Date(em)}, estado = 'concluido' where id = ${t.id}`;
    if (contexto !== null) await base.repos.raioX.gravarExecucao(t.id, execucao(contexto));
    return t;
  };
  return { ...base, turno };
}

describeIntegracao("Issue #168: o turno anterior do aviso de contexto", () => {
  it("é o último turno de conversa com Raio-X antes deste; rotina e turno sem Raio-X ficam de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.turno(310_000);
      await c.turno(20_000, "rotina");
      await c.turno(null);
      const atual = await c.turno(320_000);
      const anterior = await c.repos.raioX.execucaoAnterior(c.conversaId, c.agenteId, atual.id);
      expect(anterior?.chamadas[0]?.contexto).toBe(310_000);
    });
  });

  it("o primeiro turno da conversa não tem anterior", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const atual = await c.turno(320_000);
      expect(await c.repos.raioX.execucaoAnterior(c.conversaId, c.agenteId, atual.id)).toBeNull();
    });
  });
});
