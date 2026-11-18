import type { Estado } from "../estado/reducer.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { agente } from "./trabalhos.ts";

/**
 * A tarefa nova da pessoa (ADR-187 §7, lote B, passo 2, definido em 2026-11-18; Paper "O chat limpo da tarefa nova", 3b, e
 * "Levando a conversa", 3e). Abre por ⌘N (Alt+N fora do Mac, ⌃N no navegador do Mac), pelo "+" da aba presa ao campo e
 * pela aba "+ Nova tarefa". A tela nasce limpa e nada existe no servidor até a primeira mensagem, que vira o pedido
 * (`POST agentes/:id/trabalhos`); sair antes não deixa nada. Aqui só o HTML e as regras sem DOM; o resto mora no main.
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/**
 * O bot aceita uma tarefa aberta pela pessoa? Só o bot dela que não seja o Nod (o Nod cuida da conta, não abre tarefas).
 * As outras guardas (a conversa carregada, com IA, fora das boas-vindas) dependem da tela e ficam no main. Validação de
 * 2026-11-18: o perfil ainda não confirmado não segura — o bot já conversa e abre tarefas sozinho (a Frida abriu duas), e
 * o servidor (abrirTarefaDaPessoa) também não olha o `confirmado`; só a aba sumia.
 */
export function botAceitaTarefa(estado: Pick<Estado, "frota" | "sessao">, agenteId: string | null | undefined): agenteId is string {
  if (!agenteId || !estado.sessao) return false;
  const bot: Agente | undefined = estado.frota?.agentes.find((a) => a.id === agenteId);
  return !!bot && bot.ownerId === estado.sessao.pessoaId && bot.papel !== "nod";
}

const ICONE_VOLTAR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5L2.5 8 7 12.5"/><path d="M2.5 8H13.5"/></svg>';
const ICONE_CONVERSA = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h10a1 1 0 011 1v6.5a1 1 0 01-1 1H7.5L4.5 14v-2.5H3a1 1 0 01-1-1V4a1 1 0 011-1z"/></svg>';
const ICONE_FEITO = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

/** O topo (Paper 3b): "← Conversa" e o chip "Ada · Nova tarefa", no lugar do topo da tarefa. */
export function renderTopoNovaTarefa(estado: Estado, agenteId: string): string {
  const bot = agente(estado, agenteId);
  const nome = bot?.nome ?? "bot";
  const voltar = `<button type="button" class="tk-voltar" data-act="fechar-trabalho" aria-label="Voltar para a conversa">${ICONE_VOLTAR}<span>Conversa</span></button>`;
  const chip = `<span class="tk-chip">${bot ? iconeAgente(bot, "sm", "disponivel") : ""}<span class="tk-titulo nt-titulo">${esc(nome)} · <b>Nova tarefa</b></span></span>`;
  return `<div class="tk-topo tk-topo-frente nt-topo">${voltar}${chip}</div>`;
}

/**
 * O miolo vazio (Paper 3b): a pergunta, o que a tarefa leva e o "Levar o contexto da conversa" (Paper 3e), uma chave de
 * ligar e desligar (`aria-pressed`). Ligada, a linha embaixo diz o que vai junto. "Escolher a pasta" fica para depois.
 */
export function renderNovaTarefa(estado: Estado, agenteId: string, levarConversa: boolean): string {
  const nome = agente(estado, agenteId)?.nome ?? "o bot";
  const leva = levarConversa
    ? `A tarefa leva as últimas falas da conversa com ${esc(nome)}, roda à parte e avisa na conversa quando terminar.`
    : `Começa limpa, sem o histórico da conversa. ${esc(nome)} leva a memória e os acessos, roda à parte e avisa na conversa quando terminar.`;
  const chave = `<button type="button" class="nt-chip" data-act="nova-tarefa-contexto" aria-pressed="${levarConversa}">${levarConversa ? ICONE_FEITO : ICONE_CONVERSA}<span>Levar o contexto da conversa</span></button>`;
  return `<div class="timeline tk-timeline nt-timeline"><section class="nt-vazia" aria-labelledby="nt-pergunta"><h2 id="nt-pergunta">O que ${esc(nome)} vai fazer nesta tarefa?</h2><p class="nt-texto">${leva}</p><div class="nt-chips">${chave}</div></section></div>`;
}

/** O que o campo da tarefa nova diz (Paper 3b). */
export const PLACEHOLDER_NOVA_TAREFA = "Mensagem para a nova tarefa";
