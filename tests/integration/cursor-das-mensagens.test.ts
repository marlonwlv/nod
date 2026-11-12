import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { lerMensagensDesde } from "../../src/use-cases/mensagens-desde.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

async function numeros(trx: Tx, id: string): Promise<{ seq: number; updated_seq: number }> {
  const [l] = await trx<{ seq: string; updated_seq: string }[]>`select seq, updated_seq from mensagens where id = ${id}`;
  if (!l) throw new Error("mensagem não achada");
  return { seq: Number(l.seq), updated_seq: Number(l.updated_seq) };
}

describeIntegracao("cursor por conversa (0175)", () => {
  it("seq e updated_seq crescem na criação; edição e reação sobem só o updated_seq", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = { conversaId, confianca: "confiavel" as const };
      const a = await repos.mensagens.criar({ ...base, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "oi" });
      const b = await repos.mensagens.criar({ ...base, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "olá" });
      const na = await numeros(trx, a!.id), nb = await numeros(trx, b!.id);
      expect(na.seq).toBe(na.updated_seq);
      expect(nb.seq).toBeGreaterThan(na.seq);

      expect(await repos.mensagens.marcarParcial(a!.id, true)).toBe(true);
      const na2 = await numeros(trx, a!.id);
      expect(na2.seq).toBe(na.seq);
      expect(na2.updated_seq).toBeGreaterThan(nb.updated_seq);

      expect(await repos.reacoes.por({ conversaId, mensagemId: b!.id, emoji: "👍" })).toBe(true);
      const nb2 = await numeros(trx, b!.id);
      expect(nb2.seq).toBe(nb.seq);
      expect(nb2.updated_seq).toBeGreaterThan(na2.updated_seq);
      expect(await repos.reacoes.tirar({ mensagemId: b!.id, emoji: "👍" })).toBe(true);
      expect((await numeros(trx, b!.id)).updated_seq).toBeGreaterThan(nb2.updated_seq);
    });
  });

  it("GET com depois_de devolve só o que mudou, na ordem; geração diferente ou cursor do futuro é cursor_velho", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = { conversaId, confianca: "confiavel" as const, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto" as const };
      const a = await repos.mensagens.criar({ ...base, texto: "um" });
      const pagina = (await executar(deps, lerConversa, { conversaId })).data;
      expect(pagina.cursor).toEqual({ geracao: 1, updated_seq: (await numeros(trx, a!.id)).updated_seq });
      const cursor = pagina.cursor!;

      const vazio = (await executar(deps, lerMensagensDesde, { conversaId, depoisDe: cursor.updated_seq, geracao: 1 })).data;
      expect(vazio).toEqual({ cursor_velho: false, cursor, mensagens: [] });

      const b = await repos.mensagens.criar({ ...base, texto: "dois" });
      await repos.mensagens.marcarParcial(a!.id, true);
      const r = (await executar(deps, lerMensagensDesde, { conversaId, depoisDe: cursor.updated_seq, geracao: 1 })).data;
      if (r.cursor_velho) throw new Error("não devia ser cursor velho");
      expect(r.mensagens.map((m) => m.id)).toEqual([b!.id, a!.id]);
      expect(r.mensagens[1]).toMatchObject({ parcial: true, texto: "um" });
      expect(r.cursor.updated_seq).toBe(r.mensagens[1]!.updated_seq);

      expect((await executar(deps, lerMensagensDesde, { conversaId, depoisDe: 0, geracao: 2 })).data).toMatchObject({ cursor_velho: true, cursor: { geracao: 1 } });
      expect((await executar(deps, lerMensagensDesde, { conversaId, depoisDe: r.cursor.updated_seq + 1_000, geracao: 1 })).data.cursor_velho).toBe(true);
      await esperarErro(() => executar(deps, lerMensagensDesde, { conversaId: randomUUID(), depoisDe: 0, geracao: 1 }), "nao_encontrado");
    });
  });

  it("a decisão decidida toca o cartão dela (payload.decisaoId)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const d = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: null, prazoDecisaoEm: Date.now() + 60_000, frase: "Sim ou não?" });
      const cartao = await repos.mensagens.criar({ conversaId, confianca: "confiavel", autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "sistema", texto: "Sim ou não?", payload: { kind: "pedido_a_pessoa", decisaoId: d!.id } });
      const antes = await numeros(trx, cartao!.id);
      const outra = await repos.mensagens.criar({ conversaId, confianca: "confiavel", autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "depois" });
      expect(await repos.decisoes.decidir(d!.id, { por: PESSOA_MARLON, agora: Date.now() })).not.toBeNull();
      const depois = await numeros(trx, cartao!.id);
      expect(depois.seq).toBe(antes.seq);
      expect(depois.updated_seq).toBeGreaterThan((await numeros(trx, outra!.id)).updated_seq);
    });
  });
});
