import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { TokensMcpDto } from "../../src/contracts/mcp.ts";
import { ROTINAS_POR_AGENTE } from "../../src/shared/constantes.ts";
import { TOKENS_MCP_VIVOS_MAX } from "../../src/use-cases/tokens-mcp.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";

/**
 * QA-169: os tetos de quantidade contavam e gravavam sem trava. Pedidos ao mesmo tempo passavam do teto: 25 "Gerar token"
 * em paralelo deixavam 22 tokens MCP vivos (teto 20), e 6 rotinas novas num bot com 48 deixavam 54 (teto 50).
 */
describeIntegracao("tetos de quantidade com pedidos em paralelo (HTTP real)", () => {
  let srv: ServidorCompleto;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto();
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  });

  it("25 tokens MCP gerados ao mesmo tempo: só 20 ficam vivos, o resto é limite_atingido", async () => {
    const rs = await Promise.allSettled(Array.from({ length: TOKENS_MCP_VIVOS_MAX + 5 }, (_, i) => srv.json("POST", "mcp/tokens", { nome: `paralelo ${i}` })));
    const lista = await srv.json<TokensMcpDto>("GET", "mcp/tokens");
    expect(lista.tokens.filter((t) => t.revogadoEm === null)).toHaveLength(TOKENS_MCP_VIVOS_MAX);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(TOKENS_MCP_VIVOS_MAX);
    for (const r of rs) if (r.status === "rejected") expect(String(r.reason)).toContain("limite_atingido");
    for (const t of lista.tokens) await srv.json("DELETE", `mcp/tokens/${t.id}`);
  });

  it("6 rotinas criadas ao mesmo tempo num bot com 48: o bot fica com 50", async () => {
    const b = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Teto em paralelo" });
    agentes.push(b.agente.id);
    conversas.push(b.conversa.id);
    const corpo = { agenteId: b.agente.id, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };
    for (let i = 0; i < ROTINAS_POR_AGENTE - 2; i++) await srv.json("POST", "rotinas", corpo);
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => srv.json("POST", "rotinas", corpo)));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const { rotinas } = await srv.json<{ rotinas: { rotina: { agenteId: string } }[] }>("GET", "rotinas");
    expect(rotinas.filter((r) => r.rotina.agenteId === b.agente.id)).toHaveLength(ROTINAS_POR_AGENTE);
  });
});
