import type { AgendaDto } from "../../src/contracts/agenda.ts";
import { janelaDaLista, type VisaoRotinas } from "../lib/agenda.ts";

/**
 * O estado de Configurações › Rotinas (a lista; até 2026-11-19, a agenda da NOD-85). `janela` é o que se pede a GET
 * rotinas/agenda (dias do navegador, `ate` exclusivo): só para trás, de onde vêm a última vez e as últimas 4; `dto` o
 * que chegou dela. A UI guarda a rotina aberta, a visão (Todas, Ativas, Pausadas) e o filtro.
 */
export type AgendaUi = {
  /** O id da rotina aberta na própria linha (computador) ou na folha de baixo (celular). Uma por vez. */
  aberto: string | null;
  /** Celular: a rotina segurada, com o menu de contexto. */
  menu: string | null;
  /** O bot escolhido em "Todos os bots" (vazio = todos; um só por vez). */
  bots: string[];
  /** O link do chat com `problema=1`: só as rotinas paradas ou cuja última vez deu problema. */
  soProblema: boolean;
  visao: VisaoRotinas;
  /** "Ver todas" abriu as ativas além das primeiras. */
  verTodas: boolean;
  pausadasAbertas: boolean;
  /** Desfazer a pausa em lote: o lote com a lista "Ver quais" aberta; null = fechada. */
  loteAberto: string | null;
};

export type EstadoAgenda = { dto: AgendaDto | null; erro: boolean; janela: { de: string; ate: string } | null; ui: AgendaUi };

export const AGENDA_UI_INICIAL: AgendaUi = { aberto: null, menu: null, bots: [], soProblema: false, visao: "todas", verTodas: false, pausadasAbertas: false, loteAberto: null };
export const AGENDA_INICIAL: EstadoAgenda = { dto: null, erro: false, janela: null, ui: AGENDA_UI_INICIAL };

export type AcaoAgenda =
  /** Abre (ou reabre) a lista; o link do chat (`ver_agenda`) abre com o filtro de problema. */
  | { tipo: "agenda-abrir"; hoje: string; soProblema?: boolean }
  | { tipo: "hidratar-agenda"; janela: { de: string; ate: string }; dto: AgendaDto }
  | { tipo: "agenda-falhou"; janela: { de: string; ate: string } }
  | { tipo: "agenda-tentar" }
  | { tipo: "agenda-ui"; mudanca: Partial<AgendaUi> }
  /** "Todos os bots ⌄": um bot, ou null para todos. Fecha a rotina aberta. */
  | { tipo: "agenda-bot"; id: string | null };

/** Precisa ler a janela: ainda não leu (a janela mudou ou abriu agora) e a última leitura não falhou. */
export const agendaPorLer = (a: EstadoAgenda): boolean => !!a.janela && !a.erro && !a.dto;

const TIPOS: ReadonlySet<string> = new Set<AcaoAgenda["tipo"]>(["agenda-abrir", "hidratar-agenda", "agenda-falhou", "agenda-tentar", "agenda-ui", "agenda-bot"]);
export const ehAcaoDaAgenda = (a: { tipo: string }): a is AcaoAgenda => TIPOS.has(a.tipo);

export function reduzirAgenda(a: EstadoAgenda, acao: AcaoAgenda): EstadoAgenda {
  switch (acao.tipo) {
    case "agenda-abrir": {
      const ui: AgendaUi = { ...AGENDA_UI_INICIAL, bots: a.ui.bots, soProblema: !!acao.soProblema };
      // Revisão 1 do PR #595: abrir relê sempre — a lida de ontem não tem o que rodou hoje.
      return { dto: null, erro: false, janela: janelaDaLista(acao.hoje), ui };
    }
    case "hidratar-agenda":
      if (!a.janela || acao.janela.de !== a.janela.de || acao.janela.ate !== a.janela.ate) return a;
      return { ...a, dto: acao.dto, erro: false };
    case "agenda-falhou":
      if (!a.janela || acao.janela.de !== a.janela.de || acao.janela.ate !== a.janela.ate) return a;
      return { ...a, erro: true };
    case "agenda-tentar":
      return { ...a, erro: false, dto: null };
    case "agenda-ui":
      return { ...a, ui: { ...a.ui, ...acao.mudanca } };
    case "agenda-bot":
      return { ...a, ui: { ...a.ui, bots: acao.id ? [acao.id] : [], aberto: null, menu: null } };
  }
}

/**
 * O Esc na lista fecha uma coisa por vez: o menu ou a folha do celular, depois a rotina aberta. Devolve a mudança e o
 * seletor do controle que recebe o foco de volta; null quando não há nada aberto (o Esc segue para fechar as
 * Configurações).
 */
export function escNaAgenda(ui: AgendaUi): { mudanca: Partial<AgendaUi>; foco: string } | null {
  const id = ui.menu ?? ui.aberto;
  if (id !== null) return { mudanca: { aberto: null, menu: null }, foco: `[data-act="agenda-linha"][data-id="${id}"]` };
  return null;
}
