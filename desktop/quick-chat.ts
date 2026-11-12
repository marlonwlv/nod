import type { ResultadoAtalhoQuickChat } from "../src/contracts/desktop-mac.ts";

/**
 * Quick Chat (ADR-171, definido em 2026-11-12): um atalho global abre, de qualquer app, uma janela pequena (560×392, o cartão da tela 10 do Paper — a sombra é a do macOS;
 * a medida do Grok Bot) com a conversa do nod em modo compacto (`?janela=quick-chat`). A janela é a MESMA página web
 * da janela principal, na mesma partição e com o mesmo preload (`preload-web.cjs`): nenhuma ponte nova para a página
 * remota além das funções nomeadas da captura e do atalho, validadas no processo principal.
 *
 * Sem Electron aqui: o `globalShortcut` e a janela entram por dependência, para o teste unitário ler sem app.
 */

export const LARGURA_QUICK_CHAT = 560;
export const ALTURA_QUICK_CHAT = 392;
/** definido em 2026-11-12: ⌥Espaço, como no protótipo do Paper (tela 10); a pessoa troca em Ajustes > Geral. */
export const ATALHO_PADRAO_QUICK_CHAT = "Alt+Space";
/** O parâmetro que põe a web no modo compacto (web/lib/quick-chat.ts lê o mesmo nome). */
export const PARAMETRO_QUICK_CHAT = "janela";
export const VALOR_QUICK_CHAT = "quick-chat";

const MODIFICADORES: Readonly<Record<string, string>> = {
  command: "Command", cmd: "Command", commandorcontrol: "CommandOrControl", cmdorctrl: "CommandOrControl",
  control: "Control", ctrl: "Control", alt: "Alt", option: "Alt", shift: "Shift",
};
const ORDEM = ["CommandOrControl", "Command", "Control", "Alt", "Shift"];
const TECLAS_NOMEADAS: Readonly<Record<string, string>> = { space: "Space", espaco: "Space", enter: "Enter", return: "Enter", tab: "Tab", "/": "/", ".": ".", ",": ",", ";": ";", "'": "'", "[": "[", "]": "]", "\\": "\\", "-": "-", "=": "=", "`": "`" };

/**
 * Lê um atalho vindo da página (texto livre) e devolve o accelerator canônico do Electron, ou null. Exige pelo menos
 * um modificador (uma letra sozinha roubaria a digitação de todos os apps), exceto F13–F24, que nenhum app usa para
 * digitar. definido em 2026-11-12: Shift sozinho não conta como modificador (Shift+A é só "A" maiúsculo).
 */
export function lerAtalho(bruto: unknown): string | null {
  if (typeof bruto !== "string" || bruto.length === 0 || bruto.length > 60) return null;
  const partes = bruto.split("+").map((p) => p.trim()).filter(Boolean);
  if (bruto.endsWith("++")) partes.push("+");
  if (partes.length === 0 || partes.length > 5) return null;
  const mods = new Set<string>();
  let tecla: string | null = null;
  for (const p of partes) {
    const mod = MODIFICADORES[p.toLowerCase()];
    if (mod) { mods.add(mod); continue; }
    if (tecla !== null) return null;
    tecla = normalizarTecla(p);
    if (tecla === null) return null;
  }
  if (tecla === null) return null;
  const fAlta = /^F(1[3-9]|2[0-4])$/.test(tecla);
  const comModificadorDeVerdade = [...mods].some((m) => m !== "Shift");
  if (!comModificadorDeVerdade && !fAlta) return null;
  return [...ORDEM.filter((m) => mods.has(m)), tecla].join("+");
}

function normalizarTecla(p: string): string | null {
  const nomeada = TECLAS_NOMEADAS[p.toLowerCase()];
  if (nomeada) return nomeada;
  if (/^[a-z0-9]$/i.test(p)) return p.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(p)) return p.toUpperCase();
  return null;
}

/** Onde a janela nasce: centrada na horizontal da tela do cursor, a um terço da altura (como o Spotlight). */
export function posicaoDaJanela(area: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const width = Math.min(LARGURA_QUICK_CHAT, area.width);
  const height = Math.min(ALTURA_QUICK_CHAT, area.height);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + Math.max(0, (area.height - height) / 3)), width, height };
}

/** A URL da janela: a origem do servidor com o modo compacto. Só a origem do servidor; nada vindo da página. */
export function urlDoQuickChat(servidor: string, agenteId?: string): string {
  const u = new URL(servidor);
  u.pathname = "/";
  u.search = "";
  u.hash = "";
  u.searchParams.set(PARAMETRO_QUICK_CHAT, VALOR_QUICK_CHAT);
  // O avatar da mesa abre o Quick Chat já num bot (a página navega para a conversa dele ao carregar).
  if (agenteId) u.searchParams.set("bot", agenteId);
  return u.toString();
}

export type JanelaQuickChat = {
  visivel(): boolean;
  mostrar(): void;
  esconder(): void;
  destruida(): boolean;
};

export type DepsQuickChat = {
  /** globalShortcut.register / unregister do Electron. `registrar` devolve false quando outro app já usa o atalho. */
  registrar(atalho: string, fn: () => void): boolean;
  desregistrar(atalho: string): void;
  /** Cria a janela (escondida) já carregando a URL do modo compacto; null sem servidor conectado. */
  criarJanela(): JanelaQuickChat | null;
};

export type QuickChat = {
  /** Troca o atalho; null desliga. Recusa o inválido e o que outro app usa, mantendo o anterior. */
  definirAtalho(atalho: unknown): ResultadoAtalhoQuickChat;
  atalho(): string | null;
  /** O que o atalho faz: abre (criando se preciso) ou esconde a janela. */
  alternar(): void;
  /** O ✕, o Esc e o ⤢ da página: só esconde (a conversa fica carregada para a próxima vez). */
  esconder(): void;
  /** Ao desconectar ou sair: solta o atalho e esquece a janela. */
  desligar(): void;
};

export function criarQuickChat(deps: DepsQuickChat, inicial: string | null): QuickChat {
  let atual: string | null = null;
  let janela: JanelaQuickChat | null = null;
  const alternar = (): void => {
    if (janela?.destruida()) janela = null;
    if (janela?.visivel()) { janela.esconder(); return; }
    janela ??= deps.criarJanela();
    janela?.mostrar();
  };
  const definirAtalho = (bruto: unknown): ResultadoAtalhoQuickChat => {
    if (bruto === null) {
      if (atual) deps.desregistrar(atual);
      atual = null;
      return { ok: true, atalho: null };
    }
    const novo = lerAtalho(bruto);
    if (!novo) return { ok: false, motivo: "invalido", atalho: atual };
    if (novo === atual) return { ok: true, atalho: atual };
    if (!deps.registrar(novo, alternar)) return { ok: false, motivo: "em_uso", atalho: atual };
    if (atual) deps.desregistrar(atual);
    atual = novo;
    return { ok: true, atalho: atual };
  };
  if (inicial !== null) definirAtalho(inicial);
  return {
    definirAtalho,
    atalho: () => atual,
    alternar,
    esconder() { if (janela && !janela.destruida()) janela.esconder(); },
    desligar() {
      if (atual) deps.desregistrar(atual);
      atual = null;
      if (janela && !janela.destruida()) janela.esconder();
      janela = null;
    },
  };
}

/** A frase do Grok Bot para o atalho em uso, em português (a tela de Ajustes mostra esta). */
export const FRASE_ATALHO_EM_USO = "Outro app já usa esse atalho. Escolha outro.";
