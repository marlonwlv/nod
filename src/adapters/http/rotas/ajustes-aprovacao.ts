import { apagarRegraRevisor, criarRegraRevisor, definirNivelFerramenta, definirSoLeitura, definirTetoModo, editarRegraRevisor, lerAjustesAprovacao } from "../../../use-cases/ajustes-aprovacao.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * Ajustes > Aprovações (definido em 2026-11-12, ADR-166). A tela lê tudo de uma vez (`GET /aprovacoes/ajustes?agente=`) e
 * cada mudança é uma rota com o id do registro (`aprovacoes.*`, sem caminho no chat). `admins` = NOD_ADMINS, lida na borda.
 */
export function criarRotasAjustesAprovacao(d: DepsRotas, admins: readonly string[]): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET", padrao: /^\/aprovacoes\/ajustes$/,
      async handler(ctx) {
        const agente = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("agente");
        ctx.json(200, await executar(ctx.escopo, lerAjustesAprovacao, { agenteId: agente ?? null, admins }));
      },
    },
    {
      metodo: "POST", acao: "aprovacoes.criar_regra", padrao: /^\/aprovacoes\/regras$/,
      async handler(ctx) {
        const c = corpoObjeto(await ctx.corpo());
        ctx.json(201, await executar(ctx.escopo, criarRegraRevisor, { agenteId: c.agenteId, lista: c.lista, texto: c.texto, origem: c.origem }));
      },
    },
    {
      metodo: "PATCH", acao: "aprovacoes.editar_regra", padrao: new RegExp(`^/aprovacoes/regras/${ID}$`),
      async handler(ctx) {
        const c = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, editarRegraRevisor, { regraId: ctx.params.id ?? "", texto: c.texto }));
      },
    },
    {
      metodo: "DELETE", acao: "aprovacoes.apagar_regra", padrao: new RegExp(`^/aprovacoes/regras/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, apagarRegraRevisor, { regraId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "aprovacoes.nivel_ferramenta", padrao: /^\/aprovacoes\/niveis$/,
      async handler(ctx) {
        const c = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, definirNivelFerramenta, { agenteId: c.agenteId, conector: c.conector, ferramenta: c.ferramenta, tipo: c.tipo, nivel: c.nivel }));
      },
    },
    {
      metodo: "POST", acao: "aprovacoes.so_leitura", padrao: new RegExp(`^/agentes/${ID}/so-leitura$`),
      async handler(ctx) {
        const c = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, definirSoLeitura, { agenteId: ctx.params.id ?? "", soLeitura: c.soLeitura }));
      },
    },
    {
      metodo: "POST", acao: "aprovacoes.teto", padrao: /^\/aprovacoes\/teto$/,
      async handler(ctx) {
        const c = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, definirTetoModo, { teto: c.teto ?? null, admins }));
      },
    },
  ];
}
