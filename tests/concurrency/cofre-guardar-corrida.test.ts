import { randomBytes } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { cifrar } from "../../src/db/cifra.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { db } from "../helpers/db.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * QA-200: dois "Guardar" do mesmo login ao mesmo tempo (duas abas; a resposta do primeiro perdida e o reenvio), em duas
 * transações reais. A trava por pessoa + site + usuário faz o segundo esperar o primeiro e trocar a senha dele: um login só.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SITE = "qa200-corrida.example";

describeIntegracao("cofre do nod: dois Guardar ao mesmo tempo (QA-200)", () => {
  afterEach(async () => {
    await db.begin(async (trx) => { await vincularEscopo(trx, MARLON); await trx`delete from cofre_logins where site = ${SITE}`; });
  });

  it("o segundo espera o primeiro e grava por cima: fica um login, com a senha do último", async () => {
    const chave = randomBytes(32);
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let gravou!: () => void;
    const primeiroGravou = new Promise<void>((ok) => (gravou = ok));
    const guardar = (senha: string, antes?: () => Promise<void>) => db.begin(async (trx) => {
      await vincularEscopo(trx, MARLON);
      await trx`set local lock_timeout = '10s'`;
      const l = await criarRepos(trx, MARLON).cofreLogins.criar({ site: SITE, usuario: "marlon", senhaCifrada: cifrar(senha, chave) });
      if (antes) await antes();
      return l;
    });
    const primeiro = guardar("um", async () => { gravou(); await segura; });
    await primeiroGravou;
    const segundo = guardar("dois");
    await new Promise((ok) => setTimeout(ok, 300));
    soltar();
    const [a, b] = await Promise.all([primeiro, segundo]);
    expect(b.id).toBe(a.id);
    const linhas = await db.begin(async (trx) => { await vincularEscopo(trx, MARLON); return criarRepos(trx, MARLON).cofreLogins.doSite(SITE); });
    expect(linhas).toHaveLength(1);
  });
});
