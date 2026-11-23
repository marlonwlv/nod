import type { RespostaMutacao } from "../../../contracts/api.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { arquivarTarefa, continuarTarefa, criarTarefa, desarquivarTarefa, detalharTarefa, listarTarefas, reabrirTarefa, renomearTarefa, resolverTarefa, type EscolhaTurnoVivo } from "../../../use-cases/tarefas-acoes.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os anexos do clipe: só uuids; qualquer outro valor é entrada inválida (id de fora nunca chega cru ao Postgres). */
function anexosDo(corpo: Record<string, unknown>): string[] {
  if (corpo.anexos === undefined) return [];
  if (!Array.isArray(corpo.anexos)) throw new ErroDeDominio("entrada_invalida", { cause: "anexos" });
  const anexos = corpo.anexos.filter((a): a is string => typeof a === "string" && UUID.test(a));
  if (anexos.length !== corpo.anexos.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexos" });
  return anexos;
}

/** A versão lida (o ETag): `versao` no corpo ou o cabeçalho If-Match ("3" ou W/"3"). Ausente = sem checagem. */
function versaoDo(corpo: Record<string, unknown>, ifMatch: string | string[] | undefined): number | undefined {
  const bruto = corpo.versao ?? (typeof ifMatch === "string" ? ifMatch.replace(/^W\//, "").replace(/"/g, "") : undefined);
  if (bruto === undefined) return undefined;
  const n = typeof bruto === "number" ? bruto : typeof bruto === "string" && /^\d{1,9}$/.test(bruto) ? Number(bruto) : NaN;
  if (!Number.isInteger(n) || n < 1) throw new ErroDeDominio("entrada_invalida", { cause: "versao" });
  return n;
}

function escolhaDo(corpo: Record<string, unknown>): EscolhaTurnoVivo | undefined {
  if (corpo.turnoVivo === undefined) return undefined;
  if (corpo.turnoVivo === "parar" || corpo.turnoVivo === "manter") return corpo.turnoVivo;
  throw new ErroDeDominio("entrada_invalida", { cause: "turnoVivo" });
}

/**
 * ADR-192 (definido em 2026-11-22, etapa 3): as rotas da Tarefa como objetivo. A lista e o detalhe trazem o estado do
 * objetivo e, à parte, a atividade; as mutações registram autoria e versão. O frame `tarefa.mudou` diz o que mudou e a
 * web relê por aqui. As rotas de `trabalhos/*` continuam (adaptador legado).
 */
export function criarRotasTarefas(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  const responder = (r: { tarefa: { id: string; versao: number } }) => {
    const resposta: RespostaMutacao & typeof r = { ok: true, ids: { tarefa: r.tarefa.id }, ...r };
    return resposta;
  };
  return [
    {
      metodo: "GET",
      padrao: /^\/tarefas$/,
      async handler(ctx) {
        const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
        const agenteId = q.get("agenteId");
        if (agenteId !== null && !UUID.test(agenteId)) throw new ErroDeDominio("nao_encontrado");
        const estado = q.get("estado");
        ctx.json(200, await executar(ctx.escopo, listarTarefas, { ...(agenteId ? { agenteId } : {}), ...(estado ? { estado } : {}), arquivadas: q.get("arquivadas") === "1" || q.get("arquivadas") === "true" }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/tarefas/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, detalharTarefa, { tarefaId: ctx.params.id ?? "" }));
      },
    },
    {
      // "+ Nova tarefa": a primeira mensagem é o pedido; Tarefa + Thread + trabalho + primeiro turno numa transação.
      metodo: "POST", acao: "tarefas.criar",
      padrao: new RegExp(`^/agentes/${ID}/tarefas$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const agenteId = ctx.params.id ?? "";
        if (!UUID.test(agenteId)) throw new ErroDeDominio("nao_encontrado");
        const cabecalho = ctx.req.headers["idempotency-key"];
        const chaveIdempotencia = typeof corpo.chave === "string" ? corpo.chave : typeof cabecalho === "string" ? cabecalho : null;
        const r = await executar(ctx.escopo, criarTarefa, { agenteId, texto: texto(corpo.texto), levarConversa: corpo.levarConversa === true, anexos: anexosDo(corpo), chaveIdempotencia });
        const resposta: RespostaMutacao & typeof r = { ok: true, ids: { tarefa: r.tarefa.id, trabalho: r.trabalhoId, turno: r.turnoId, ...(r.thread ? { thread: r.thread.id } : {}) }, ...r };
        ctx.json(201, resposta);
      },
    },
    {
      // Continuar: a fala entra na Thread — no turno vivo, se houver; senão vira o próximo.
      metodo: "POST", acao: "tarefas.enviar",
      padrao: new RegExp(`^/tarefas/${ID}/mensagens$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, continuarTarefa, { tarefaId: ctx.params.id ?? "", texto: texto(corpo.texto), anexos: anexosDo(corpo) });
        ctx.json(201, { ok: true, ids: { tarefa: r.tarefa.id, turno: r.turnoId }, ...r });
      },
    },
    {
      metodo: "POST", acao: "tarefas.resolver",
      padrao: new RegExp(`^/tarefas/${ID}/resolver$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const versao = versaoDo(corpo, ctx.req.headers["if-match"]);
        const turnoVivo = escolhaDo(corpo);
        ctx.json(200, responder(await executar(ctx.escopo, resolverTarefa, { tarefaId: ctx.params.id ?? "", ...(versao !== undefined ? { versao } : {}), ...(turnoVivo ? { turnoVivo } : {}) })));
      },
    },
    {
      metodo: "POST", acao: "tarefas.reabrir",
      padrao: new RegExp(`^/tarefas/${ID}/reabrir$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const versao = versaoDo(corpo, ctx.req.headers["if-match"]);
        ctx.json(200, responder(await executar(ctx.escopo, reabrirTarefa, { tarefaId: ctx.params.id ?? "", ...(versao !== undefined ? { versao } : {}) })));
      },
    },
    {
      metodo: "POST", acao: "tarefas.arquivar",
      padrao: new RegExp(`^/tarefas/${ID}/arquivar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const versao = versaoDo(corpo, ctx.req.headers["if-match"]);
        const turnoVivo = escolhaDo(corpo);
        ctx.json(200, responder(await executar(ctx.escopo, arquivarTarefa, { tarefaId: ctx.params.id ?? "", ...(versao !== undefined ? { versao } : {}), ...(turnoVivo ? { turnoVivo } : {}) })));
      },
    },
    {
      metodo: "POST", acao: "tarefas.desarquivar",
      padrao: new RegExp(`^/tarefas/${ID}/desarquivar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const versao = versaoDo(corpo, ctx.req.headers["if-match"]);
        ctx.json(200, responder(await executar(ctx.escopo, desarquivarTarefa, { tarefaId: ctx.params.id ?? "", ...(versao !== undefined ? { versao } : {}) })));
      },
    },
    {
      metodo: "POST", acao: "tarefas.renomear",
      padrao: new RegExp(`^/tarefas/${ID}/titulo$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, responder(await executar(ctx.escopo, renomearTarefa, { tarefaId: ctx.params.id ?? "", titulo: texto(corpo.titulo) })));
      },
    },
  ];
}
