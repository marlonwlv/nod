import { expect, it } from "vitest";
import { chaveMestraLocal } from "../../src/adapters/cofre/chave-mestra.ts";
import { criarChavesDoTenant } from "../../src/adapters/cofre/chaves-do-tenant.ts";
import { APPS_DO_COFRE } from "../../src/domain/apps-do-cofre.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { listarCofre } from "../../src/use-cases/cofre.ts";
import { criarChave, detalheDaChave, guardarChaveDoCartao, mudarAcessoDaChave, removerChave, trocarChave } from "../../src/use-cases/cofre-chaves.ts";
import { INTERVALO_DO_USO_MS, lerValorParaEntrega } from "../../src/use-cases/cofre-envelope.ts";
import { ANA, depsSobreTrx, esperarErro, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-195 (Entrega 3, Paper C1–C3 e O4): as chaves do Cofre pela tela e pelo cartão, no Postgres de verdade sob rollback.
 * A mestra é a local de teste; nenhum valor, id ou chave real.
 */
const T0 = 1_795_200_000_000;
const SEGREDO = "orgo_chave_de_teste_da_entrega_3_que_nao_volta";

function cenario(trx: Tx, escopo: Escopo = MARLON) {
  let t = T0;
  const agora = () => (t += 1000);
  const deps = { ...depsSobreTrx(trx, escopo), agora };
  const chaves = criarChavesDoTenant({ mestra: chaveMestraLocal("56".repeat(32)) });
  return { deps, chaves, avancar: (ms: number) => { t += ms; } };
}

describeIntegracao("chaves do Cofre na tela e no cartão (ADR-195, Entrega 3)", () => {
  it("Nova chave (C3): guarda com quem pode usar e dicas; a lista (C1) e a chave aberta (C2) mostram quem usa e o uso, nunca o valor", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, chaves } = cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const dante = await agenteComConversa(trx, MARLON, { nome: "Dante" });
      const { data } = await criarChave(deps, { appId: "orgo", nome: "ORGO_API_KEY", valor: ` ${SEGREDO} `, quem: [{ agenteId: chico.agenteId, modo: "sempre" }, { agenteId: dante.agenteId, modo: "perguntar" }], dicas: "  só para o computador  de testes ", testadaEm: T0, chaves });
      expect(data).toMatchObject({ nome: "ORGO_API_KEY", app: "Orgo", appId: "orgo", dono: "pessoa", sua: true, testadaEm: T0, dicas: "só para o computador de testes", pedidaPor: null, ultimoUsoEm: null });
      expect(data.quem).toEqual([{ agenteId: chico.agenteId, nome: "Chico", modo: "sempre" }, { agenteId: dante.agenteId, nome: "Dante", modo: "perguntar" }]);

      const lista = (await listarCofre(deps, {})).data;
      expect(lista.chaves?.map((c) => c.id)).toEqual([data.id]);
      const aberta = (await detalheDaChave(deps, { itemId: data.id })).data;
      expect(aberta.uso.map((u) => u.tipo)).toEqual(["guardado"]);
      expect(JSON.stringify([lista, aberta])).not.toMatch(new RegExp(`${SEGREDO}|v2:`));

      // Usar marca o "usada há" e entra no uso recente, com o bot e onde.
      await lerValorParaEntrega(deps, chaves, { itemId: data.id, agenteId: chico.agenteId, onde: "no computador da Orgo" });
      const depois = (await detalheDaChave(deps, { itemId: data.id })).data;
      expect(depois.chave.ultimoUsoEm).not.toBeNull();
      expect(depois.uso[0]).toMatchObject({ tipo: "entregue", agente: "Chico", onde: "no computador da Orgo" });
    });
  });

  it("Nova chave recusa nome que não é variável, variável de sistema, app desconhecido, modo inválido e nome repetido", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, chaves } = cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      for (const nome of ["orgo_api_key", "PATH", "NODE_OPTIONS", "NOD_SEGREDO", "COM ESPACO", ""]) {
        await esperarErro(() => criarChave(deps, { nome, valor: SEGREDO, chaves }), "entrada_invalida");
      }
      await esperarErro(() => criarChave(deps, { appId: "nao-existe", nome: "X_API_KEY", valor: SEGREDO, chaves }), "entrada_invalida");
      await esperarErro(() => criarChave(deps, { nome: "X_API_KEY", valor: SEGREDO, quem: [{ agenteId: chico.agenteId, modo: "talvez" }], chaves }), "entrada_invalida");
      await esperarErro(() => criarChave(deps, { nome: "X_API_KEY", valor: "com\nquebra", chaves }), "entrada_invalida");
      await criarChave(deps, { app: "Exemplo", nome: "X_API_KEY", valor: SEGREDO, chaves });
      await esperarErro(() => criarChave(deps, { app: "Exemplo", nome: "X_API_KEY", valor: SEGREDO, chaves }), "estado_invalido");
      expect((await deps.repos.cofre.listarItens()).map((i) => i.app)).toEqual(["Exemplo"]);
    });
  });

  it("Trocar (C2) cria a versão nova com quem já usava e as dicas; app conhecido só troca testado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, chaves } = cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const { data: v1 } = await criarChave(deps, { appId: "orgo", nome: "ORGO_API_KEY", valor: SEGREDO, quem: [{ agenteId: chico.agenteId, modo: "perguntar" }], dicas: "só testes", testadaEm: T0, chaves });
      await esperarErro(() => trocarChave(deps, { itemId: v1.id, valor: "nova", chaves }), "estado_invalido");
      const { data: v2 } = await trocarChave(deps, { itemId: v1.id, valor: "nova", testadaEm: T0 + 5, chaves });
      expect(v2.id).not.toBe(v1.id);
      expect(v2).toMatchObject({ nome: "ORGO_API_KEY", dicas: "só testes", testadaEm: T0 + 5, quem: [{ agenteId: chico.agenteId, modo: "perguntar" }] });
      expect((await lerValorParaEntrega(deps, chaves, { itemId: v2.id })).valor).toBe("nova");
      await esperarErro(() => detalheDaChave(deps, { itemId: v1.id }), "nao_encontrado");
      // O uso recente segue a corrente das versões: guardado (v1), trocado e entregue (v2).
      expect((await detalheDaChave(deps, { itemId: v2.id })).data.uso.map((u) => u.tipo)).toEqual(["entregue", "trocado", "guardado"]);
    });
  });

  it("Quem pode usar: Sempre, Perguntar antes, tirar; Remover chave tira da lista; outra pessoa não vê nem muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, chaves } = cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const { data } = await criarChave(deps, { app: "Exemplo", nome: "EXEMPLO_TOKEN", valor: SEGREDO, chaves });
      expect((await mudarAcessoDaChave(deps, { itemId: data.id, agenteId: chico.agenteId, modo: "sempre" })).data.quem).toEqual([{ agenteId: chico.agenteId, nome: "Chico", modo: "sempre" }]);
      expect((await mudarAcessoDaChave(deps, { itemId: data.id, agenteId: chico.agenteId, modo: "perguntar" })).data.quem[0]?.modo).toBe("perguntar");
      await esperarErro(() => mudarAcessoDaChave(deps, { itemId: data.id, agenteId: chico.agenteId, modo: "talvez" }), "entrada_invalida");
      expect((await mudarAcessoDaChave(deps, { itemId: data.id, agenteId: chico.agenteId, modo: null })).data.quem).toEqual([]);
      await esperarErro(() => mudarAcessoDaChave(deps, { itemId: data.id, agenteId: chico.agenteId, modo: null }), "nao_encontrado");

      // A chave da pessoa é privada: a Ana não a vê, nem troca, nem remove.
      const ana = cenario(trx, ANA);
      await vincularEscopo(trx, ANA);
      await esperarErro(() => detalheDaChave(ana.deps, { itemId: data.id }), "nao_encontrado");
      await esperarErro(() => removerChave(ana.deps, { itemId: data.id }), "nao_encontrado");
      await vincularEscopo(trx, MARLON);

      await removerChave(deps, { itemId: data.id });
      expect((await listarCofre(deps, {})).data.chaves).toEqual([]);
      await esperarErro(() => removerChave(deps, { itemId: data.id }), "nao_encontrado");
    });
  });

  it("o cartão do alvo app (O4): guarda e concede Sempre ao bot; de novo troca a chave e mantém quem usava; o uso pela Orgo é espaçado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, chaves, avancar } = cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const dante = await agenteComConversa(trx, MARLON, { nome: "Dante" });
      const { data: v1 } = await guardarChaveDoCartao(deps, { app: APPS_DO_COFRE.orgo, agenteId: chico.agenteId, valor: SEGREDO, testadaEm: T0, chaves });
      const aberta = (await detalheDaChave(deps, { itemId: v1.itemId })).data;
      expect(aberta.chave).toMatchObject({ nome: "ORGO_API_KEY", pedidaPor: "Chico", quem: [{ nome: "Chico", modo: "sempre" }] });
      expect(aberta.uso[0]).toMatchObject({ tipo: "guardado", peloCartaoDe: "Chico" });

      // Outro bot pede pelo cartão com a chave já guardada: vira a versão 2, o Chico continua e o Dante entra.
      const { data: v2 } = await guardarChaveDoCartao(deps, { app: APPS_DO_COFRE.orgo, agenteId: dante.agenteId, valor: "outra", testadaEm: T0 + 1, chaves });
      expect((await detalheDaChave(deps, { itemId: v2.itemId })).data.chave.quem.map((q) => `${q.nome}:${q.modo}`)).toEqual(["Chico:sempre", "Dante:sempre"]);

      // A Orgo lê a chave em toda requisição: o uso conta uma vez por intervalo.
      await lerValorParaEntrega(deps, chaves, { itemId: v2.itemId, onde: "no computador da Orgo", espacarUso: true });
      await lerValorParaEntrega(deps, chaves, { itemId: v2.itemId, onde: "no computador da Orgo", espacarUso: true });
      expect((await deps.repos.cofre.eventosDoItem(v2.itemId)).filter((e) => e.tipo === "entregue")).toHaveLength(1);
      avancar(INTERVALO_DO_USO_MS);
      await lerValorParaEntrega(deps, chaves, { itemId: v2.itemId, onde: "no computador da Orgo", espacarUso: true });
      expect((await deps.repos.cofre.eventosDoItem(v2.itemId)).filter((e) => e.tipo === "entregue")).toHaveLength(2);
    });
  });
});
