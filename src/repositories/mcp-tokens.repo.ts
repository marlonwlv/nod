import type { TokenMcpDto } from "../contracts/mcp.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  nome: string;
  prefixo: string;
  cliente: string | null;
  criado_em: Date;
  ultimo_uso_em: Date | null;
  revogado_em: Date | null;
}

/** Uma linha de `mcp_acoes` (0174) para a Atividade do bot. */
export type LinhaAcaoMcp = { id: string; resumo: string; cliente: string; criado_em: Date };

/** Como a chave de máquina (NOD-293 A8): `ultimo_uso_em` atrasa até isto; cada chamada MCP não vira um UPDATE. */
export const MARCAR_USO_MCP_A_CADA_MS = 30_000;

const COLUNAS = "id, nome, prefixo, cliente, criado_em, ultimo_uso_em, revogado_em";
const paraDto = (l: Linha): TokenMcpDto => ({ id: l.id, nome: l.nome, prefixo: l.prefixo, cliente: l.cliente, criadoEm: ms(l.criado_em), ultimoUsoEm: msOuNull(l.ultimo_uso_em), revogadoEm: msOuNull(l.revogado_em) });

/**
 * Tokens do servidor MCP da pessoa (0173). Guarda só o hash; NENHUM método devolve o hash para fora do repositório
 * exceto `buscarVivoPorHash`, que existe só para a comparação em tempo constante. Sob RLS a pessoa só vê os dela
 * (owner_id), e o WHERE repete isso (segunda camada, ADR-003).
 */
export function mcpTokensRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(e: { nome: string; prefixo: string; hash: Buffer }): Promise<TokenMcpDto | null> {
      const [l] = await conn<Linha[]>`
        insert into mcp_tokens (tenant_id, owner_id, nome, prefixo, hash)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.nome}, ${e.prefixo}, ${e.hash})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDto(l) : null;
    },

    async listar(): Promise<TokenMcpDto[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from mcp_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        order by criado_em desc`;
      return linhas.map(paraDto);
    },

    /** Revogar é idempotente: a primeira data fica. false = o token não existe (ou é de outra pessoa). */
    async revogar(id: string, agora: number): Promise<boolean> {
      const linhas = await conn`
        update mcp_tokens set revogado_em = coalesce(revogado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning id`;
      return linhas.length > 0;
    },

    async buscarVivoPorHash(hash: Buffer): Promise<{ id: string; hash: Buffer } | null> {
      const [l] = await conn<{ id: string; hash: Buffer }[]>`
        select id, hash from mcp_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and hash = ${hash} and revogado_em is null`;
      return l ?? null;
    },

    /**
     * Grava o último uso (e o cliente, quando ele se anunciou) no máximo uma vez a cada MARCAR_USO_MCP_A_CADA_MS; o
     * cliente que mudou grava na hora. true = gravou.
     */
    async marcarUso(id: string, agora: number, cliente: string | null): Promise<boolean> {
      const r = await conn`update mcp_tokens set ultimo_uso_em = ${data(agora)}, cliente = coalesce(${cliente}, cliente)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and (ultimo_uso_em is null or ultimo_uso_em < ${data(agora - MARCAR_USO_MCP_A_CADA_MS)} or (${cliente}::text is not null and cliente is distinct from ${cliente}))
        returning id`;
      return r.length > 0;
    },

    /**
     * 0174: o que o cliente MCP mudou, para a Atividade do bot. `cliente` sai do próprio token (o nome do initialize ou,
     * sem ele, o nome dado nos Ajustes) na hora da gravação. Token de outra pessoa (ou que não existe): não grava.
     */
    async registrarAcao(a: { tokenId: string; agenteId: string | null; ferramenta: string; resumo: string }): Promise<boolean> {
      const r = await conn`
        insert into mcp_acoes (tenant_id, owner_id, token_id, agente_id, ferramenta, resumo, cliente)
        select ${escopo.tenantId}, ${escopo.pessoaId}, t.id, ${a.agenteId}, ${a.ferramenta.slice(0, 60)}, ${a.resumo.slice(0, 200)}, left(coalesce(t.cliente, t.nome), 80)
        from mcp_tokens t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.id = ${a.tokenId}
        returning id`;
      return r.length > 0;
    },

    async acoesDoDia(agenteId: string, f: { ini: Date; fim: Date }, limite: number): Promise<LinhaAcaoMcp[]> {
      return conn<LinhaAcaoMcp[]>`
        select id, resumo, cliente, criado_em from mcp_acoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId}
          and criado_em >= ${f.ini} and criado_em < ${f.fim}
        order by criado_em desc, id desc limit ${limite}`;
    },

    async contarAcoesDoDia(agenteId: string, f: { ini: Date; fim: Date }): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from mcp_acoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId}
          and criado_em >= ${f.ini} and criado_em < ${f.fim}`;
      return l?.n ?? 0;
    },
  };
}
