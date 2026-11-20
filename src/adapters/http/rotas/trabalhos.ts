import type { RespostaMutacao } from "../../../contracts/api.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { abrirTarefaDaPessoa, fazerAqui, fazerDepois, mensagemParaTrabalho } from "../../../use-cases/coordenar-trabalhos.ts";
import { cobrarEspera, desistirDaEspera } from "../../../use-cases/esperas-de-colega.ts";
import { detalharTrabalho, encerrarTrabalho, listarTrabalhos, pararTrabalho, renomearTrabalho } from "../../../use-cases/trabalhos.ts";
import { registrarLinhas, taxasDasLinhas } from "../../../use-cases/telemetria-linhas.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** O `agenteId` da query só segue se for uuid (id de fora nunca chega cru ao Postgres, AGENTS.md). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trabalhos do bot (definido em 2026-10-07, ADR-083 §8): a faixa, a gaveta, "Todos os trabalhos" e a tela da task.
 * O estado vivo chega pelo frame `trabalho.mudou`; a web relê por aqui.
 */
export function criarRotasTrabalhos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/trabalhos$/,
      async handler(ctx) {
        const agenteId = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("agenteId");
        if (agenteId !== null && !UUID.test(agenteId)) throw new ErroDeDominio("nao_encontrado");
        ctx.json(200, await executar(ctx.escopo, listarTrabalhos, agenteId ? { agenteId } : {}));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/trabalhos/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, detalharTrabalho, { trabalhoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "trabalhos.parar",
      padrao: new RegExp(`^/trabalhos/${ID}/parar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, pararTrabalho, { trabalhoId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao & { trabalho: typeof r.trabalho; interrompidos: number; recadosGuardados: number } = { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho, interrompidos: r.interrompidos, recadosGuardados: r.recadosGuardados };
        ctx.json(200, resposta);
      },
    },
    {
      // ADR-187 §6 (2026-11-18, Paper 4l): "Encerrar a tarefa" — a parada (ou que falhou) passa a terminada.
      metodo: "POST", acao: "trabalhos.encerrar",
      padrao: new RegExp(`^/trabalhos/${ID}/encerrar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, encerrarTrabalho, { trabalhoId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao & { trabalho: typeof r.trabalho } = { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho };
        ctx.json(200, resposta);
      },
    },
    {
      // ADR-187 §6 (2026-11-18): a pessoa renomeia a tarefa na aba (duplo clique no nome ou "Renomear" no menu dela).
      metodo: "POST", acao: "trabalhos.renomear",
      padrao: new RegExp(`^/trabalhos/${ID}/titulo$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, renomearTrabalho, { trabalhoId: ctx.params.id ?? "", titulo: texto(corpo.titulo) });
        const resposta: RespostaMutacao & { trabalho: typeof r.trabalho } = { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho };
        ctx.json(200, resposta);
      },
    },
    {
      // ADR-187 §7 (2026-11-18): a pessoa abre uma tarefa pela tela (⌘N, o "+" da aba); a primeira mensagem é o pedido.
      metodo: "POST", acao: "trabalhos.abrir",
      padrao: new RegExp(`^/agentes/${ID}/trabalhos$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const agenteId = ctx.params.id ?? "";
        if (!UUID.test(agenteId)) throw new ErroDeDominio("nao_encontrado");
        // Validação de 2026-11-18: os anexos do clipe do campo da tarefa nova (ids soltos da conversa do bot).
        const anexos = Array.isArray(corpo.anexos) ? corpo.anexos.filter((a): a is string => typeof a === "string" && UUID.test(a)) : [];
        if (Array.isArray(corpo.anexos) && anexos.length !== corpo.anexos.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexos" });
        const r = await executar(ctx.escopo, abrirTarefaDaPessoa, { agenteId, texto: texto(corpo.texto), levarConversa: corpo.levarConversa === true, anexos });
        const resposta: RespostaMutacao & { trabalho: typeof r.trabalho } = { ok: true, ids: { trabalho: r.trabalho.id, turno: r.turnoId }, trabalho: r.trabalho };
        ctx.json(201, resposta);
      },
    },
    {
      // A pessoa escreve na tela da task: entra no meio do trabalho se ele roda, senão vira o próximo passo dele.
      metodo: "POST", acao: "trabalhos.enviar",
      padrao: new RegExp(`^/trabalhos/${ID}/mensagens$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        // ADR-187 §6 (2026-11-18): os anexos do clipe do campo da tarefa (ids soltos da conversa do trabalho).
        const anexos = Array.isArray(corpo.anexos) ? corpo.anexos.filter((a): a is string => typeof a === "string" && UUID.test(a)) : [];
        if (Array.isArray(corpo.anexos) && anexos.length !== corpo.anexos.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexos" });
        const r = await executar(ctx.escopo, mensagemParaTrabalho, { trabalhoId: ctx.params.id ?? "", texto: texto(corpo.texto), anexos });
        const resposta: RespostaMutacao = { ok: true, ids: { trabalho: r.trabalho.id, turno: r.mensagemTurnoId } };
        ctx.json(201, resposta);
      },
    },
    {
      // "Fazer depois da …": {depoisDe: id | null}. Id de fora só segue se for uuid (o caso de uso confere o dono).
      metodo: "POST", acao: "trabalhos.depois",
      padrao: new RegExp(`^/trabalhos/${ID}/depois$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const depoisDe = corpo.depoisDe === null ? null : typeof corpo.depoisDe === "string" && UUID.test(corpo.depoisDe) ? corpo.depoisDe : undefined;
        if (depoisDe === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "depoisDe" });
        const r = await executar(ctx.escopo, fazerDepois, { trabalhoId: ctx.params.id ?? "", depoisDe });
        ctx.json(200, { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho });
      },
    },
    {
      // "Fazer aqui": a task é desfeita e o pedido dela vira um turno da conversa.
      metodo: "POST", acao: "trabalhos.fazer_aqui",
      padrao: new RegExp(`^/trabalhos/${ID}/fazer-aqui$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, fazerAqui, { trabalhoId: ctx.params.id ?? "" });
        ctx.json(200, { ok: true, ids: { trabalho: r.trabalho.id, turno: r.turnoId }, trabalho: r.trabalho });
      },
    },
    {
      // NOD-377: Cobrar e Desistir da espera vencida de um bot por um colega (o painel e Trabalhos). Os dois ids só seguem
      // se forem uuid; o caso de uso confere que o pedido é deste bot e desta pessoa (nao_encontrado se não).
      metodo: "POST", acao: "bots.cobrar_colega",
      padrao: new RegExp(`^/agentes/${ID}/esperas-de-colega/(?<tarefa>[^/]+)/(?<acao>cobrar|desistir)$`),
      async handler(ctx) {
        const agenteId = ctx.params.id ?? "";
        const tarefaId = ctx.params.tarefa ?? "";
        if (!UUID.test(agenteId) || !UUID.test(tarefaId)) throw new ErroDeDominio("nao_encontrado");
        if (ctx.params.acao === "cobrar") {
          const r = await executar(ctx.escopo, cobrarEspera, { agenteId, tarefaId });
          ctx.json(200, { ok: true, ids: { agente: agenteId }, cobradoEm: r.cobradoEm, cobrancas: r.cobrancas });
          return;
        }
        await executar(ctx.escopo, desistirDaEspera, { agenteId, tarefaId });
        ctx.json(200, { ok: true, ids: { agente: agenteId } });
      },
    },
    {
      // #191: a web manda em lote o que mostrou e o que a pessoa abriu; vai só para events (sem frame).
      metodo: "POST", acao: "telemetria.registrar",
      padrao: /^\/telemetria\/linhas$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, registrarLinhas, { eventos: corpo.eventos }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/telemetria\/linhas$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, taxasDasLinhas, {}));
      },
    },
  ];
}
