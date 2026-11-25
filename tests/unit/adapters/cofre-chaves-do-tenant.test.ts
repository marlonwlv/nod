import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chaveMestraLocal, type ChaveMestra } from "../../../src/adapters/cofre/chave-mestra.ts";
import { criarChavesDoTenant, TTL_CHAVE_DO_TENANT_MS } from "../../../src/adapters/cofre/chaves-do-tenant.ts";
import { FalhaDoCofre } from "../../../src/db/cifra-envelope.ts";

/** ADR-195 §2, "KMS fora do ar": a chave do tenant aberta fica 10 min em memória; depois, sem a mestra, falha fechado. */
const CREDENCIAL = "ef".repeat(32);

/** Uma mestra local que conta as aberturas e pode "cair" como o KMS. */
function mestraQueCai(): ChaveMestra & { aberturas: () => number; cair: () => void } {
  const local = chaveMestraLocal(CREDENCIAL);
  let aberturas = 0;
  let fora = false;
  return {
    tipo: "kms",
    embrulhar: (c, aad) => (fora ? Promise.reject(new FalhaDoCofre("mestra_indisponivel")) : local.embrulhar(c, aad)),
    async desembrulhar(e, aad) {
      aberturas++;
      if (fora) throw new FalhaDoCofre("mestra_indisponivel");
      return local.desembrulhar(e, aad);
    },
    aberturas: () => aberturas,
    cair: () => {
      fora = true;
    },
  };
}

describe("chaves de tenant em cache", () => {
  it("com a mestra caindo depois de aquecer, o uso continua até o TTL e depois falha fechado", async () => {
    let agora = 5_000_000;
    const mestra = mestraQueCai();
    const chaves = criarChavesDoTenant({ mestra, agora: () => agora });
    const tenantId = randomUUID();
    const nova = await chaves.criar(tenantId, 1);
    const linha = { tenantId, versao: 1, chaveEmbrulhada: nova.chaveEmbrulhada };

    const primeira = await chaves.abrir(linha);
    expect(primeira.equals(nova.chave)).toBe(true);
    expect(mestra.aberturas()).toBe(1);

    mestra.cair();
    agora += TTL_CHAVE_DO_TENANT_MS - 1;
    const doCache = await chaves.abrir(linha);
    expect(doCache.equals(nova.chave)).toBe(true);
    expect(mestra.aberturas()).toBe(1);

    agora += 1;
    const f = await chaves.abrir(linha).then(
      () => null,
      (e: unknown) => e,
    );
    expect(f).toBeInstanceOf(FalhaDoCofre);
    expect((f as FalhaDoCofre).motivo).toBe("mestra_indisponivel");
    expect(mestra.aberturas()).toBe(2);
  });

  it("cada abertura recebe uma cópia: zerar a própria não estraga o cache; duas ao mesmo tempo pedem uma vez à mestra", async () => {
    const mestra = mestraQueCai();
    const chaves = criarChavesDoTenant({ mestra });
    const tenantId = randomUUID();
    const nova = await chaves.criar(tenantId, 1);
    const linha = { tenantId, versao: 1, chaveEmbrulhada: nova.chaveEmbrulhada };
    const [a, b] = await Promise.all([chaves.abrir(linha), chaves.abrir(linha)]);
    expect(mestra.aberturas()).toBe(1);
    a.fill(0);
    expect(b.equals(nova.chave)).toBe(true);
    expect((await chaves.abrir(linha)).equals(nova.chave)).toBe(true);
  });

  it("a entrada leva a chave embrulhada: linha recriada (ou reembrulhada) não casa com a chave aberta de antes", async () => {
    const mestra = mestraQueCai();
    const chaves = criarChavesDoTenant({ mestra });
    const tenantId = randomUUID();
    const v1 = await chaves.criar(tenantId, 1);
    chaves.lembrar({ tenantId, versao: 1, chaveEmbrulhada: v1.chaveEmbrulhada }, v1.chave);
    // A transação que gravou v1 voltou atrás; outra criou a versão 1 de novo, com outra chave.
    const outra = await chaves.criar(tenantId, 1);
    const aberta = await chaves.abrir({ tenantId, versao: 1, chaveEmbrulhada: outra.chaveEmbrulhada });
    expect(aberta.equals(outra.chave)).toBe(true);
    expect(aberta.equals(v1.chave)).toBe(false);
    // esquecer tira o tenant do cache: a próxima abertura volta à mestra.
    const antes = mestra.aberturas();
    chaves.esquecer(tenantId);
    await chaves.abrir({ tenantId, versao: 1, chaveEmbrulhada: outra.chaveEmbrulhada });
    expect(mestra.aberturas()).toBe(antes + 1);
  });

  it("a chave de um tenant não abre como a de outro (a AAD da mestra leva o tenant e a versão)", async () => {
    const chaves = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
    const tenantId = randomUUID();
    const nova = await chaves.criar(tenantId, 1);
    const f = await chaves.abrir({ tenantId: randomUUID(), versao: 1, chaveEmbrulhada: nova.chaveEmbrulhada }).catch((e: unknown) => e);
    expect((f as FalhaDoCofre).motivo).toBe("cifra_invalida");
    const g = await chaves.abrir({ tenantId, versao: 2, chaveEmbrulhada: nova.chaveEmbrulhada }).catch((e: unknown) => e);
    expect((g as FalhaDoCofre).motivo).toBe("cifra_invalida");
  });
});
