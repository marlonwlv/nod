import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { chaveMestraLocal } from "../../src/adapters/cofre/chave-mestra.ts";
import { criarChavesDoTenant } from "../../src/adapters/cofre/chaves-do-tenant.ts";
import { FalhaDoCofre } from "../../src/db/cifra-envelope.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { guardarItem, lerValorParaEntrega, listarItens, reembrulharTenants, revogarItem, type DepsDoCofre } from "../../src/use-cases/cofre-envelope.ts";
import { ANA, esperarErro, MARLON } from "../helpers/deps-l6.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-195 (0185), Entrega 1: o cofre em envelope no Postgres de verdade, sob rollback. A mestra é a local (HKDF de uma
 * NOD_CREDENTIAL_KEY de teste); nenhum valor, id ou chave real.
 */
const CREDENCIAL = "12".repeat(32);
const OUTRA_CREDENCIAL = "34".repeat(32);
const T0 = 1_795_100_000_000;

function relogio(): () => number {
  let t = T0;
  return () => (t += 1000);
}

const depsDe = (trx: Tx, escopo: Escopo, agora: () => number): DepsDoCofre => ({ repos: criarRepos(trx, escopo), escopo, agora });

async function falhaDoCofre(p: Promise<unknown>): Promise<FalhaDoCofre> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(FalhaDoCofre);
  return e as FalhaDoCofre;
}

describeIntegracao("cofre em envelope (0185)", () => {
  it("guardar cifra e cria a chave do tenant no primeiro uso; listar não leva valor; entregar decifra, marca o uso e registra", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = relogio();
      const deps = depsDe(trx, MARLON, agora);
      const chaves = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
      const { item, anterior } = await guardarItem(deps, chaves, { tipo: "chave", nome: " ORGO_API_KEY ", app: "orgo", publico: { conta: "exemplo" }, valor: "orgo-chave-de-teste", dono: "pessoa" });
      expect(anterior).toBeNull();
      expect(item).toMatchObject({ nome: "ORGO_API_KEY", app: "orgo", tipo: "chave", dono: "pessoa", versao: 1, revogadoEm: null, publico: { conta: "exemplo" } });

      const [chaveTenant] = await trx`select versao, mestra_ref, visibility, owner_id from cofre_chaves_tenant where tenant_id = ${MARLON.tenantId}`;
      expect(chaveTenant).toMatchObject({ versao: 1, mestra_ref: "local:v1", visibility: "equipe", owner_id: MARLON.pessoaId });
      const [linha] = await trx`select valor_cifrado, chave_item_embrulhada, chave_tenant_versao, visibility from cofre_itens where id = ${item.id}`;
      expect(linha?.valor_cifrado).toMatch(/^v2:1:/);
      expect(linha?.chave_item_embrulhada).toMatch(/^v2:1:/);
      expect(JSON.stringify(linha)).not.toContain("orgo-chave-de-teste");
      expect(linha).toMatchObject({ chave_tenant_versao: 1, visibility: "privado" });

      const lista = await listarItens(deps);
      expect(lista.map((i) => i.id)).toEqual([item.id]);
      expect(JSON.stringify(lista)).not.toMatch(/orgo-chave-de-teste|v2:|cifrad|embrulhad/);

      const { agenteId } = await agenteComConversa(trx, MARLON);
      const entregue = await lerValorParaEntrega(deps, chaves, { itemId: item.id, agenteId, turnoId: randomUUID() });
      expect(entregue.valor).toBe("orgo-chave-de-teste");
      expect((await deps.repos.cofre.buscarItem(item.id))?.ultimoUsoEm).not.toBeNull();
      const eventos = await deps.repos.cofre.eventosDoItem(item.id);
      expect(eventos.map((e) => e.tipo)).toEqual(["guardado", "entregue"]);
      expect(eventos[1]?.agenteId).toBe(agenteId);
      expect(JSON.stringify(eventos)).not.toContain("orgo-chave-de-teste");

      // Outro processo (cache vazio), a mesma mestra: abre pela linha do tenant.
      const outroProcesso = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
      expect((await lerValorParaEntrega(deps, outroProcesso, { itemId: item.id })).valor).toBe("orgo-chave-de-teste");
      // Uma mestra diferente não abre a chave do tenant: falha fechada.
      expect((await falhaDoCofre(lerValorParaEntrega(deps, criarChavesDoTenant({ mestra: chaveMestraLocal(OUTRA_CREDENCIAL) }), { itemId: item.id }))).motivo).toBe("cifra_invalida");
    });
  });

  it("trocar revoga a versão anterior na mesma transação; revogar tira da lista e da entrega", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsDe(trx, MARLON, relogio());
      const chaves = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
      const v1 = (await guardarItem(deps, chaves, { tipo: "chave", nome: "EXEMPLO_API_KEY", valor: "valor-um", dono: "pessoa" })).item;
      const troca = await guardarItem(deps, chaves, { tipo: "chave", nome: "EXEMPLO_API_KEY", valor: "valor-dois", dono: "pessoa" });
      expect(troca.anterior?.id).toBe(v1.id);
      expect(troca.item).toMatchObject({ versao: 2 });
      expect(troca.item.id).not.toBe(v1.id);
      expect((await deps.repos.cofre.buscarItem(v1.id))?.revogadoEm).not.toBeNull();
      expect((await listarItens(deps)).map((i) => i.id)).toEqual([troca.item.id]);
      expect((await deps.repos.cofre.eventosDoItem(troca.item.id)).map((e) => e.tipo)).toEqual(["trocado"]);
      await esperarErro(() => lerValorParaEntrega(deps, chaves, { itemId: v1.id }), "nao_encontrado");
      expect((await lerValorParaEntrega(deps, chaves, { itemId: troca.item.id })).valor).toBe("valor-dois");
      // Uma chave de tenant só: a troca não cria outra.
      expect(await trx`select versao from cofre_chaves_tenant where tenant_id = ${MARLON.tenantId}`).toHaveLength(1);

      await revogarItem(deps, { itemId: troca.item.id });
      expect(await listarItens(deps)).toEqual([]);
      await esperarErro(() => lerValorParaEntrega(deps, chaves, { itemId: troca.item.id }), "nao_encontrado");
      await esperarErro(() => revogarItem(deps, { itemId: troca.item.id }), "nao_encontrado");
      expect((await deps.repos.cofre.eventosDoItem(troca.item.id)).map((e) => e.tipo)).toEqual(["trocado", "entregue", "revogado"]);
      // Revogado não volta, e a cifra de uma versão não muda (trigger da 0185).
      await expectRejected(trx, () => trx`update cofre_itens set revogado_em = null where id = ${troca.item.id}`, "P0001");
      await expectRejected(trx, () => trx`update cofre_itens set valor_cifrado = ${"v2:1:AAAA:AAAA:AAAA"} where id = ${v1.id}`, "P0001");
    });
  });

  it("cartão: só os dados públicos; valor é recusado, não há entrega e a concessão é só 'perguntar'", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsDe(trx, MARLON, relogio());
      const chaves = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
      await esperarErro(() => guardarItem(deps, chaves, { tipo: "cartao", nome: "Visa •••• 0000", valor: "4000000000000000", dono: "pessoa" }), "entrada_invalida");
      const { item } = await guardarItem(deps, chaves, { tipo: "cartao", nome: "Visa •••• 0000", publico: { bandeira: "visa", final: "0000", aparelho: "mac-exemplo" }, dono: "pessoa" });
      const [linha] = await trx`select valor_cifrado, chave_item_embrulhada, chave_tenant_versao from cofre_itens where id = ${item.id}`;
      expect(linha).toEqual({ valor_cifrado: null, chave_item_embrulhada: null, chave_tenant_versao: null });
      // Sem valor, o cartão nem cria a chave do tenant.
      expect(await trx`select 1 from cofre_chaves_tenant where tenant_id = ${MARLON.tenantId}`).toHaveLength(0);
      await esperarErro(() => lerValorParaEntrega(deps, chaves, { itemId: item.id }), "estado_invalido");

      const { agenteId } = await agenteComConversa(trx, MARLON);
      await esperarErro(() => deps.repos.cofre.conceder({ itemId: item.id, agenteId, modo: "sempre" }), "entrada_invalida");
      expect(await deps.repos.cofre.conceder({ itemId: item.id, agenteId, modo: "perguntar" })).toBe(true);
      expect(await deps.repos.cofre.concessao(item.id, agenteId)).toBe("perguntar");
      // Bot que não existe: nada concedido.
      expect(await deps.repos.cofre.conceder({ itemId: item.id, agenteId: randomUUID(), modo: "perguntar" })).toBe(false);

      // O CHECK da 0185 guarda o mesmo por baixo: cartão com cifra, ou chave sem cifra / em claro, não gravam.
      const v2 = "v2:1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA";
      await expectRejected(trx, () => trx`insert into cofre_itens (owner_id, tipo, nome, dono, versao, valor_cifrado) values (${MARLON.pessoaId}, 'cartao', 'Cartão', 'pessoa', 1, ${v2})`, /cofre_itens_cifra_por_tipo/);
      await expectRejected(trx, () => trx`insert into cofre_itens (owner_id, tipo, nome, dono, versao) values (${MARLON.pessoaId}, 'chave', 'SEM_CIFRA', 'pessoa', 1)`, /cofre_itens_cifra_por_tipo/);
      await expectRejected(
        trx,
        () => trx`insert into cofre_itens (owner_id, tipo, nome, dono, versao, valor_cifrado, chave_item_embrulhada, chave_tenant_versao) values (${MARLON.pessoaId}, 'chave', 'EM_CLARO', 'pessoa', 1, 'minha-senha', ${v2}, 1)`,
        /cofre_itens_valor_cifrado/,
      );
      // Item do time é 'equipe'; o da pessoa, 'privado' — nada de meio-termo.
      await expectRejected(trx, () => trx`insert into cofre_itens (owner_id, tipo, nome, dono, versao, visibility) values (${MARLON.pessoaId}, 'cartao', 'Meio', 'time', 1, 'privado')`, /cofre_itens_dono_visibility/);
    });
  });

  it("RLS: a pessoa B do mesmo tenant não vê o item 'pessoa' de A, vê e usa o do time; outro tenant não vê nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = relogio();
      const chaves = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
      const deA = depsDe(trx, MARLON, agora);
      const privado = (await guardarItem(deA, chaves, { tipo: "login", nome: "loja.exemplo.com", publico: { usuario: "a" }, valor: "senha-de-a", dono: "pessoa" })).item;
      const doTime = (await guardarItem(deA, chaves, { tipo: "chave", nome: "TIME_API_KEY", valor: "chave-do-time", dono: "time" })).item;

      await vincularEscopo(trx, ANA);
      const deB = depsDe(trx, ANA, agora);
      expect((await listarItens(deB)).map((i) => i.id)).toEqual([doTime.id]);
      await esperarErro(() => lerValorParaEntrega(deB, chaves, { itemId: privado.id }), "nao_encontrado");
      // B abre a chave do tenant (linha 'equipe') e decifra o item do time, mesmo com o cache vazio.
      const cacheDeB = criarChavesDoTenant({ mestra: chaveMestraLocal(CREDENCIAL) });
      expect((await lerValorParaEntrega(deB, cacheDeB, { itemId: doTime.id })).valor).toBe("chave-do-time");
      // Revogar ou trocar o item do time é de quem o guardou.
      await esperarErro(() => revogarItem(deB, { itemId: doTime.id }), "nao_encontrado");
      await esperarErro(() => guardarItem(deB, chaves, { tipo: "chave", nome: "TIME_API_KEY", valor: "de-b", dono: "time" }), "nao_permitido");
      // B guarda o próprio item com o mesmo nome do privado de A: cada pessoa tem o seu.
      const deBMesmoNome = await guardarItem(deB, chaves, { tipo: "login", nome: "loja.exemplo.com", valor: "senha-de-b", dono: "pessoa" });
      expect(deBMesmoNome.anterior).toBeNull();
      // B não reescreve a chave do tenant fora das colunas do reembrulho, nem apaga.
      await expectRejected(trx, () => trx`update cofre_chaves_tenant set versao = 9 where tenant_id = ${ANA.tenantId}`, "P0001");
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova do REVOKE (0185), sob rollback: espera-se 42501
      await expectRejected(trx, () => trx`delete from cofre_chaves_tenant where tenant_id = ${ANA.tenantId}`, "42501");
      await expectRejected(trx, () => trx`update cofre_eventos set tipo = 'negado' where item_id = ${doTime.id}`, "42501");

      await vincularEscopo(trx, { tenantId: randomUUID(), pessoaId: MARLON.pessoaId });
      for (const tabela of ["cofre_chaves_tenant", "cofre_itens", "cofre_concessoes", "cofre_eventos"]) {
        expect(await trx`select 1 from ${trx(tabela)}`, tabela).toHaveLength(0);
      }
      await vincularEscopo(trx, MARLON);
      expect((await listarItens(deA)).map((i) => i.id).sort()).toEqual([privado.id, doTime.id].sort());
    });
  });

  it("reembrulhar a mestra troca só a chave do tenant: os itens não são reescritos e decifram pela mestra nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = relogio();
      const antiga = chaveMestraLocal(CREDENCIAL);
      const nova = chaveMestraLocal(OUTRA_CREDENCIAL, { ref: "local:teste" });
      const OUTRO: Escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };
      const deA = depsDe(trx, MARLON, agora);
      const itemA = (await guardarItem(deA, criarChavesDoTenant({ mestra: antiga }), { tipo: "chave", nome: "EXEMPLO_API_KEY", valor: "valor-a", dono: "pessoa" })).item;
      await vincularEscopo(trx, OUTRO);
      const deOutro = depsDe(trx, OUTRO, agora);
      const itemOutro = (await guardarItem(deOutro, criarChavesDoTenant({ mestra: antiga }), { tipo: "contato", nome: "Contato de exemplo", valor: "valor-outro", dono: "time" })).item;
      await vincularEscopo(trx, MARLON);
      const antesA = await trx`select valor_cifrado, chave_item_embrulhada, atualizado_em from cofre_itens where id = ${itemA.id}`;
      const [chaveAntes] = await trx`select chave_embrulhada from cofre_chaves_tenant where tenant_id = ${MARLON.tenantId}`;

      // A Ana reembrulha a chave que o Marlon criou (policy nod_equipe_update); o outro tenant vai no escopo de alguém de lá.
      const resultados = await reembrulharTenants({
        escopos: [ANA, MARLON, OUTRO],
        dentro: async (escopo, fn) => {
          await vincularEscopo(trx, escopo);
          return fn(depsDe(trx, escopo, agora));
        },
        atual: antiga,
        nova,
      });
      expect(resultados).toEqual([
        { tenantId: MARLON.tenantId, versoes: 1 },
        { tenantId: OUTRO.tenantId, versoes: 1 },
      ]);

      await vincularEscopo(trx, MARLON);
      const [chaveDepois] = await trx`select chave_embrulhada, mestra_ref, reembrulhada_em from cofre_chaves_tenant where tenant_id = ${MARLON.tenantId}`;
      expect(chaveDepois?.mestra_ref).toBe("local:teste");
      expect(chaveDepois?.reembrulhada_em).not.toBeNull();
      expect(chaveDepois?.chave_embrulhada).not.toBe(chaveAntes?.chave_embrulhada);
      // Os itens ficaram como estavam, byte a byte.
      expect(await trx`select valor_cifrado, chave_item_embrulhada, atualizado_em from cofre_itens where id = ${itemA.id}`).toEqual(antesA);
      expect((await lerValorParaEntrega(deA, criarChavesDoTenant({ mestra: nova }), { itemId: itemA.id })).valor).toBe("valor-a");
      // A mestra antiga não abre mais a chave reembrulhada.
      expect((await falhaDoCofre(lerValorParaEntrega(deA, criarChavesDoTenant({ mestra: antiga }), { itemId: itemA.id }))).motivo).toBe("cifra_invalida");

      await vincularEscopo(trx, OUTRO);
      expect((await lerValorParaEntrega(deOutro, criarChavesDoTenant({ mestra: nova }), { itemId: itemOutro.id })).valor).toBe("valor-outro");
      const eventos = await trx`select tipo, item_id, detalhe from cofre_eventos where tipo = 'reembrulhado'`;
      expect(eventos).toEqual([{ tipo: "reembrulhado", item_id: null, detalhe: { versao: 1 } }]);

      // Uma segunda rodada com a mestra errada falha naquele tenant sem gravar nada e sem parar o resto.
      await vincularEscopo(trx, MARLON);
      const errada = await reembrulharTenants({
        escopos: [MARLON],
        dentro: async (escopo, fn) => {
          await vincularEscopo(trx, escopo);
          return fn(depsDe(trx, escopo, agora));
        },
        atual: antiga,
        nova,
      });
      expect(errada).toEqual([{ tenantId: MARLON.tenantId, falha: "cifra_invalida" }]);
      expect((await trx`select mestra_ref from cofre_chaves_tenant where tenant_id = ${MARLON.tenantId}`)[0]?.mestra_ref).toBe("local:teste");
    });
  });

  it("a chave do tenant: uma viva por tenant, a corrida da versão 1 perde em silêncio, aposentada não volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const embrulhada = "v2:1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA";
      expect(await repos.cofre.criarChaveDoTenant({ versao: 1, chaveEmbrulhada: embrulhada, mestraRef: "local:v1" })).not.toBeNull();
      expect(await repos.cofre.criarChaveDoTenant({ versao: 1, chaveEmbrulhada: embrulhada, mestraRef: "local:v1" })).toBeNull();
      // Outra viva no mesmo tenant: o índice parcial barra (o ON CONFLICT devolve null).
      expect(await repos.cofre.criarChaveDoTenant({ versao: 2, chaveEmbrulhada: embrulhada, mestraRef: "local:v1" })).toBeNull();
      await trx`update cofre_chaves_tenant set aposentada_em = now() where tenant_id = ${MARLON.tenantId} and versao = 1`;
      await expectRejected(trx, () => trx`update cofre_chaves_tenant set aposentada_em = null where tenant_id = ${MARLON.tenantId} and versao = 1`, "P0001");
      expect(await repos.cofre.chaveAtivaDoTenant()).toBeNull();
      expect(await repos.cofre.maiorVersaoDaChave()).toBe(1);
      expect(await repos.cofre.criarChaveDoTenant({ versao: 2, chaveEmbrulhada: embrulhada, mestraRef: "local:v1" })).toMatchObject({ versao: 2 });
    });
  });
});
