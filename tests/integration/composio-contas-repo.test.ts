import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import type { Conn } from "../../src/shared/types.ts";

const marlon = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ana = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

async function conector(tx: Conn, slug: string, nome: string): Promise<string> {
  const [c] = await tx<{ id: string }[]>`
    insert into conectores (tenant_id, owner_id, nome, slug, transporte, url, declaracao, habilitado)
    values (${marlon.tenantId}, ${marlon.pessoaId}, ${nome}, ${slug}, 'http', 'https://exemplo.invalid/mcp', 'toca', true)
    returning id`;
  return c!.id;
}

/** ADR-196 (0186): uma sessão do Composio por pessoa, app e conta (a chave da conta no toolkit); a conta tirada sai das listas e volta. */
describeIntegracao("contas do mesmo app no banco", () => {
  it("cada conta tem a sua sessão; a mesma conta de novo troca a sessão, não duplica", async () => {
    await withRollback(marlon, async (tx) => {
      const m = criarRepos(tx, marlon);
      const gmail = await conector(tx, "gmail", "Gmail");
      const pessoal = await conector(tx, "gmail--pessoal", "Gmail (pessoal)");
      await m.composio.salvarSessao({ toolkit: "gmail", sessaoId: "trs_1", contaId: "ca_1", conectorId: gmail });
      await m.composio.salvarSessao({ toolkit: "gmail", conta: "pessoal", sessaoId: "trs_2", contaId: "ca_2", conectorId: pessoal });
      await m.composio.salvarSessao({ toolkit: "gmail", conta: "pessoal", sessaoId: "trs_3", contaId: "ca_3", conectorId: pessoal });
      expect((await m.composio.sessao("gmail"))?.contaId).toBe("ca_1");
      expect(await m.composio.sessao("gmail--pessoal")).toMatchObject({ contaId: "ca_3", conta: "pessoal", conectorId: pessoal });
      expect(await m.composio.sessao("gmail--outra")).toBeNull();
      expect(await m.composio.sessao("gmail--")).toBeNull();
      expect((await m.composio.sessoesDoApp("gmail")).map((s) => s.conta)).toEqual([null, "pessoal"]);
      // A chave da conta mora no `toolkit`: o UNIQUE (tenant, owner, toolkit) da 0009 fica e o servidor antigo segue casando.
      expect((await tx<{ toolkit: string }[]>`select toolkit from composio_sessoes order by toolkit`).map((r) => r.toolkit)).toEqual(["gmail", "gmail--pessoal"]);
      await expectRejected(tx, () => tx`insert into composio_sessoes (tenant_id, owner_id, toolkit, sessao_id, conta_id, conector_id) values (${marlon.tenantId}, ${marlon.pessoaId}, 'gmail--pessoal', 's', 'c', ${pessoal})`, "23505");
    });
  });

  it("o listar traz o e-mail da conta e deixa de fora a conta tirada; restaurar a traz de volta", async () => {
    await withRollback(marlon, async (tx) => {
      const m = criarRepos(tx, marlon);
      const gmail = await conector(tx, "gmail", "Gmail");
      const pessoal = await conector(tx, "gmail--pessoal", "Gmail (pessoal)");
      await m.composio.salvarSessao({ toolkit: "gmail", sessaoId: "trs_1", contaId: "ca_1", conectorId: gmail });
      await m.composio.salvarSessao({ toolkit: "gmail", conta: "pessoal", sessaoId: "trs_2", contaId: "ca_2", conectorId: pessoal });
      await m.composio.salvarEmail(pessoal, "maria@pessoal.example");
      await tx`insert into acessos_padrao (tenant_id, owner_id, conector_id, nivel) values (${marlon.tenantId}, ${marlon.pessoaId}, ${pessoal}, 'leitura')`;
      await tx`insert into niveis_ferramenta (tenant_id, owner_id, conector_slug, tipo, nivel) values (${marlon.tenantId}, ${marlon.pessoaId}, 'gmail--pessoal', 'escrita', 'sempre_permitir')`;

      const lista = await m.conectores.listar();
      expect(lista.filter((c) => c.slug.startsWith("gmail")).map((c) => [c.slug, c.contaEmail ?? null])).toEqual([["gmail", null], ["gmail--pessoal", "maria@pessoal.example"]]);

      expect(await m.conectores.renomear(pessoal, "Gmail (Família)")).toMatchObject({ nome: "Gmail (Família)", slug: "gmail--pessoal" });
      expect(await m.conectores.remover(pessoal, Date.UTC(2026, 10, 25))).toEqual({ contaComposio: "ca_2" });
      expect((await m.conectores.listar()).map((c) => c.slug)).not.toContain("gmail--pessoal");
      expect(await m.conectores.buscar(pessoal)).toMatchObject({ habilitado: false, removidoEm: Date.UTC(2026, 10, 25) });
      expect(await m.composio.sessao("gmail--pessoal")).toBeNull();
      expect(await tx`select 1 from acessos_padrao where conector_id = ${pessoal}`).toEqual([]);
      // Um "Sempre permitir" de antes não vale para a conta que vier com o mesmo nome (revisão do PR).
      expect(await tx`select 1 from niveis_ferramenta where conector_slug = 'gmail--pessoal'`).toEqual([]);
      // A conta tirada não se liga de novo por fora do conectar, nem pela sonda.
      expect(await m.conectores.habilitar(pessoal, true)).toMatchObject({ habilitado: false });
      expect(await m.conectores.registrarSonda(pessoal, { ok: true, catalogo: [], agora: Date.UTC(2026, 10, 25) })).toMatchObject({ habilitado: false });
      expect((await m.conectores.listarHabilitados()).map((c) => c.id)).not.toContain(pessoal);
      // Tirada não renomeia nem se tira de novo.
      expect(await m.conectores.renomear(pessoal, "Outro")).toBeNull();
      expect(await m.conectores.remover(pessoal, Date.UTC(2026, 10, 26))).toBe(false);

      expect(await m.conectores.restaurar(pessoal)).toBe(true);
      expect((await m.conectores.listar()).map((c) => c.slug)).toContain("gmail--pessoal");
    });
  });

  it("outra pessoa não renomeia, não tira e não vê o e-mail da conta de quem conectou", async () => {
    await withRollback(marlon, async (tx) => {
      const m = criarRepos(tx, marlon);
      const pessoal = await conector(tx, "gmail--pessoal", "Gmail (pessoal)");
      await tx`update conectores set visibility = 'equipe' where id = ${pessoal}`;
      await m.composio.salvarSessao({ toolkit: "gmail", conta: "pessoal", sessaoId: "trs_2", contaId: "ca_2", conectorId: pessoal });
      await m.composio.salvarEmail(pessoal, "maria@pessoal.example");

      await vincularEscopo(tx, ana);
      const a = criarRepos(tx, ana);
      const visto = (await a.conectores.listar()).find((c) => c.id === pessoal);
      expect(visto).toBeDefined();
      expect(visto?.contaEmail).toBeUndefined();
      expect(await a.conectores.renomear(pessoal, "Da Ana")).toBeNull();
      expect(await a.conectores.remover(pessoal, Date.now())).toBe(false);

      await vincularEscopo(tx, marlon);
      expect(await m.conectores.buscar(pessoal)).toMatchObject({ nome: "Gmail (pessoal)", habilitado: true });
      expect(await m.composio.sessao("gmail--pessoal")).not.toBeNull();
    });
  });
});
