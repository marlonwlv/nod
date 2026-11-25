import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { emitirChaveMaquina } from "../../src/use-cases/chaves-maquina.ts";
import { db } from "../helpers/db.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * QA-178: a pessoa tem no máximo uma máquina "só computador" viva (índice `maquina_tokens_um_computador`, 0105). O
 * `emitirChaveMaquina` conferia a vaga (`computadorVivo`) e gravava sem trava: duas máquinas pareando ao mesmo tempo
 * (dois convites, ou o mesmo "Substituir" em duas instalações) viam a vaga livre, e a segunda batia no índice com um
 * 23505 cru — 500 no `pareamento/dispositivo/trocar`, sem a recusa "já há uma máquina só computador".
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const emitir = (nome: string, substituir?: boolean) =>
  escopado((trx) => emitirChaveMaquina(depsSobre(trx, PESSOA).deps, { nome, papel: "computador", ...(substituir ? { substituir } : {}) }));

const codigo = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? "ok" : r.reason instanceof ErroDeDominio ? r.reason.codigo : `cru:${(r.reason as { code?: string }).code ?? String(r.reason)}`;

async function vivas(): Promise<number> {
  const [l] = await escopado((trx) => trx<{ n: number }[]>`select count(*)::int as n from maquina_tokens
    where owner_id = ${PESSOA.pessoaId} and papel = 'computador' and revogado_em is null`);
  return l!.n;
}

describeIntegracao("uma máquina só computador por pessoa, com pareamentos ao mesmo tempo (QA-178)", () => {
  afterAll(async () => {
    await escopado((trx) => trx`delete from maquina_tokens where owner_id = ${PESSOA.pessoaId}`);
  });

  it("duas máquinas novas ao mesmo tempo: uma pareia, a outra recebe a recusa do domínio, não um 23505", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => emitir(`VM ${i}`)));
    expect(rs.map(codigo).sort()).toEqual(["estado_invalido", "estado_invalido", "estado_invalido", "ok"]);
    expect(await vivas()).toBe(1);
  });

  it("dois Substituir ao mesmo tempo: os dois pareiam em sequência e só a última fica viva", async () => {
    const rs = await Promise.allSettled([emitir("Nova A", true), emitir("Nova B", true)]);
    expect(rs.map(codigo)).toEqual(["ok", "ok"]);
    expect(await vivas()).toBe(1);
  });
});
