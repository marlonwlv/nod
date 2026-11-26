import type { SeuComputadorGateway } from "../../fundo/seu-computador.ts";
import type { RespostaSeuComputadorTela, RespostaVistaSeuComputador, VistaSeuComputador } from "../../../contracts/seu-computador.ts";
import { liberadosAgora } from "../../../domain/seu-computador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { Deps } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";

/**
 * O computador da pessoa na tela (ADR-197): Ajustes › Seu Mac (o aparelho que atende, os apps de cada bot, "Tirar") e
 * a aba "Seu Mac" do painel (o último quadro e os passos de um bot). Só a dona vê e mexe nos dela.
 */


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function rotasSeuComputador(o: { dentro: <T>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>; portao: SeuComputadorGateway | null }): Rota[] {
  const lista = async (escopo: Escopo): Promise<RespostaSeuComputadorTela> => {
    const todos = await o.dentro(escopo, (d) => d.repos.seuComputadorApps.daPessoa());
    const agora = Date.now();
    const valendo = new Set(liberadosAgora(todos, agora).map((a) => a.id));
    return {
      aparelho: o.portao?.disponivel(escopo) ?? null,
      apps: todos.filter((a) => (a.ate === null || a.ate > agora) && valendo.has(a.id)).map((a) => ({ agenteId: a.agenteId, plataforma: a.plataforma, id: a.id, nome: a.nome, sempre: a.ate === null, ate: a.ate })),
    };
  };
  return [
    { metodo: "GET", padrao: /^\/seu-computador$/, async handler(ctx) { ctx.json(200, await lista(ctx.escopo)); } },
    {
      metodo: "POST", acao: "seu_computador.tirar_app", padrao: /^\/seu-computador\/tirar$/, async handler(ctx) {
        const c = obj(await ctx.corpo());
        if (Object.keys(c).some((k) => k !== "agenteId" && k !== "appId")) throw new ErroDeDominio("entrada_invalida");
        if (c.agenteId !== undefined && (typeof c.agenteId !== "string" || !UUID.test(c.agenteId))) throw new ErroDeDominio("entrada_invalida");
        if (c.appId !== undefined && (typeof c.appId !== "string" || c.appId.length < 3 || c.appId.length > 400)) throw new ErroDeDominio("entrada_invalida");
        const saiu = await o.dentro(ctx.escopo, (d) => d.repos.seuComputadorApps.tirar({ ...(typeof c.agenteId === "string" ? { agenteId: c.agenteId } : {}), ...(typeof c.appId === "string" ? { appId: c.appId } : {}) }));
        ctx.json(200, { ok: true, saiu, ...(await lista(ctx.escopo)) });
      },
    },
    {
      metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/seu-computador$/, async handler(ctx) {
        const id = ctx.params.id!;
        if (!UUID.test(id)) throw new ErroDeDominio("entrada_invalida");
        const agente = await o.dentro(ctx.escopo, (d) => d.repos.agentes.buscar(id));
        if (!agente || agente.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
        const vista: VistaSeuComputador | null = o.portao?.vista(ctx.escopo, id) ?? null;
        const r: RespostaVistaSeuComputador = { vista, aparelho: o.portao?.disponivel(ctx.escopo) ?? null };
        ctx.json(200, r);
      },
    },
  ];
}
