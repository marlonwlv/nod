import type { FrameSse } from "../../src/contracts/frame.ts";
import type { QuadroDaPessoaDto, QuadroDto } from "../../src/contracts/quadro.ts";
import type { QuadrosDoBotDto } from "../../src/contracts/quadros-do-bot.ts";
import { gruposDasTarefas, quantasPerguntaram, resumoDosQuadros, type FiltrosDasTarefas, type QuadroComProjeto, type VistaDasTarefas } from "./tarefas-de-todos.ts";
import { renderTarefasDeTodos, type CargaDasTarefas } from "../telas/tarefas-de-todos.ts";

/**
 * Tela 18d do Paper: a página "Tarefas" de todos os bots. Lê pela API de sempre — a lista dos quadros da pessoa
 * (GET /quadros), cada quadro (GET /quadros/:id) e os projetos (GET /agentes/:id/quadros, do primeiro bot com quadro) — e
 * desenha no `#tdt`, o casco que o main põe na tela `{ tipo: "tarefas" }`. Um `quadro.mudou` relê no fundo, sem piscar.
 */

export type ApiDasTarefas = {
  quadros(): Promise<{ quadros: QuadroDaPessoaDto[] }>;
  quadroPorId(qid: string): Promise<{ quadro: QuadroDto }>;
  quadrosDoBot(agenteId: string): Promise<QuadrosDoBotDto>;
};

export type DepsDasTarefas = {
  api: () => ApiDasTarefas;
  avatar: (agenteId: string | null) => string;
  /** Abre a tarefa no quadro do dono (a conversa dele, página Tarefas, a tarefa aberta). */
  abrirTarefa: (donoId: string, tarefaId: string, quadroId: string) => void;
  /** Abre a página Tarefas do bot (no quadro pedido, se houver). */
  abrirPagina: (agenteId: string, quadroId: string | null) => void;
  agora?: () => number;
  agendar?: (f: () => void) => void;
};

export type TarefasDeTodosNaTela = {
  abrir(): void;
  fechar(): void;
  aberta(): boolean;
  montar(): void;
  aoFrame(frame: FrameSse): void;
  reler(): void;
};

export function criarTarefasDeTodosNaTela(doc: Document, deps: DepsDasTarefas): TarefasDeTodosNaTela {
  let aberta = false;
  let quadros: QuadroComProjeto[] | null = null;
  let erro: string | null = null;
  let vista: VistaDasTarefas = "quadro";
  const filtros: FiltrosDasTarefas = { busca: "", emAberto: true, porPrioridade: false };
  let leitura = 0;
  let agendada = false;
  const agora = deps.agora ?? (() => Date.now());
  const agendar = deps.agendar ?? ((f: () => void) => { setTimeout(f, 250); });
  const caixa = (): HTMLElement | null => doc.getElementById("tdt");

  async function ler(): Promise<void> {
    const n = ++leitura;
    try {
      const api = deps.api();
      const lista = (await api.quadros()).quadros;
      const [cheios, projetos] = await Promise.all([
        Promise.all(lista.map((q) => api.quadroPorId(q.id).then((r) => r.quadro).catch(() => null))),
        lista[0] ? api.quadrosDoBot(lista[0].agenteId).then((r) => r.projetos).catch(() => []) : Promise.resolve([]),
      ]);
      if (n !== leitura || !aberta) return;
      const nomes = new Map(projetos.map((p) => [p.id, p.nome]));
      quadros = cheios.filter((q): q is QuadroDto => q !== null).map((q) => ({ quadro: q, projeto: q.projetoId ? nomes.get(q.projetoId) ?? null : null }));
      erro = null;
    } catch {
      if (n !== leitura || !aberta) return;
      if (!quadros) erro = "Não deu para ler os quadros.";
    }
    desenhar();
  }

  function carga(): CargaDasTarefas {
    if (erro) return { tipo: "erro", mensagem: erro };
    if (!quadros) return { tipo: "carregando" };
    const t = agora();
    return { tipo: "pronto", grupos: gruposDasTarefas(quadros, vista, filtros, t), resumo: resumoDosQuadros(quadros), perguntaram: quantasPerguntaram(quadros, t), total: quadros.length };
  }

  function desenhar(): void {
    const el = caixa();
    if (!el) return;
    const campo = el.querySelector<HTMLInputElement>('[data-tdt="busca"]');
    const comFoco = !!campo && doc.activeElement === campo;
    const sel = campo ? [campo.selectionStart, campo.selectionEnd] as const : null;
    el.innerHTML = renderTarefasDeTodos({ carga: carga(), vista, filtros, avatar: deps.avatar });
    if (comFoco) {
      const novo = el.querySelector<HTMLInputElement>('[data-tdt="busca"]');
      novo?.focus();
      if (novo && sel) novo.setSelectionRange(sel[0], sel[1]);
    }
    ligar(el);
  }

  function ligar(el: HTMLElement): void {
    if (el.dataset.ligado === "1") return;
    el.dataset.ligado = "1";
    el.addEventListener("click", (ev) => {
      const alvo = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!alvo || !el.contains(alvo)) return;
      const act = alvo.dataset.act;
      if (act === "tdt-vista") { vista = (alvo.dataset.vista as VistaDasTarefas | undefined) ?? "quadro"; desenhar(); return; }
      if (act === "tdt-aberto") { filtros.emAberto = !filtros.emAberto; desenhar(); return; }
      if (act === "tdt-prioridade") { filtros.porPrioridade = !filtros.porPrioridade; desenhar(); return; }
      if (act === "tdt-reler") { erro = null; desenhar(); void ler(); return; }
      if (act === "tdt-abrir") { const { dono, tarefa, quadro } = alvo.dataset; if (dono && tarefa && quadro) deps.abrirTarefa(dono, tarefa, quadro); return; }
      if (act === "tdt-pagina") { const a = alvo.dataset.agente; if (a) deps.abrirPagina(a, alvo.dataset.quadro ?? null); return; }
      if (act === "tdt-nova") { const q = quadros?.[0]?.quadro; if (q) deps.abrirPagina(q.agenteId, q.id); }
    });
    el.addEventListener("input", (ev) => {
      const t = ev.target as HTMLElement;
      if (t instanceof HTMLInputElement && t.dataset.tdt === "busca") { filtros.busca = t.value; desenhar(); }
    });
  }

  return {
    abrir() {
      if (aberta) return;
      aberta = true;
      void ler();
    },
    fechar() { aberta = false; leitura++; },
    aberta: () => aberta,
    montar() {
      const el = caixa();
      if (el && !el.firstElementChild) desenhar();
    },
    aoFrame(frame) {
      if (!aberta || frame.tipo !== "quadro.mudou" || agendada) return;
      agendada = true;
      agendar(() => { agendada = false; if (aberta) void ler(); });
    },
    reler() { if (aberta) void ler(); },
  };
}
