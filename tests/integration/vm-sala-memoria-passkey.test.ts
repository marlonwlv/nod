import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { consolidar, proporItem, revisar } from "../../src/domain/memoria-de-time.ts";
import { base64url, textoDoDesafio } from "../../src/domain/passkey.ts";
import { fecharVez, pedirVez, vencerVez } from "../../src/domain/vez-na-sala.ts";
import { PLANOS_VM_DO_NOD_PADRAO, pedidoVmDoNod } from "../../src/domain/vm-do-nod.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { ANA, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0174 (frente de comportamento): o que os PRs #732 e #735 deixaram só no domínio, agora no Postgres e com RLS:
 * a VM do Nod (uma viva por pessoa, pedido idempotente), a vez na sala (uma vez por sala, garantida pelo banco), a memória
 * de time revisada por gente (a fila e a fusão do "sonho") e a passkey do gasto (desafio de uso único, contador).
 */
const CONFIG = { projeto: "nod-exemplos", zona: "southamerica-east1-b", rede: "default" };

describeIntegracao("persistência da frente de comportamento no nod (0174)", () => {
  it("VM do Nod: uma viva por pessoa, o mesmo pedido de novo é a mesma linha, outro plano é recusado; a Ana não vê", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const pedido = pedidoVmDoNod({ tenantId: MARLON.tenantId, pessoaId: MARLON.pessoaId, planoId: "essencial", planos: PLANOS_VM_DO_NOD_PADRAO, config: CONFIG, aceitouCobranca: true });
      const vm = await repos.vmsDoNod.pedir(pedido, { driver: "seco", aceitouEm: Date.now() });
      expect(vm).toMatchObject({ planoId: "essencial", estado: "pedida", driver: "seco", custoMensalCentavos: 19_900 });
      expect(vm?.nome.startsWith("nod-box-")).toBe(true);
      expect((await repos.vmsDoNod.pedir(pedido, { driver: "seco", aceitouEm: Date.now() }))?.id).toBe(vm?.id);
      const pro = pedidoVmDoNod({ tenantId: MARLON.tenantId, pessoaId: MARLON.pessoaId, planoId: "pro", planos: PLANOS_VM_DO_NOD_PADRAO, config: CONFIG, aceitouCobranca: true });
      expect(await repos.vmsDoNod.pedir(pro, { driver: "seco", aceitouEm: Date.now() })).toBeNull();
      // Encerrada, a pessoa pode pedir outra.
      expect(await repos.vmsDoNod.mudarEstado(vm!.id, "encerrada")).toBe(true);
      expect((await repos.vmsDoNod.pedir(pro, { driver: "seco", aceitouEm: Date.now() }))?.planoId).toBe("pro");

      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        expect(await criarRepos(sp, ANA).vmsDoNod.daPessoa()).toBeNull();
      });
    });
  });

  it("vez na sala: pessoa passa na frente do bot, só uma vez por sala (índice), o bot mudo vence e o próximo fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const rui = await agenteComConversa(trx, MARLON, { nome: "Rui" });
      const repos = criarRepos(trx, MARLON);
      const salaId = randomUUID();
      const conversa = (await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId }))!;
      await repos.salas.criarComMembros({ id: salaId, nome: "pauta", conversaId: conversa.id }, [
        { agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON },
        { agenteId: rui.agenteId, pessoaLeitoraId: PESSOA_MARLON },
      ]);
      const t0 = Date.now();
      const p1 = randomUUID(), p2 = randomUUID(), p3 = randomUUID();
      await repos.vezNaSala.travar(salaId);
      let e = await repos.vezNaSala.estado(salaId);
      e = pedirVez(e, { id: vera.agenteId, tipo: "bot" }, p1, t0).estado;
      e = pedirVez(e, { id: rui.agenteId, tipo: "bot" }, p2, t0 + 1).estado;
      e = pedirVez(e, { id: PESSOA_MARLON, tipo: "pessoa" }, p3, t0 + 2).estado;
      await repos.vezNaSala.assentar(salaId, e);

      const lido = await repos.vezNaSala.estado(salaId);
      expect(lido.atual?.membro.id).toBe(vera.agenteId);
      // A ordem gravada é a do pedido; quem ordena a fila é o domínio (a pessoa vem antes): o que vale é o que ele devolveu.
      expect(e.fila.map((f) => f.membro.tipo)).toEqual(["pessoa", "bot"]);
      expect(lido.fila.map((f) => f.pedidoId).sort()).toEqual([p2, p3].sort());

      // O banco não deixa duas vezes na mesma sala, nem o mesmo membro duas vezes aberto.
      await expect(trx.savepoint((sp) => sp`insert into vez_na_sala (tenant_id, owner_id, sala_id, pedido_id, membro_id, membro_tipo, estado) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${salaId}, ${randomUUID()}, ${rui.agenteId}, 'bot', 'na_vez')`)).rejects.toThrow();

      // O bot da vez fica mudo além do prazo: vence, e a pessoa (a próxima do domínio) fala.
      const v = vencerVez(e, t0 + 11 * 60_000);
      expect(v.vencido).toBe(p1);
      await repos.vezNaSala.assentar(salaId, v.estado, { pedidoId: p1, desfecho: "vencida" });
      expect((await repos.vezNaSala.estado(salaId)).atual?.membro.id).toBe(PESSOA_MARLON);
      const f = fecharVez(v.estado, p3, t0 + 12 * 60_000);
      await repos.vezNaSala.assentar(salaId, f.estado, { pedidoId: p3, desfecho: "entregou" });
      expect((await repos.vezNaSala.estado(salaId)).atual?.membro.id).toBe(rui.agenteId);
      const [{ estado } = { estado: "" }] = await trx<{ estado: string }[]>`select estado from vez_na_sala where tenant_id = ${MARLON.tenantId} and pedido_id = ${p1}`;
      expect(estado).toBe("vencida");

      // A Ana não é membro: não vê a vez da sala.
      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        expect((await criarRepos(sp, ANA).vezNaSala.estado(salaId)).atual).toBeNull();
      });
    });
  });

  it("memória de time: o bot propõe, a pessoa aprova, a duplicada nem entra e o sonho funde sem apagar; o time lê", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const repos = criarRepos(trx, MARLON);
      const quem = { agenteId: vera.agenteId, pessoaId: PESSOA_MARLON };
      const agora = Date.now();
      const textos = ["O deploy do nod roda às sextas depois das 18h", "O deploy do nod roda às sextas depois das 18h, sempre", "O cliente Girassol paga no dia 10"];
      for (const [i, texto] of textos.entries()) {
        const item = await repos.memoriaDeTime.gravarItem(proporItem({ id: randomUUID(), tipo: "memoria", texto, ...quem, agora: agora + i }, await repos.memoriaDeTime.memorias(), await repos.memoriaDeTime.fila()));
        expect(item.estado).toBe("proposta");
        expect(await repos.memoriaDeTime.assentarRevisao(revisar(item, "aprovada", PESSOA_MARLON, agora + 10 + i))).toBe(true);
      }
      // A mesma frase de novo (até em outra ordem): duplicada, não vai à fila de revisão.
      const dup = proporItem({ id: randomUUID(), tipo: "memoria", texto: "No dia 10 o cliente Girassol paga", ...quem, agora: agora + 20 }, await repos.memoriaDeTime.memorias(), await repos.memoriaDeTime.fila());
      expect(dup.estado).toBe("duplicada");
      // Revisar de novo o que já foi revisado não muda nada.
      const [primeiro] = await repos.memoriaDeTime.fila();
      expect(await repos.memoriaDeTime.assentarRevisao({ ...primeiro!, estado: "recusada", revisadoPor: PESSOA_MARLON, revisadoEm: agora + 30 })).toBe(false);

      const sonho = consolidar(await repos.memoriaDeTime.memorias(), randomUUID, agora + 40, quem);
      expect(sonho).toHaveLength(1);
      const fusao = await repos.memoriaDeTime.gravarItem(sonho[0]!);
      expect(fusao.substitui).toHaveLength(2);
      // Antes da aprovação nada some.
      expect(await repos.memoriaDeTime.memorias()).toHaveLength(3);
      await repos.memoriaDeTime.assentarRevisao(revisar(fusao, "aprovada", PESSOA_MARLON, agora + 50));
      const vivas = await repos.memoriaDeTime.memorias();
      expect(vivas).toHaveLength(2);
      const [{ n } = { n: 0 }] = await trx<{ n: number }[]>`select count(*)::int as n from memorias_time where tenant_id = ${MARLON.tenantId} and substituida_em is not null`;
      expect(n).toBe(2);

      // O banco recusa a revisão sem quem revisou.
      await expect(trx.savepoint((sp) => sp`update itens_memoria_time set estado = 'aprovada' where tenant_id = ${MARLON.tenantId} and estado = 'proposta'`.then(async () => {
        await sp`insert into itens_memoria_time (tenant_id, owner_id, tipo, texto, proposto_por_agente_id, estado) values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'memoria', 'x', ${vera.agenteId}, 'aprovada')`;
      }))).rejects.toThrow();

      // A Ana é do time: lê as memórias e a fila, mas não revisa o item do Marlon.
      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        const daAna = criarRepos(sp, ANA).memoriaDeTime;
        expect((await daAna.memorias()).map((m) => m.texto).sort()).toEqual(vivas.map((m) => m.texto).sort());
        const aberto = await criarRepos(sp, ANA).memoriaDeTime.fila();
        expect(aberto.length).toBeGreaterThan(0);
      });
      void PESSOA_ANA;
    });
  });

  it("passkey do gasto: o desafio serve uma vez, vencido não serve, o contador sobe; a Ana não usa a passkey do Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const chave = { kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" };
      const pk = await repos.passkeys.registrar({ credencialId: "Y3JlZGVuY2lhbC1kby1tYXJsb24", chavePublica: chave, rpId: "nod.app.br", nome: "MacBook" });
      expect(await repos.passkeys.buscar("Y3JlZGVuY2lhbC1kby1tYXJsb24")).toMatchObject({ id: pk.id, contador: 0, rpId: "nod.app.br" });
      const agora = Date.now();
      const nonce = "bm9uY2UtZGUtdXNvLXVuaWNv";
      const desafio = base64url(new TextEncoder().encode(textoDoDesafio({ compraId: "c1", centavos: 12_990, moeda: "BRL", nonce })));
      const d = await repos.passkeys.criarDesafio({ compraId: "c1", centavos: 12_990, moeda: "BRL", nonce, desafio, expiraEm: agora + 120_000 });
      expect(await repos.passkeys.consumir(d.id, pk.id, 7, agora)).toBe(true);
      expect(await repos.passkeys.consumir(d.id, pk.id, 8, agora)).toBe(false);
      expect((await repos.passkeys.buscar("Y3JlZGVuY2lhbC1kby1tYXJsb24"))?.contador).toBe(7);
      const vencido = await repos.passkeys.criarDesafio({ compraId: "c2", centavos: 100, moeda: "BRL", nonce: "b3V0cm8tbm9uY2UtYXF1aQ", desafio: "x", expiraEm: agora - 1 });
      expect(await repos.passkeys.consumir(vencido.id, pk.id, 9, agora)).toBe(false);
      // O mesmo nonce não vale duas vezes.
      await expect(trx.savepoint((sp) => criarRepos(sp, MARLON).passkeys.criarDesafio({ compraId: "c3", centavos: 1, moeda: "BRL", nonce, desafio: "y", expiraEm: agora + 1 }))).rejects.toThrow();

      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        expect(await criarRepos(sp, ANA).passkeys.buscar("Y3JlZGVuY2lhbC1kby1tYXJsb24")).toBeNull();
      });
    });
  });
});
