import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao, RotinaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA r100: pausar e reativar a mesma rotina ao mesmo tempo (duplo clique, tela + chat, retry). O estado final tem de ser
 * um dos dois, com a próxima execução coerente, e cada transição real escreve UMA linha no chat — nunca duas
 * "Rotina pausada"/"ativa" para a mesma mudança.
 */
describeIntegracao("rotina: pausar e reativar concorrentes", () => {
  let srv: ServidorCompleto;
  const agentes: string[] = [];
  const conversas: string[] = [];
  beforeAll(async () => { srv = await servidorCompleto(); });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  });

  async function nova(): Promise<{ id: string; conversaId: string }> {
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: `Corrida ${agentes.length}`, titulo: "QA", descricao: "QA" });
    agentes.push(bot.agente.id);
    conversas.push(bot.conversa.id);
    const criada = await srv.json<RespostaMutacao>("POST", "rotinas", { agenteId: bot.agente.id, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "[[texto: ok]]", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" });
    return { id: criada.ids.rotinaId!, conversaId: bot.conversa.id };
  }

  async function eventos(conversaId: string, rotinaId: string): Promise<string[]> {
    const c = await srv.json<ConversaDto>("GET", `conversas/${conversaId}/mensagens`);
    return c.mensagens.flatMap((m) => {
      const p = m.payload as { kind?: string; rotinaId?: string; acao?: string } | null | undefined;
      return p?.kind === "rotina_evento" && p.rotinaId === rotinaId && (p.acao === "pausada" || p.acao === "ativada") ? [p.acao] : [];
    });
  }

  async function estado(id: string) {
    const r = await srv.json<{ rotinas: RotinaDto[] }>("GET", "rotinas");
    return r.rotinas.find((x) => x.rotina.id === id)!.rotina;
  }

  it("8 pausas simultâneas de uma ativa: pausada e uma única linha de pausa", async () => {
    const { id, conversaId } = await nova();
    const antes = await eventos(conversaId, id);
    const rs = await Promise.all(Array.from({ length: 8 }, () => srv.chamar("POST", `rotinas/${id}/pausar`)));
    expect(rs.map((r) => r.status).every((s) => s === 200)).toBe(true);
    expect((await estado(id)).estado).toBe("pausada");
    expect((await eventos(conversaId, id)).slice(antes.length)).toEqual(["pausada"]);
  });

  it("8 reativações simultâneas de uma pausada: ativa e uma única linha de ativação", async () => {
    const { id, conversaId } = await nova();
    await srv.json("POST", `rotinas/${id}/pausar`);
    const antes = await eventos(conversaId, id);
    const rs = await Promise.all(Array.from({ length: 8 }, () => srv.chamar("POST", `rotinas/${id}/ativar`)));
    expect(rs.map((r) => r.status).every((s) => s === 200)).toBe(true);
    expect((await estado(id)).estado).toBe("ativa");
    expect((await eventos(conversaId, id)).slice(antes.length)).toEqual(["ativada"]);
  });

  it("pausar × ativar ao mesmo tempo, 10 vezes: o chat conta a mesma história que o estado final", async () => {
    const { id, conversaId } = await nova();
    for (let i = 0; i < 10; i++) {
      await Promise.all([srv.chamar("POST", `rotinas/${id}/pausar`), srv.chamar("POST", `rotinas/${id}/ativar`)]);
      const depois = await estado(id);
      expect(["ativa", "pausada"]).toContain(depois.estado);
      if (depois.estado === "ativa") expect(depois.proximaExecucao).toBeGreaterThan(0);
    }
    const linhas = await eventos(conversaId, id);
    // Sem linhas repetidas seguidas: cada linha é uma transição real.
    for (let i = 1; i < linhas.length; i++) expect(linhas[i], `linhas ${linhas.join(",")}`).not.toBe(linhas[i - 1]);
    expect(linhas.at(-1)).toBe((await estado(id)).estado === "ativa" ? "ativada" : "pausada");
  });
});
