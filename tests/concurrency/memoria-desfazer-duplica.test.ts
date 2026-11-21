import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { apagarMemoria, desfazerEntradaDiario } from "../../src/use-cases/editar-memorias.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * QA-183: a pessoa apaga uma memória do bot, o bot lembra o mesmo fato de novo (`lembrar`, que deduplica pelo
 * conteúdo) e ela clica Desfazer na linha Apagada. O desfazer recriava a antiga com o mesmo id e o bot ficava com
 * duas memórias iguais no prompt. Igual com as duas transações ao mesmo tempo (travas diferentes).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
let agenteId = "";

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const codigo = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" && r.reason instanceof ErroDeDominio ? r.reason.codigo : r.status);

async function iguais(texto: string): Promise<number> {
  return escopado(async (trx) => (await criarRepos(trx, PESSOA).memorias.listarDoAgente(agenteId)).filter((m) => m.texto === texto).length);
}

async function apagadaDoBot(texto: string): Promise<string> {
  return escopado(async (trx) => {
    const deps = depsSobreTrx(trx, PESSOA);
    const r = await criarRepos(trx, PESSOA).memorias.criarDoAgenteSeAusente({ agenteId, tipo: "fato", texto });
    await executar(deps, apagarMemoria, { memoriaId: r!.memoria.id });
    return (await deps.repos.memoriasDiario.ultimaDaMemoria(r!.memoria.id))!.id;
  });
}

beforeAll(async () => {
  agenteId = await escopado(async (trx) => (await agenteComConversa(trx, PESSOA, { nome: "Desfazer duplica" })).agenteId);
});

afterAll(async () => {
  await escopado(async (trx) => {
    await trx`delete from memoria_diario where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from agente_memorias where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from conversas where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from agentes where owner_id = ${PESSOA.pessoaId}`;
  });
});

describeIntegracao("QA-183: desfazer o apagar não duplica o que o bot já lembrou de novo", () => {
  it("bot lembra de novo e a pessoa desfaz: recusa mudou_depois e fica uma só", async () => {
    const texto = `Prefere reunião às terças ${randomUUID()}`;
    const entradaId = await apagadaDoBot(texto);
    await escopado(async (trx) => criarRepos(trx, PESSOA).memorias.criarDoAgenteSeAusente({ agenteId, tipo: "fato", texto }));
    const r = await Promise.allSettled([escopado((trx) => executar(depsSobreTrx(trx, PESSOA), desfazerEntradaDiario, { agenteId, entradaId }))]);
    expect(r.map(codigo)).toEqual(["mudou_depois"]);
    expect(await iguais(texto)).toBe(1);
  });

  it("lembrar e desfazer ao mesmo tempo: nunca duas iguais", async () => {
    for (let i = 0; i < 8; i++) {
      const texto = `Usa o Linear no time ${randomUUID()}`;
      const entradaId = await apagadaDoBot(texto);
      await Promise.allSettled([
        escopado((trx) => executar(depsSobreTrx(trx, PESSOA), desfazerEntradaDiario, { agenteId, entradaId })),
        escopado((trx) => criarRepos(trx, PESSOA).memorias.criarDoAgenteSeAusente({ agenteId, tipo: "fato", texto })),
      ]);
      expect(await iguais(texto)).toBe(1);
    }
  });
});
