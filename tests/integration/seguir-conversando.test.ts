import { expect, it } from "vitest";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

/**
 * ADR-191 (definido em 2026-11-20, pedido do dono), no Postgres de verdade: a mensagem nova da pessoa fecha o pedido de
 * acesso aberto como 'dispensada' por ela (a proposta de mesmo id recusada junto), deixa a pergunta de texto aberta e grava
 * a linha do bot ENTRE a mensagem e o turno novo (clock_timestamp), que é o que a põe no histórico dele.
 */
describeIntegracao("mensagem nova com pedido aberto: dispensado pela pessoa", () => {
  it("acesso e proposta fecham, a pergunta de texto fica, e o recibo nasce antes do turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Frida" });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "organize o drive", entradaConfianca: "confiavel", modelo: "m" });
      await repos.turnos.assentar(turno?.id ?? "", { estado: "concluido" });
      const proposta = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "acesso", conector: "googledrive", capacidades: ["LER"], nivel: "leitura", naoPedido: [], ...(turno ? { turnoId: turno.id } : {}) } });
      const acesso = await repos.decisoes.criar({ id: proposta?.id ?? "", tipo: "acesso", agenteId, conversaId, turnoId: turno?.id ?? null, prazoDecisaoEm: Date.now() + 86_400_000, frase: "Frida quer ler seu Google Drive" });
      const pergunta = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: turno?.id ?? null, prazoDecisaoEm: Date.now() + 86_400_000, frase: "qual pasta?" });

      const r = await enviarMensagem(deps, { conversaId, texto: "deixa o drive pra depois", inventario: PRONTO });

      expect(await repos.decisoes.buscar(acesso?.id ?? "")).toMatchObject({ estado: "decidida", desfecho: { tipo: "dispensada", por: PESSOA_MARLON, antes: "pendente" } });
      expect((await repos.propostas.buscar(proposta?.id ?? ""))?.estado).toBe("recusada");
      expect((await repos.decisoes.buscar(pergunta?.id ?? ""))?.estado).toBe("pendente");
      const recibos = (await repos.mensagens.listarDaConversa(conversaId, 50)).filter((m) => m.payload?.kind === "pedido_dispensado");
      expect(recibos).toHaveLength(1);
      const [recibo] = recibos;
      expect(recibo).toMatchObject({ kind: "sistema", payload: { decisaoId: acesso?.id, tipo: "acesso", conector: "googledrive", turnoId: turno?.id, motivo: "seguiu_conversando" } });
      expect(recibo?.texto).toContain("A pessoa seguiu sem responder ao seu pedido: Frida quer ler seu Google Drive.");
      // A ordem no microssegundo do banco (em ms dois instantes podem empatar): mensagem < recibo < turno.
      const [ordem] = await trx<{ depois_da_fala: boolean; antes_do_turno: boolean }[]>`
        select r.criado_em > m.criado_em as depois_da_fala, r.criado_em < t.criado_em as antes_do_turno
        from mensagens r, mensagens m, turnos t
        where r.tenant_id = ${TENANT_PADRAO} and r.id = ${recibo?.id ?? ""} and m.tenant_id = r.tenant_id and m.id = ${r.data.mensagem.id} and t.tenant_id = r.tenant_id and t.id = ${r.data.turno.id}`;
      expect(ordem).toEqual({ depois_da_fala: true, antes_do_turno: true });
      // O assunto (0091) põe a linha no chat (ADR-114): `pedido.dispensado`, destino chat.
      const [{ assunto } = { assunto: null }] = await trx<{ assunto: string | null }[]>`select assunto from mensagens where tenant_id = ${TENANT_PADRAO} and id = ${recibo?.id ?? ""}`;
      expect(assunto).toBe("pedido.dispensado");
      // A segunda mensagem não acha mais nada para dispensar.
      await enviarMensagem(deps, { conversaId, texto: "e outra", inventario: PRONTO });
      expect((await repos.mensagens.listarDaConversa(conversaId, 50)).filter((m) => m.payload?.kind === "pedido_dispensado")).toHaveLength(1);
    });
  });
});
