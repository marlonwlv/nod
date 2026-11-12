// O cenário "quadro" do teste de carga da tela (definido em 2026-11-12, fase 0 da migração do front): o quadro do bot
// pesado à vista com TAREFAS cards, os outros bots escrevendo (cada turno que começa ou acaba é um frame que o quadro
// ouvia) e a pessoa arrastando cards entre duas colunas — às vezes dois arrastos seguidos, o segundo ainda com o
// primeiro no ar. Mede, além do que o medir.ts já mede: quantas vezes a grade foi regravada, quantos GET do quadro a
// aba fez e quantos arrastos chegaram ao servidor (o resto foi descartado na tela).
import { avaliar, type Cdp } from "./cdp.ts";
import { api, escrever, type Bot, type Sessao } from "./comum.ts";

const TAREFAS = Number(process.env.CARGA_TAREFAS ?? 24);
/** Intervalo entre arrastos; a cada PAR_A_CADA, um segundo arrasto sai PAR_MS depois do primeiro. */
const ARRASTO_MS = Number(process.env.CARGA_ARRASTO_MS ?? 1200);
const PAR_A_CADA = 3;
const PAR_MS = 150;
/** As duas colunas do vaivém: abertas no quadro novo e sem passagem, então soltar nelas não começa trabalho. */
export const COLUNA_A = "revisao";
export const COLUNA_B = "bloqueado";

type TarefaApi = { id: string; status: string };

/** Liga o experimento, cria o quadro do bot pesado e as tarefas (metade em cada coluna). Roda no banco recém-copiado. */
export async function prepararQuadro(s: Sessao, pesada: Bot): Promise<void> {
  await api(s, "PUT", "preferencias", { experimentos: { quadro: true } });
  try {
    await api(s, "POST", `agentes/${pesada.id}/quadro`, { nome: "Carga" });
  } catch {
    // já existe
  }
  for (let i = 0; i < TAREFAS; i++) {
    await api(s, "POST", `agentes/${pesada.id}/quadro/tarefas`, { titulo: `Tarefa de carga ${i + 1}`, status: i % 2 ? COLUNA_B : COLUNA_A, agente: null });
  }
}

export async function tarefasPorColuna(s: Sessao, pesada: Bot): Promise<Record<string, number>> {
  const { quadro } = await api<{ quadro: { tarefas: TarefaApi[] } | null }>(s, "GET", `agentes/${pesada.id}/quadro`);
  const r: Record<string, number> = {};
  for (const t of quadro?.tarefas ?? []) r[t.status] = (r[t.status] ?? 0) + 1;
  return r;
}

/** Entra no modo Quadro da conversa aberta e espera os cards; instala os contadores de regravação e de leitura. */
export async function abrirQuadro(cdp: Cdp): Promise<void> {
  // A pílula de páginas (casca r3): o ícone Tarefas; o Conversa | Quadro de antes, se for o que a página tem.
  for (let i = 0; i < 50 && !(await avaliar<boolean>(cdp, `!!document.querySelector('#cabecalho [data-act="pagina"][data-pg-id="tarefas"], #cabecalho [data-act="modo-da-conversa"][data-modo="quadro"]')`)); i++) await new Promise((r) => setTimeout(r, 200));
  await avaliar(cdp, `document.querySelector('#cabecalho [data-act="pagina"][data-pg-id="tarefas"], #cabecalho [data-act="modo-da-conversa"][data-modo="quadro"]')?.click()`);
  for (let i = 0; i < 150 && !(await avaliar<boolean>(cdp, `!!document.querySelector("#quadro li.qd-card[data-tarefa]")`)); i++) await new Promise((r) => setTimeout(r, 200));
  const visto = await avaliar<Record<string, unknown>>(cdp, `({ paginas: [...document.querySelectorAll('#cabecalho [data-act="pagina"]')].map((b) => b.dataset.pgId), cards: document.querySelectorAll("#quadro li.qd-card[data-tarefa]").length, arrastaveis: document.querySelectorAll('#quadro li.qd-card[draggable="true"]').length, colunas: [...document.querySelectorAll("#quadro section.qd-col[data-coluna]")].map((c) => c.dataset.coluna) })`);
  escrever(`quadro à vista: ${JSON.stringify(visto)}`);
  await new Promise((r) => setTimeout(r, 2000));
  await avaliar(cdp, `(() => { const c = window.__carga; c.quadro = { regravacoes: 0, leituras: 0 };
    const qd = document.querySelector("#quadro"); if (qd) new MutationObserver(() => c.quadro.regravacoes++).observe(qd, { childList: true, subtree: false });
    const conteudo = document.querySelector("#quadro > .qd-conteudo"); if (conteudo) new MutationObserver(() => c.quadro.regravacoes++).observe(conteudo, { childList: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/\\/quadro(\\?[^/]*)?$/.test(e.name)) c.quadro.leituras++; }).observe({ type: "resource" });
    return true; })()`);
}

/** Um arrasto completo (dragstart → dragover → drop → dragend) de um card da coluna `de` para a `para`. */
const ARRASTAR = (de: string, para: string): string => `(() => {
  const card = [...document.querySelectorAll('#quadro section.qd-col[data-coluna="${de}"] li.qd-card[draggable="true"][data-tarefa]')].find((e) => e.offsetParent);
  const col = document.querySelector('#quadro section.qd-col[data-coluna="${para}"]');
  if (!card || !col) return false;
  card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() }));
  col.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  col.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  card.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  return true;
})()`;

/** Arrasta de A para B até `parar()`; devolve quantos arrastos a tela aceitou disparar. */
export async function arrastarAte(cdp: Cdp, parar: () => boolean): Promise<number> {
  let n = 0;
  for (let i = 0; !parar(); i++) {
    if (await avaliar<boolean>(cdp, ARRASTAR(COLUNA_A, COLUNA_B))) n++;
    if (i % PAR_A_CADA === PAR_A_CADA - 1) {
      await new Promise((r) => setTimeout(r, PAR_MS));
      if (await avaliar<boolean>(cdp, ARRASTAR(COLUNA_A, COLUNA_B))) n++;
    }
    await new Promise((r) => setTimeout(r, ARRASTO_MS));
  }
  return n;
}
