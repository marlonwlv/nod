import type { AppCanvasDto, CanvasItemDto, ComentarioCanvasDto, VersaoCanvasDto, VistaCanvasDto } from "../../contracts/canvas.ts";
import type { FalhaCanvas } from "../../contracts/ferramentas-canvas.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { contagem, NIVEIS_CANVAS } from "../../domain/canvas.ts";
import { resolvidosPorVersao, telasQueMudaram } from "../../domain/canvas-versoes.ts";
import type { CodigoErro } from "../../domain/erro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Canvas, ComentarioCanvas, VersaoCanvas } from "../../repositories/canvas.repo.ts";
import { autoriaPessoa } from "../autoria-evento.ts";
import { aprovacaoDaIssue, carregarCanvas, comentar, estadoDe, eventoCanvas, eventoPaginasDoCanvas, proximaRodada, resolver, type Falha } from "../canvas.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores do app Canvas pela tela (definido em 2026-11-04, ADA-13, ADR-150). Comentar e resolver usam as mesmas
 * regras do gerir_canvas (src/use-cases/canvas.ts), com a pessoa como autora (confiável). Instalar, desinstalar e dar
 * acesso são só da tela (`falta` no chat, onda NOD-394); as leituras alimentam a página do Canvas.
 */

const CODIGO: Record<FalhaCanvas, CodigoErro> = {
  sem_acesso: "nao_permitido",
  nao_encontrado: "nao_encontrado",
  entrada_invalida: "entrada_invalida",
  grande_demais: "limite_atingido",
  importar_falhou: "estado_invalido",
};
const lancar = (f: Falha): never => {
  throw new ErroDeDominio(CODIGO[f.erro], { cause: `${f.erro}: ${f.detalhe}` });
};

export const comentarioDto = (c: ComentarioCanvas): ComentarioCanvasDto => ({
  id: c.id, telaId: c.telaId, jornada: c.jornada, tipo: c.tipo, x: c.x, y: c.y, texto: c.texto, autorTipo: c.autorTipo, autorNome: c.autorNome,
  autorAgenteId: c.autorTipo === "bot" ? c.autorId : null,
  paiId: c.paiId, versao: c.versao, rodada: c.rodada, confiavel: c.confianca === "confiavel", resolvido: c.resolvidoEm !== null, arquivado: c.arquivadoEm !== null, criadoEm: c.criadoEm,
});

type EntradaComentar = { canvasId: string; endereco?: string; tipo?: "pino" | "nota"; x?: number; y?: number; texto: string; paiId?: string; rodada?: number; versao?: number };

export const EXECUTORES_CANVAS = {
  "canvas.comentar": (async (deps, input) => {
    const r = await comentar(deps, { ...input, autor: { tipo: "pessoa", id: deps.escopo.pessoaId, nome: null }, confianca: "confiavel" });
    return r.ok ? { data: { comentario: comentarioDto(r.comentario) }, events: [eventoCanvas(deps, autoriaPessoa(deps.escopo), r.canvas, "comentario")] } : lancar(r);
  }) as CasoDeUso<EntradaComentar, { comentario: ComentarioCanvasDto }>,
  "canvas.resolver_comentario": (async (deps, input) => {
    const r = await resolver(deps, input);
    if (!r.ok) return lancar(r);
    const canvas = await deps.repos.canvas.buscar(r.comentario.canvasId);
    return { data: { comentario: comentarioDto(r.comentario) }, events: canvas ? [eventoCanvas(deps, autoriaPessoa(deps.escopo), canvas, "comentario")] : [] };
  }) as CasoDeUso<{ comentarioId: string; resolvido: boolean }, { comentario: ComentarioCanvasDto }>,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;

// ---------------------------------------------------------------------------------------------------------------------
// Só da tela (falta no chat) e as leituras


const verApp: CasoDeUso<Record<string, never>, AppCanvasDto> = async (deps) => ({
  data: { instalado: await deps.repos.canvas.instalado(), acessos: await deps.repos.canvas.acessos() },
});

export const verAppCanvas = verApp;

export const instalarCanvas: CasoDeUso<Record<string, never>, AppCanvasDto> = async (deps, input) => {
  await deps.repos.canvas.instalar();
  return verApp(deps, input);
};

export const desinstalarCanvas: CasoDeUso<Record<string, never>, AppCanvasDto> = async (deps, input) => {
  const antes = await deps.repos.canvas.acessos();
  await deps.repos.canvas.desinstalar();
  // A página Canvas sai da pílula de cada bot que tinha acesso (os canvas e os comentários ficam no banco).
  return { ...(await verApp(deps, input)), events: antes.map((a) => eventoPaginasDoCanvas(deps, autoriaPessoa(deps.escopo), a.agenteId)) };
};

export const darAcessoCanvas: CasoDeUso<{ agenteId: string; nivel: unknown }, AppCanvasDto> = async (deps, input) => {
  const nivel = input.nivel === null ? null : NIVEIS_CANVAS.find((n) => n === input.nivel);
  if (nivel === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "nivel: ver_comentar, criar_publicar ou null" });
  if (!(await deps.repos.canvas.instalado(true))) throw new ErroDeDominio("estado_invalido", { cause: "instale o Canvas antes de dar acesso" });
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "bot não encontrado" });
  const antes = await deps.repos.canvas.nivelDe(agente.id);
  await deps.repos.canvas.definirNivel(agente.id, nivel);
  const events = (antes === null) !== (nivel === null) ? [eventoPaginasDoCanvas(deps, autoriaPessoa(deps.escopo), agente.id)] : [];
  return { ...(await verApp(deps, {})), events };
};

/** O item da lista com o estado (J7-3): o estado e a contagem vêm sempre da versão atual. */
const itemDto = (c: Canvas, atual: VersaoCanvas | null, cs: readonly ComentarioCanvas[], aprovado: number | null): CanvasItemDto => {
  const { estado, etapa, aprovadoEm } = estadoDe(atual, cs, aprovado);
  const n = atual ? contagem(atual.estrutura) : { jornadas: 0, telas: 0 };
  return {
    id: c.id, issue: c.issue, titulo: c.titulo, versao: c.versaoAtual, origemUrl: c.origemUrl, atualizadoEm: c.atualizadoEm,
    abertos: cs.filter((x) => !x.paiId && !x.resolvidoEm && !x.arquivadoEm).length, estado, etapa, aprovadoEm, telas: n.telas, jornadas: n.jornadas,
  };
};

export const canvasDoAgente: CasoDeUso<{ agenteId: string }, { canvas: CanvasItemDto[] }> = async (deps, input) => {
  const lista = await deps.repos.canvas.doAgente(input.agenteId);
  const canvas: CanvasItemDto[] = [];
  for (const c of lista) canvas.push(itemDto(c, await deps.repos.canvas.versao(c.id, c.versaoAtual), await deps.repos.canvas.comentarios(c.id), await aprovacaoDaIssue(deps, c.issue)));
  return { data: { canvas } };
};

/** O canvas com a estrutura (o conteúdo vai por hash: a página busca os blobs à parte) e todos os comentários. */
export const verCanvas: CasoDeUso<{ canvasId: string; versao?: number }, VistaCanvasDto> = async (deps, input) => {
  const c = await carregarCanvas(deps, input.canvasId, input.versao);
  if ("erro" in c) return lancar(c);
  const atual = c.versao.versao === c.canvas.versaoAtual ? c.versao : await deps.repos.canvas.versao(c.canvas.id, c.canvas.versaoAtual);
  return {
    data: {
      canvas: itemDto(c.canvas, atual, c.comentarios, await aprovacaoDaIssue(deps, c.canvas.issue)), estrutura: c.versao.estrutura, confiavel: c.versao.confianca === "confiavel", versoes: c.canvas.versaoAtual,
      comentarios: c.comentarios.map(comentarioDto), proximaRodada: proximaRodada(c.comentarios),
    },
  };
};

/**
 * O histórico do ▾ da versão (J5-6, ADA-228), da mais nova para a mais antiga: o resumo, as telas que mudaram (o hash do
 * html contra a anterior), os comentários que ela resolveu e os que ela arquivou (a tela saiu). Só lê (fora do registro).
 */
export const versoesDoCanvas: CasoDeUso<{ canvasId: string }, { versoes: VersaoCanvasDto[] }> = async (deps, input) => {
  const canvas = await deps.repos.canvas.buscar(input.canvasId);
  if (!canvas) throw new ErroDeDominio("nao_encontrado", { cause: "canvas não encontrado" });
  const vs = await deps.repos.canvas.versoes(canvas.id);
  const cs = await deps.repos.canvas.comentarios(canvas.id);
  const resolvidos = resolvidosPorVersao(vs, cs);
  const porVersao = new Map(vs.map((v) => [v.versao, v]));
  const versoes = vs.map((v): VersaoCanvasDto => {
    const antes = porVersao.get(v.versao - 1) ?? null;
    const { mudaram, sairam } = telasQueMudaram(antes?.telas ?? null, v.telas);
    const jornadas = new Set(v.telas.map((t) => t.id.split("-")[0])).size;
    return { versao: v.versao, criadoEm: v.criadoEm, resumo: v.resumo, mudaram, sairam, telas: v.telas.length, jornadas, resolvidos: resolvidos.get(v.versao) ?? [], arquivados: cs.filter((x) => !x.paiId && x.telaId !== null && sairam.includes(x.telaId)).length };
  });
  return { data: { versoes } };
};

const HASH = /^[0-9a-f]{64}$/;
export const blobsDoCanvas: CasoDeUso<{ canvasId: string; hashes: string[] }, { blobs: Record<string, string> }> = async (deps, input) => {
  const canvas = await deps.repos.canvas.buscar(input.canvasId);
  if (!canvas) throw new ErroDeDominio("nao_encontrado", { cause: "canvas não encontrado" });
  const hashes = [...new Set(input.hashes)].filter((h) => HASH.test(h)).slice(0, 80);
  // canvas_blobs é da dona (RLS e o escopo do repo): o hash de outra pessoa não vaza por aqui.
  return { data: { blobs: await deps.repos.canvas.blobs(hashes) } };
};
