import type { ColunaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { Prioridade } from "../../src/contracts/quadro-opcoes.ts";
import { fraseDaEspera } from "./quadro-dados.ts";

/**
 * Tela 18d do Paper ("Tarefas de todos os bots"): os quadros de todos os bots da pessoa numa página só, aberta pela linha
 * "Tarefas" da barra. Lê os quadros pela API de sempre (GET /quadros e GET /quadros/:id); aqui é só o puro: agrupar,
 * filtrar e dizer o estado de cada linha. A tela (web/telas/tarefas-de-todos.ts) desenha; o controlador
 * (web/lib/tarefas-de-todos-na-tela.ts) lê e trata os cliques.
 */

export type VistaDasTarefas = "quadro" | "bot" | "minhas";

/** O tom do ponto da coluna: andando (tinta), revisão (azul), bloqueado (perigo), não iniciado (vazio). */
export type TomDaColuna = "andando" | "revisao" | "bloqueado" | "parado";

/** O que vai à direita da linha: o trabalho vivo, a fila, a pergunta, a espera ou o "há quanto". */
export type DireitaDaLinha = { texto: string; tom: "neutro" | "aguardando" };

export type LinhaDaTarefa = {
  id: string;
  quadroId: string;
  /** O dono do quadro (a página Tarefas em que a tarefa mora). */
  donoId: string;
  codigo: string;
  titulo: string;
  prioridade: Prioridade;
  coluna: string;
  tom: TomDaColuna;
  agenteId: string | null;
  agenteNome: string | null;
  direita: DireitaDaLinha;
  perguntou: boolean;
  ordem: number;
  mudadoEm: number;
};

export type GrupoDasTarefas = {
  chave: string;
  /** Por quadro: o projeto (ou "Sem projeto") e o nome do quadro. Por bot: o nome do bot. */
  projeto: string | null;
  nome: string;
  /** O bot cuja página Tarefas o grupo abre (por quadro: o dono; por bot: o próprio). */
  agenteId: string | null;
  agenteNome: string;
  quadroId: string | null;
  /** feitas / total em %, só por quadro (null nos outros agrupamentos). */
  progresso: number | null;
  linhas: LinhaDaTarefa[];
};

export type FiltrosDasTarefas = { busca: string; emAberto: boolean; porPrioridade: boolean };

const PESO_PRIORIDADE: Readonly<Record<Prioridade, number>> = { urgente: 0, alta: 1, media: 2, baixa: 3, sem: 4 };

export function tomDaColuna(c: Pick<ColunaDto, "id" | "grupo"> | undefined): TomDaColuna {
  if (!c) return "parado";
  if (c.id === "bloqueado") return "bloqueado";
  if (c.id === "revisao") return "revisao";
  return c.grupo === "iniciado" ? "andando" : "parado";
}

/** "há 5 min", "há 3 h", "há 1 dia", "há 2 dias" (o texto da tela 18d). */
export function haQuanto(desde: number, agora: number): string {
  const min = Math.max(0, Math.floor((agora - desde) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

const minutos = (desde: number, agora: number): number => Math.max(1, Math.floor((agora - desde) / 60_000));

/** A direita da linha, na ordem de quem pede mais atenção: a pergunta, o trabalho vivo, a fila, a espera, o tempo. */
export function direitaDaTarefa(t: TarefaDto, agora: number): DireitaDaLinha {
  if (t.esperaPessoa && (!t.decide || t.decide.voce)) return { texto: "te perguntou", tom: "aguardando" };
  if (t.execucao === "rodando") return { texto: t.trabalhandoDesde ? `Trabalhando · ${minutos(t.trabalhandoDesde, agora)} min` : "Trabalhando", tom: "neutro" };
  if (t.execucao === "fila") return { texto: t.naFilaDesde ? `na fila · ${minutos(t.naFilaDesde, agora)} min` : "na fila", tom: "neutro" };
  const espera = fraseDaEspera(t, agora);
  if (espera) return { texto: espera.texto, tom: espera.voce ? "aguardando" : "neutro" };
  return { texto: haQuanto(t.mudadoEm, agora), tom: "neutro" };
}

/** Em aberto: fora de Backlog, Feito e Cancelado (o que alguém está fazendo ou vai fazer agora). */
export function emAberto(c: Pick<ColunaDto, "id" | "grupo"> | undefined): boolean {
  if (!c) return true;
  return c.grupo !== "feito" && c.grupo !== "fechado" && c.id !== "backlog";
}

export function linhaDaTarefa(q: QuadroDto, t: TarefaDto, agora: number): LinhaDaTarefa {
  const col = q.colunas.find((c) => c.id === t.status);
  const direita = direitaDaTarefa(t, agora);
  return {
    id: t.id, quadroId: q.id, donoId: q.agenteId, codigo: t.codigo, titulo: t.titulo, prioridade: t.prioridade ?? "sem",
    coluna: col?.nome ?? t.status, tom: tomDaColuna(col), agenteId: t.agenteId, agenteNome: t.agenteNome,
    direita, perguntou: direita.texto === "te perguntou", ordem: t.ordem, mudadoEm: t.mudadoEm,
  };
}

function casa(l: LinhaDaTarefa, busca: string): boolean {
  const b = busca.trim().toLocaleLowerCase("pt-BR");
  if (!b) return true;
  return l.titulo.toLocaleLowerCase("pt-BR").includes(b) || l.codigo.toLocaleLowerCase("pt-BR").includes(b);
}

/** Por quadro, a ordem do próprio quadro (a que a pessoa arrumou); entre quadros, a mudança mais recente primeiro. */
function ordenar(ls: LinhaDaTarefa[], porPrioridade: boolean, doQuadro = false): LinhaDaTarefa[] {
  return [...ls].sort((a, b) => (porPrioridade ? PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade] : 0) || (doQuadro ? a.ordem - b.ordem : 0) || b.mudadoEm - a.mudadoEm);
}

export type QuadroComProjeto = { quadro: QuadroDto; projeto: string | null };

/** Os grupos da vista. `pessoaId` decide o "Minhas" (as que perguntaram a ela e as sem bot, que são dela). */
export function gruposDasTarefas(qs: readonly QuadroComProjeto[], vista: VistaDasTarefas, f: FiltrosDasTarefas, agora: number): GrupoDasTarefas[] {
  const todas: { q: QuadroComProjeto; l: LinhaDaTarefa; aberta: boolean }[] = [];
  for (const q of qs) {
    for (const t of q.quadro.tarefas) {
      const col = q.quadro.colunas.find((c) => c.id === t.status);
      todas.push({ q, l: linhaDaTarefa(q.quadro, t, agora), aberta: emAberto(col) });
    }
  }
  const passa = todas.filter((x) => (!f.emAberto || x.aberta) && casa(x.l, f.busca) && (vista !== "minhas" || x.l.perguntou || x.l.agenteId === null));
  if (vista === "quadro") {
    return qs.map(({ quadro, projeto }) => ({
      chave: quadro.id, projeto: projeto ?? "Sem projeto", nome: quadro.nome ?? "Tarefas", agenteId: quadro.agenteId, agenteNome: quadro.agenteNome,
      quadroId: quadro.id, progresso: quadro.total > 0 ? Math.round((100 * quadro.feitas) / quadro.total) : 0,
      linhas: ordenar(passa.filter((x) => x.q.quadro.id === quadro.id).map((x) => x.l), f.porPrioridade, true),
    }));
  }
  if (vista === "minhas") {
    return passa.length ? [{ chave: "minhas", projeto: null, nome: "Com você", agenteId: null, agenteNome: "", quadroId: null, progresso: null, linhas: ordenar(passa.map((x) => x.l), f.porPrioridade) }] : [];
  }
  const porBot = new Map<string, { nome: string; linhas: LinhaDaTarefa[] }>();
  for (const x of passa) {
    const k = x.l.agenteId ?? "";
    const g = porBot.get(k) ?? { nome: x.l.agenteNome ?? "Você", linhas: [] };
    g.linhas.push(x.l);
    porBot.set(k, g);
  }
  return [...porBot].map(([k, g]) => ({ chave: k || "voce", projeto: null, nome: g.nome, agenteId: k || null, agenteNome: g.nome, quadroId: null, progresso: null, linhas: ordenar(g.linhas, f.porPrioridade) }))
    .sort((a, b) => b.linhas.length - a.linhas.length || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** "3 quadros, 2 projetos" (o subtítulo). */
export function resumoDosQuadros(qs: readonly QuadroComProjeto[]): string {
  const n = qs.length;
  const projetos = new Set(qs.map((q) => q.quadro.projetoId).filter((p): p is string => !!p)).size;
  const quadros = `${n} ${n === 1 ? "quadro" : "quadros"}`;
  return projetos ? `${quadros}, ${projetos} ${projetos === 1 ? "projeto" : "projetos"}` : quadros;
}

/** Quantas perguntam à pessoa agora (o chip "1 te perguntou"). */
export function quantasPerguntaram(qs: readonly QuadroComProjeto[], agora: number): number {
  let n = 0;
  for (const { quadro } of qs) for (const t of quadro.tarefas) if (direitaDaTarefa(t, agora).texto === "te perguntou") n++;
  return n;
}
