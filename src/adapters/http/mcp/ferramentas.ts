import { randomUUID } from "node:crypto";
import type { RotinaDto } from "../../../contracts/api.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { ChamadorInterno, PedidoInterno, RespostaInterna } from "./chamador-interno.ts";

/**
 * As ferramentas do servidor MCP do Nod (1ª leva: o essencial para pilotar). Cada uma é uma composição fina das rotas
 * da tela, chamadas por dentro com o escopo do token (chamador-interno.ts): nenhuma regra de negócio mora aqui. A saída
 * é JSON enxuto (o que o modelo do cliente precisa para decidir o próximo passo), nunca o DTO inteiro da tela.
 *
 * `nod_chamar_rota` é a saída para o que a 1ª leva não cobre: qualquer rota de pessoa da tela (docs/paridade.md lista as
 * que mudam algo), com as mesmas recusas do chamador.
 */

export type ResultadoFerramenta = { content: { type: "text"; text: string }[]; isError?: boolean };

export interface DefinicaoFerramentaMcp {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

/** O que uma ferramenta que mudou algo deixa para a Atividade do bot ("Pelo MCP · Grok Bot"). */
export type AnotacaoMcp = { agenteId: string | null; resumo: string };

export interface ContextoFerramenta {
  escopo: Escopo;
  chamar: ChamadorInterno;
  /** Relógio e espera injetáveis: o teste não dorme. */
  agora(): number;
  dormir(ms: number): Promise<void>;
  /** O cliente desistiu do pedido (a conexão caiu): a espera do nod_conversar para de ler a conversa. */
  cancelado?(): boolean;
  /** Registra o que a ferramenta mudou; o servidor grava na Atividade do bot só se a chamada terminou sem erro. */
  anotar?(a: AnotacaoMcp): void;
}

type Args = Record<string, unknown>;
type Implementacao = (ctx: ContextoFerramenta, args: Args) => Promise<unknown>;

/** O erro que vira resultado com isError (a mensagem é a da tabela fixa da rota, ou uma frase daqui). */
export class FalhaDaFerramenta extends Error {}

/** Espera padrão e teto do `nod_conversar` pela resposta do bot (o cliente MCP costuma desistir perto de 60 a 120 s). */
export const ESPERA_PADRAO_S = 50;
export const ESPERA_MAX_S = 110;
const INTERVALO_LEITURA_MS = 1_500;

// ── auxiliares ──────────────────────────────────────────────────────────────────────────────────────────────────────

function texto(args: Args, campo: string, obrigatorio: true): string;
function texto(args: Args, campo: string, obrigatorio?: false): string | undefined;
function texto(args: Args, campo: string, obrigatorio = false): string | undefined {
  const v = args[campo];
  if (v === undefined || v === null || v === "") {
    if (obrigatorio) throw new FalhaDaFerramenta(`Falta o campo "${campo}".`);
    return undefined;
  }
  if (typeof v !== "string") throw new FalhaDaFerramenta(`O campo "${campo}" deve ser texto.`);
  return v;
}

const iso = (ms: number | null | undefined): string | null => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const corte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

async function chamarOk(ctx: ContextoFerramenta, pedido: PedidoInterno): Promise<unknown> {
  const r: RespostaInterna = await ctx.chamar(ctx.escopo, pedido);
  if (r.status >= 400) {
    const c = (r.corpo ?? {}) as { mensagem?: unknown; codigo?: unknown; motivo?: unknown; detalhe?: unknown };
    const frase = typeof c.mensagem === "string" ? c.mensagem : typeof c.detalhe === "string" ? c.detalhe : "O Nod recusou o pedido.";
    const extra = typeof c.motivo === "string" ? ` (${c.motivo})` : typeof c.codigo === "string" ? ` (${c.codigo})` : "";
    throw new FalhaDaFerramenta(`${frase}${extra}`);
  }
  return r.corpo;
}

type BotDaFrota = { id: string; nome: string; titulo?: string; conversaId: string; naoLido?: boolean; ultimaMensagem?: { previa: string; em: number } | null };

async function frota(ctx: ContextoFerramenta): Promise<BotDaFrota[]> {
  const c = (await chamarOk(ctx, { metodo: "GET", caminho: "/frota" })) as { agentes?: BotDaFrota[] };
  return c.agentes ?? [];
}

/** O bot pelo id ou pelo nome (sem caixa nem acento). Nome que casa com mais de um bot pede o id. */
async function acharBot(ctx: ContextoFerramenta, ref: string): Promise<BotDaFrota> {
  const bots = await frota(ctx);
  const porId = bots.find((b) => b.id === ref);
  if (porId) return porId;
  const alvo = normalizar(ref);
  const iguais = bots.filter((b) => normalizar(b.nome) === alvo);
  if (iguais.length === 1) return iguais[0]!;
  if (iguais.length > 1) throw new FalhaDaFerramenta(`Há mais de um bot chamado "${ref}": use o id (${iguais.map((b) => b.id).join(", ")}).`);
  const parecidos = bots.filter((b) => normalizar(b.nome).includes(alvo));
  if (parecidos.length === 1) return parecidos[0]!;
  throw new FalhaDaFerramenta(`Não achei o bot "${ref}". Use nod_listar_bots para ver os nomes.`);
}

type MensagemDto = { id: string; turnoId: string | null; kind: string; texto: string; criadoEm: number; parcial?: boolean; fimDoTurno?: boolean; bastidores?: boolean; autoria?: { autor_tipo?: string }; payload?: { kind?: string; titulo?: string } | null };
type ConversaLida = { mensagens?: MensagemDto[]; turnosPendentes?: { id: string }[]; turnosEmCurso?: { id: string }[] };

function falaResumida(m: MensagemDto, nomeDoBot: string) {
  const quem = m.autoria?.autor_tipo === "pessoa" ? "você" : m.autoria?.autor_tipo === "agente" ? nomeDoBot : (m.autoria?.autor_tipo ?? "sistema");
  const conteudo = m.payload?.kind === "artefato" && m.payload.titulo ? `[artefato] ${m.payload.titulo}` : m.texto;
  return { id: m.id, quem, texto: corte(conteudo, 4_000), em: iso(m.criadoEm), ...(m.kind !== "texto" ? { tipo: m.kind } : {}), ...(m.parcial ? { parcial: true } : {}) };
}

async function lerConversa(ctx: ContextoFerramenta, conversaId: string): Promise<ConversaLida> {
  return (await chamarOk(ctx, { metodo: "GET", caminho: `/conversas/${conversaId}/mensagens` })) as ConversaLida;
}

type TarefaAchada = { agenteId: string; quadroId: string; tarefaId: string; codigo: string; codigoAtual: string };

async function acharTarefa(ctx: ContextoFerramenta, codigo: string): Promise<TarefaAchada> {
  const r = (await chamarOk(ctx, { metodo: "GET", caminho: `/quadro/tarefas/${encodeURIComponent(codigo)}` })) as TarefaAchada | { ambigua: (TarefaAchada & { titulo: string })[] };
  if ("ambigua" in r) throw new FalhaDaFerramenta(`O código ${codigo} acha mais de uma tarefa: ${r.ambigua.map((t) => `${t.codigoAtual} (${t.titulo}, id ${t.tarefaId})`).join("; ")}. Use o id.`);
  return r;
}

const caminhoDaTarefa = (t: TarefaAchada, resto = "") => `/agentes/${t.agenteId}/quadro/tarefas/${t.tarefaId}${resto}?quadro=${t.quadroId}`;

type ColunaLida = { id: string; nome: string; grupo?: string; responsavelNome?: string | null };
type TarefaLida = { id: string; codigo: string; titulo: string; descricao?: string; status: string; agenteNome?: string | null; prioridade?: string; execucao?: string | null; esperaPessoa?: boolean; pergunta?: string | null; prUrl?: string | null; mudadoEm?: number; labels?: { nome: string }[] };
type QuadroLido = { id: string; nome?: string | null; agenteNome: string; colunas: ColunaLida[]; tarefas: TarefaLida[] };

function tarefaResumida(t: TarefaLida, colunas: Map<string, string>) {
  return {
    codigo: t.codigo,
    titulo: t.titulo,
    coluna: colunas.get(t.status) ?? t.status,
    responsavel: t.agenteNome ?? null,
    ...(t.prioridade && t.prioridade !== "sem" ? { prioridade: t.prioridade } : {}),
    ...(t.execucao ? { trabalho: t.execucao } : {}),
    ...(t.esperaPessoa || t.pergunta ? { espera_voce: t.pergunta ?? true } : {}),
    ...(t.prUrl ? { pr: t.prUrl } : {}),
    ...(t.labels?.length ? { labels: t.labels.map((l) => l.nome) } : {}),
  };
}

// ── as ferramentas ──────────────────────────────────────────────────────────────────────────────────────────────────

const BOT = { type: "string", description: "O bot: o nome (como aparece no Nod) ou o id." };
const CODIGO = { type: "string", description: "O código da tarefa no quadro (ex.: ADA-12), o identificador do Linear ou o id." };

const listarBots: Implementacao = async (ctx) => {
  const bots = await frota(ctx);
  return { bots: bots.map((b) => ({ id: b.id, nome: b.nome, ...(b.titulo ? { titulo: b.titulo } : {}), nao_lido: b.naoLido === true, ultima_mensagem: b.ultimaMensagem ? { previa: b.ultimaMensagem.previa, em: iso(b.ultimaMensagem.em) } : null })) };
};

const conversar: Implementacao = async (ctx, args) => {
  const bot = await acharBot(ctx, texto(args, "bot", true));
  const fala = texto(args, "texto", true);
  const espera = Math.min(ESPERA_MAX_S, Math.max(0, typeof args.esperar_segundos === "number" ? args.esperar_segundos : ESPERA_PADRAO_S));
  if (!bot.conversaId) throw new FalhaDaFerramenta(`O bot ${bot.nome} ainda não tem conversa.`);
  const enviado = (await chamarOk(ctx, { metodo: "POST", caminho: `/conversas/${bot.conversaId}/mensagens`, corpo: { texto: fala, idEnvio: randomUUID() } })) as { ids?: { mensagem?: string; turno?: string } };
  ctx.anotar?.({ agenteId: bot.id, resumo: `Mandou uma mensagem a ${bot.nome}` });
  const turnoId = enviado.ids?.turno ?? null;
  const mensagemId = enviado.ids?.mensagem ?? null;
  const ate = ctx.agora() + espera * 1_000;
  let conversa: ConversaLida = {};
  let terminou = false;
  for (;;) {
    conversa = await lerConversa(ctx, bot.conversaId);
    const aberto = [...(conversa.turnosEmCurso ?? []), ...(conversa.turnosPendentes ?? [])].some((t) => t.id === turnoId);
    if (!aberto) { terminou = true; break; }
    if (ctx.agora() >= ate || ctx.cancelado?.()) break;
    await ctx.dormir(INTERVALO_LEITURA_MS);
    if (ctx.cancelado?.()) break;
  }
  const mensagens = conversa.mensagens ?? [];
  const indice = mensagemId ? mensagens.findIndex((m) => m.id === mensagemId) : -1;
  const depois = (indice >= 0 ? mensagens.slice(indice + 1) : mensagens.filter((m) => m.turnoId === turnoId)).filter((m) => m.autoria?.autor_tipo !== "pessoa" && !m.bastidores);
  return {
    bot: bot.nome,
    terminou,
    resposta: depois.map((m) => falaResumida(m, bot.nome)),
    ...(terminou ? {} : { aviso: `${bot.nome} ainda está trabalhando. Leia depois com nod_ler_conversa; se ele pedir aprovação, aparece em nod_o_que_espera_por_mim.` }),
  };
};

const lerConversaFerramenta: Implementacao = async (ctx, args) => {
  const bot = await acharBot(ctx, texto(args, "bot", true));
  const limite = Math.min(100, Math.max(1, typeof args.limite === "number" ? Math.floor(args.limite) : 20));
  if (!bot.conversaId) return { bot: bot.nome, mensagens: [] };
  const conversa = await lerConversa(ctx, bot.conversaId);
  const falas = (conversa.mensagens ?? []).filter((m) => !m.bastidores).slice(-limite);
  return { bot: bot.nome, trabalhando: (conversa.turnosEmCurso?.length ?? 0) + (conversa.turnosPendentes?.length ?? 0) > 0, mensagens: falas.map((m) => falaResumida(m, bot.nome)) };
};

type ItemSuaVez = { decisao: { id: string; tipo: string; frase: string; criadoEm: string; tarefaId?: string; agenteId?: string }; agenteNome: string; itensAprovacao?: { id: string; textoFinal: string; selecionado: boolean }[]; fio?: { opcoes?: string[] } | null };

async function suaVez(ctx: ContextoFerramenta): Promise<ItemSuaVez[]> {
  const r = (await chamarOk(ctx, { metodo: "GET", caminho: "/sua-vez" })) as { itens?: ItemSuaVez[] };
  return r.itens ?? [];
}

/** Os tipos que se respondem com texto (pedir_a_pessoa), não com aprovar/recusar. */
const SE_RESPONDE = new Set(["pergunta", "falta_de_dado", "permissao"]);

const oQueEsperaPorMim: Implementacao = async (ctx) => {
  const itens = await suaVez(ctx);
  const naoLidos = (await chamarOk(ctx, { metodo: "GET", caminho: "/nao-lidos" })) as { conversas?: { conversaId: string; tipo: string; agenteId: string | null; total: number }[] };
  const nomes = new Map((await frota(ctx)).map((b) => [b.id, b.nome]));
  return {
    pedidos: itens.map((i) => ({
      id: i.decisao.id,
      bot: i.agenteNome,
      tipo: i.decisao.tipo,
      como_decidir: SE_RESPONDE.has(i.decisao.tipo) ? "nod_responder_pedido (com texto)" : "nod_decidir (aprovar ou recusar)",
      frase: i.decisao.frase,
      desde: i.decisao.criadoEm,
      ...(i.itensAprovacao?.length ? { itens: i.itensAprovacao.map((x) => ({ id: x.id, texto: corte(x.textoFinal, 1_000) })) } : {}),
    })),
    nao_lidos: (naoLidos.conversas ?? []).map((c) => ({ ...(c.agenteId ? { bot: nomes.get(c.agenteId) ?? c.agenteId } : { sala: c.conversaId }), mensagens: c.total })),
  };
};

const decidir: Implementacao = async (ctx, args) => {
  const id = texto(args, "pedido_id", true);
  const acao = texto(args, "decisao", true);
  if (acao !== "aprovar" && acao !== "recusar") throw new FalhaDaFerramenta('O campo "decisao" é "aprovar" ou "recusar".');
  const item = (await suaVez(ctx)).find((i) => i.decisao.id === id);
  if (!item) throw new FalhaDaFerramenta("Esse pedido não está mais esperando por você (já decidido, vencido ou não existe).");
  if (SE_RESPONDE.has(item.decisao.tipo)) throw new FalhaDaFerramenta("Esse pedido é uma pergunta: responda com nod_responder_pedido.");
  // O mesmo corpo que a janela de aprovação por voz monta (rotas/decisoes.ts): recusar uma aprovação = todos os itens
  // desmarcados; aprovar = o que o bot propôs, como o botão Aprovar da tela.
  // Retomar um turno interrompido não se recusa pelo /decidir (a rota retoma de qualquer jeito): o "não retomar" da tela
  // é o Deixar pra lá (POST decisoes/:id/dispensar).
  const caminho = acao === "recusar" && item.decisao.tipo === "retomar_turno" ? `/decisoes/${id}/dispensar` : `/decisoes/${id}/decidir`;
  const tipoComItens = item.decisao.tipo === "aprovacao" || item.decisao.tipo === "gate_rotina";
  const corpo = acao === "recusar" ? (tipoComItens ? { itens: (item.itensAprovacao ?? []).map((x) => ({ id: x.id, selecionado: false })) } : { recusar: true }) : args.sempre === true ? { sempre: true } : {};
  const r = (await chamarOk(ctx, { metodo: "POST", caminho, corpo })) as { ids?: Record<string, string> };
  ctx.anotar?.({ agenteId: item.decisao.agenteId ?? null, resumo: `${acao === "aprovar" ? "Aprovou" : "Recusou"}: ${corte(item.decisao.frase, 140)}` });
  return { ok: true, pedido: id, decisao: acao, bot: item.agenteNome, ids: r.ids ?? {} };
};

const responderPedido: Implementacao = async (ctx, args) => {
  const id = texto(args, "pedido_id", true);
  const resposta = texto(args, "texto", true);
  const item = (await suaVez(ctx)).find((i) => i.decisao.id === id);
  const r = (await chamarOk(ctx, { metodo: "POST", caminho: `/decisoes/${id}/responder`, corpo: { texto: resposta } })) as { ids?: Record<string, string> };
  ctx.anotar?.({ agenteId: item?.decisao.agenteId ?? null, resumo: item ? `Respondeu: ${corte(item.decisao.frase, 140)}` : "Respondeu a um pedido" });
  return { ok: true, pedido: id, ids: r.ids ?? {} };
};

const verQuadro: Implementacao = async (ctx, args) => {
  const bot = await acharBot(ctx, texto(args, "bot", true));
  const r = (await chamarOk(ctx, { metodo: "GET", caminho: `/agentes/${bot.id}/quadro` })) as { quadro: QuadroLido | null };
  if (!r.quadro) return { bot: bot.nome, quadro: null, aviso: `${bot.nome} não tem quadro.` };
  const q = r.quadro;
  const colunas = new Map(q.colunas.map((c) => [c.id, c.nome]));
  const coluna = texto(args, "coluna");
  const alvo = coluna ? q.colunas.find((c) => c.id === coluna || normalizar(c.nome) === normalizar(coluna)) : undefined;
  if (coluna && !alvo) throw new FalhaDaFerramenta(`O quadro não tem a coluna "${coluna}". Colunas: ${q.colunas.map((c) => c.nome).join(", ")}.`);
  const tarefas = q.tarefas.filter((t) => !alvo || t.status === alvo.id);
  const limite = Math.min(500, Math.max(1, typeof args.limite === "number" ? Math.floor(args.limite) : 200));
  return {
    bot: bot.nome,
    quadro: q.nome ?? "Tarefas",
    colunas: q.colunas.map((c) => ({ id: c.id, nome: c.nome, tarefas: q.tarefas.filter((t) => t.status === c.id).length, ...(c.responsavelNome ? { passa_para: c.responsavelNome } : {}) })),
    tarefas: tarefas.slice(0, limite).map((t) => tarefaResumida(t, colunas)),
    ...(tarefas.length > limite ? { cortadas: tarefas.length - limite } : {}),
  };
};

const verTarefa: Implementacao = async (ctx, args) => {
  const achada = await acharTarefa(ctx, texto(args, "tarefa", true));
  const r = (await chamarOk(ctx, { metodo: "GET", caminho: `/agentes/${achada.agenteId}/quadro?quadro=${achada.quadroId}` })) as { quadro: QuadroLido | null };
  const t = r.quadro?.tarefas.find((x) => x.id === achada.tarefaId);
  if (!r.quadro || !t) throw new FalhaDaFerramenta("Não achei a tarefa no quadro.");
  const colunas = new Map(r.quadro.colunas.map((c) => [c.id, c.nome]));
  const comentarios = (await chamarOk(ctx, { metodo: "GET", caminho: caminhoDaTarefa(achada, "/comentarios") })) as { comentarios?: { id: string; texto: string; autorNome?: string | null; criadoEm?: number }[] };
  return {
    ...tarefaResumida(t, colunas),
    quadro_de: r.quadro.agenteNome,
    descricao: corte(t.descricao ?? "", 8_000),
    comentarios: (comentarios.comentarios ?? []).slice(-30).map((c) => ({ id: c.id, autor: c.autorNome ?? null, texto: corte(c.texto, 2_000), em: iso(c.criadoEm) })),
  };
};

const criarTarefa: Implementacao = async (ctx, args) => {
  const bot = await acharBot(ctx, texto(args, "bot", true));
  const corpo = {
    titulo: texto(args, "titulo", true),
    ...(texto(args, "descricao") !== undefined ? { descricao: texto(args, "descricao") } : {}),
    ...(texto(args, "coluna") !== undefined ? { status: texto(args, "coluna") } : {}),
    ...(texto(args, "responsavel") !== undefined ? { agente: texto(args, "responsavel") } : {}),
    ...(texto(args, "prioridade") !== undefined ? { prioridade: texto(args, "prioridade") } : {}),
  };
  const r = await chamarOk(ctx, { metodo: "POST", caminho: `/agentes/${bot.id}/quadro/tarefas`, corpo });
  ctx.anotar?.({ agenteId: bot.id, resumo: `Criou a tarefa "${corte(corpo.titulo, 120)}"` });
  return { ok: true, quadro_de: bot.nome, resultado: r };
};

const mudarTarefa: Implementacao = async (ctx, args) => {
  const achada = await acharTarefa(ctx, texto(args, "tarefa", true));
  const corpo: Record<string, unknown> = {};
  const mapa: [string, string][] = [["coluna", "status"], ["responsavel", "agente"], ["titulo", "titulo"], ["descricao", "descricao"], ["prioridade", "prioridade"]];
  for (const [de, para] of mapa) if (texto(args, de) !== undefined) corpo[para] = texto(args, de);
  if (Object.keys(corpo).length === 0) throw new FalhaDaFerramenta("Diga o que mudar: coluna, responsavel, titulo, descricao ou prioridade.");
  const r = await chamarOk(ctx, { metodo: "PATCH", caminho: caminhoDaTarefa(achada), corpo });
  ctx.anotar?.({ agenteId: achada.agenteId, resumo: typeof corpo.status === "string" ? `Moveu a tarefa ${achada.codigoAtual} para ${corte(corpo.status, 60)}` : `Mudou a tarefa ${achada.codigoAtual}` });
  return { ok: true, tarefa: achada.codigoAtual, resultado: r };
};

const comentarTarefa: Implementacao = async (ctx, args) => {
  const achada = await acharTarefa(ctx, texto(args, "tarefa", true));
  const r = await chamarOk(ctx, { metodo: "POST", caminho: caminhoDaTarefa(achada, "/comentarios"), corpo: { texto: texto(args, "texto", true) } });
  ctx.anotar?.({ agenteId: achada.agenteId, resumo: `Comentou na tarefa ${achada.codigoAtual}` });
  return { ok: true, tarefa: achada.codigoAtual, resultado: r };
};

const responderTarefa: Implementacao = async (ctx, args) => {
  const achada = await acharTarefa(ctx, texto(args, "tarefa", true));
  const r = await chamarOk(ctx, { metodo: "POST", caminho: caminhoDaTarefa(achada, "/resposta"), corpo: { resposta: texto(args, "resposta", true), ...(args.avancar === true ? { avancar: true } : {}) } });
  ctx.anotar?.({ agenteId: achada.agenteId, resumo: `Respondeu na tarefa ${achada.codigoAtual}` });
  return { ok: true, tarefa: achada.codigoAtual, resultado: r };
};

/** GET /rotinas devolve `{ rotinas: RotinaDto[] }` (listarRotinas, contracts/api.ts): a rotina vem dentro de `rotina`. */
type RotinaLida = Pick<RotinaDto, "proximaExecucao"> & { rotina: Pick<RotinaDto["rotina"], "id" | "agenteId" | "cron" | "fusoIana" | "estado" | "instrucao"> };

async function rotinas(ctx: ContextoFerramenta): Promise<RotinaLida[]> {
  const r = (await chamarOk(ctx, { metodo: "GET", caminho: "/rotinas" })) as { rotinas?: RotinaLida[] } | null;
  return Array.isArray(r?.rotinas) ? r.rotinas : [];
}

const listarRotinas: Implementacao = async (ctx) => {
  const lista = await rotinas(ctx);
  const nomes = new Map((await frota(ctx)).map((b) => [b.id, b.nome]));
  return { rotinas: lista.map(({ rotina: x, proximaExecucao }) => ({ id: x.id, bot: nomes.get(x.agenteId) ?? x.agenteId, estado: x.estado, quando: `${x.cron} (${x.fusoIana})`, proxima: iso(proximaExecucao), instrucao: corte(x.instrucao ?? "", 300) })) };
};

const rodarRotina: Implementacao = async (ctx, args) => {
  const id = texto(args, "rotina_id", true);
  const r = await chamarOk(ctx, { metodo: "POST", caminho: `/rotinas/${id}/executar`, corpo: {} });
  const rotina = (await rotinas(ctx)).find((x) => x.rotina.id === id)?.rotina;
  ctx.anotar?.({ agenteId: rotina?.agenteId ?? null, resumo: rotina ? `Rodou a rotina "${corte(rotina.instrucao ?? "", 100)}"` : "Rodou uma rotina" });
  return { ok: true, rotina: id, resultado: r };
};

const METODOS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const chamarRota: Implementacao = async (ctx, args) => {
  const metodo = (texto(args, "metodo", true)).toUpperCase();
  const caminho = texto(args, "caminho", true);
  if (!METODOS.has(metodo)) throw new FalhaDaFerramenta('O "metodo" é GET, POST, PATCH, PUT ou DELETE.');
  if (!caminho.startsWith("/") || caminho.startsWith("//")) throw new FalhaDaFerramenta('O "caminho" começa com "/" (ex.: /frota), sem /api/t/<tenant>.');
  const r = await ctx.chamar(ctx.escopo, { metodo: metodo as PedidoInterno["metodo"], caminho, corpo: args.corpo ?? {} });
  if (metodo !== "GET" && r.status < 400) {
    const bot = /^\/agentes\/([0-9a-f-]{36})(?:[/?]|$)/i.exec(caminho)?.[1] ?? null;
    ctx.anotar?.({ agenteId: bot, resumo: `Chamou ${metodo} ${corte(caminho.split("?")[0] ?? caminho, 120)}` });
  }
  return { status: r.status, corpo: r.corpo };
};

type Ferramenta = DefinicaoFerramentaMcp & { executar: Implementacao };

export const FERRAMENTAS_MCP: readonly Ferramenta[] = [
  {
    name: "nod_listar_bots",
    description: "Lista os bots do Nod da pessoa, com o título, se há mensagem não lida e a última mensagem. Use antes de conversar com um bot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: listarBots,
  },
  {
    name: "nod_conversar",
    description: "Manda uma mensagem a um bot do Nod, como a pessoa faria no chat, e espera a resposta dele (até esperar_segundos). Se ele não terminar a tempo, volta com terminou=false: leia depois com nod_ler_conversa. Pedidos de aprovação que ele abrir aparecem em nod_o_que_espera_por_mim.",
    inputSchema: {
      type: "object",
      properties: { bot: BOT, texto: { type: "string", description: "A mensagem, como a pessoa escreveria." }, esperar_segundos: { type: "number", minimum: 0, maximum: ESPERA_MAX_S, description: `Quanto esperar pela resposta (padrão ${ESPERA_PADRAO_S}; 0 só manda).` } },
      required: ["bot", "texto"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    executar: conversar,
  },
  {
    name: "nod_ler_conversa",
    description: "Lê as últimas mensagens da conversa com um bot do Nod e diz se ele ainda está trabalhando.",
    inputSchema: { type: "object", properties: { bot: BOT, limite: { type: "number", minimum: 1, maximum: 100, description: "Quantas mensagens (padrão 20)." } }, required: ["bot"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: lerConversaFerramenta,
  },
  {
    name: "nod_o_que_espera_por_mim",
    description: "O que espera pela pessoa no Nod: os pedidos de aprovação, as perguntas dos bots e os não lidos. Cada pedido diz como decidir (nod_decidir ou nod_responder_pedido).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: oQueEsperaPorMim,
  },
  {
    name: "nod_decidir",
    description: "Aprova ou recusa um pedido que espera pela pessoa (o id vem de nod_o_que_espera_por_mim), como os botões da tela. Aprovar executa o que o bot propôs. Confirme com a pessoa antes de aprovar algo com efeito externo.",
    inputSchema: {
      type: "object",
      properties: { pedido_id: { type: "string", description: "O id do pedido." }, decisao: { type: "string", enum: ["aprovar", "recusar"] }, sempre: { type: "boolean", description: "Aprovar e permitir sempre este tipo de ação (o Sempre permitir da tela)." } },
      required: ["pedido_id", "decisao"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    executar: decidir,
  },
  {
    name: "nod_responder_pedido",
    description: "Responde com texto a uma pergunta de um bot que espera pela pessoa (os pedidos com como_decidir = nod_responder_pedido).",
    inputSchema: { type: "object", properties: { pedido_id: { type: "string" }, texto: { type: "string", description: "A resposta da pessoa." } }, required: ["pedido_id", "texto"], additionalProperties: false },
    annotations: { readOnlyHint: false },
    executar: responderPedido,
  },
  {
    name: "nod_ver_quadro",
    description: "Mostra o quadro de tarefas de um bot do Nod: as colunas (com quem recebe a tarefa em cada uma) e as tarefas com código, coluna, responsável e o que espera pela pessoa.",
    inputSchema: { type: "object", properties: { bot: BOT, coluna: { type: "string", description: "Só as tarefas desta coluna (nome ou id)." }, limite: { type: "number", minimum: 1, maximum: 500 } }, required: ["bot"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: verQuadro,
  },
  {
    name: "nod_ver_tarefa",
    description: "Abre uma tarefa do quadro pelo código: descrição, coluna, responsável e os últimos comentários.",
    inputSchema: { type: "object", properties: { tarefa: CODIGO }, required: ["tarefa"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: verTarefa,
  },
  {
    name: "nod_criar_tarefa",
    description: "Cria uma tarefa no quadro de um bot. Sem coluna vai para o Backlog e ninguém começa; numa coluna com responsável (ex.: A fazer), o bot começa sozinho.",
    inputSchema: {
      type: "object",
      properties: {
        bot: { ...BOT, description: "O bot dono do quadro." },
        titulo: { type: "string" },
        descricao: { type: "string" },
        coluna: { type: "string", description: "A coluna (nome ou id)." },
        responsavel: { type: "string", description: "O bot responsável (nome ou id)." },
        prioridade: { type: "string", enum: ["sem", "urgente", "alta", "media", "baixa"] },
      },
      required: ["bot", "titulo"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    executar: criarTarefa,
  },
  {
    name: "nod_mudar_tarefa",
    description: "Move uma tarefa de coluna ou muda o responsável, o título, a descrição ou a prioridade, como arrastar e editar o card na tela (a coluna com responsável passa a tarefa a ele).",
    inputSchema: {
      type: "object",
      properties: { tarefa: CODIGO, coluna: { type: "string", description: "A coluna de destino (nome ou id)." }, responsavel: { type: "string" }, titulo: { type: "string" }, descricao: { type: "string" }, prioridade: { type: "string", enum: ["sem", "urgente", "alta", "media", "baixa"] } },
      required: ["tarefa"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    executar: mudarTarefa,
  },
  {
    name: "nod_comentar_tarefa",
    description: "Comenta numa tarefa do quadro como a pessoa. O comentário aciona o responsável; @Nome aciona aquele bot.",
    inputSchema: { type: "object", properties: { tarefa: CODIGO, texto: { type: "string" } }, required: ["tarefa", "texto"], additionalProperties: false },
    annotations: { readOnlyHint: false },
    executar: comentarTarefa,
  },
  {
    name: "nod_responder_tarefa",
    description: "Responde à pergunta que um bot deixou numa tarefa do quadro (avancar=true responde e manda para a próxima coluna).",
    inputSchema: { type: "object", properties: { tarefa: CODIGO, resposta: { type: "string" }, avancar: { type: "boolean" } }, required: ["tarefa", "resposta"], additionalProperties: false },
    annotations: { readOnlyHint: false },
    executar: responderTarefa,
  },
  {
    name: "nod_listar_rotinas",
    description: "Lista as rotinas dos bots da pessoa: o bot, o estado, quando roda, a próxima execução e a instrução.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: listarRotinas,
  },
  {
    name: "nod_rodar_rotina",
    description: "Roda uma rotina agora, fora do horário (o id vem de nod_listar_rotinas).",
    inputSchema: { type: "object", properties: { rotina_id: { type: "string" } }, required: ["rotina_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: true },
    executar: rodarRotina,
  },
  {
    name: "nod_chamar_rota",
    description: "Chama qualquer rota da tela do Nod em nome da pessoa, para o que as outras ferramentas não cobrem (ex.: GET /rotinas, POST /rotinas/<id>/pausar). O caminho é o da API sem o prefixo /api/t/<tenant>. Tokens MCP, segredos, senha e pareamento não passam por aqui.",
    inputSchema: {
      type: "object",
      properties: { metodo: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"] }, caminho: { type: "string", description: "Ex.: /frota, /agentes/<id>/quadro?quadro=<id>." }, corpo: { type: "object", description: "O corpo JSON (POST, PATCH, PUT)." } },
      required: ["metodo", "caminho"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    executar: chamarRota,
  },
];

export const DEFINICOES_MCP: readonly DefinicaoFerramentaMcp[] = FERRAMENTAS_MCP.map(({ executar: _e, ...def }) => def);

/** Roda uma ferramenta. O erro esperado (a rota recusou, faltou campo) volta como resultado com isError, nunca como exceção. */
export async function executarFerramentaMcp(ctx: ContextoFerramenta, nome: string, args: unknown): Promise<ResultadoFerramenta | null> {
  const f = FERRAMENTAS_MCP.find((x) => x.name === nome);
  if (!f) return null;
  const a: Args = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Args) : {};
  try {
    const saida = await f.executar(ctx, a);
    return { content: [{ type: "text", text: JSON.stringify(saida) }] };
  } catch (err) {
    if (err instanceof FalhaDaFerramenta) return { content: [{ type: "text", text: err.message }], isError: true };
    throw err;
  }
}
