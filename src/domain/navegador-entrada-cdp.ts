import type { EntradaNavegador } from "../contracts/navegador-do-bot.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a entrada da pessoa traduzida para o CDP do Chrome do bot, para ir pela
 * conexão direta da máquina (`entrada-cdp.ts`) e voltar CONFIRMADA (cada chamada do CDP responde). O caminho antigo (o
 * `input_*` do stream do agent-browser) manda sem esperar o Chrome: uma tecla perdida não avisava ninguém. Puro.
 *
 * medido em 2026-11-28 (Chrome 143 sem janela, macOS, Input.* por uma sessão `flatten`): keyDown com `text` insere cada
 * dígito ("12345", com keydown e input no site), rawKeyDown Backspace apaga, Tab muda o foco, `insertText` põe "José" e o
 * texto colado, Enter com `text: "\r"` quebra a linha no textarea; Cmd+A só seleciona com `commands: ["selectAll"]` (o
 * Chrome sem janela não tem os atalhos de edição do sistema), e Ctrl+A sem `commands` não seleciona nada.
 */
export type ChamadaCdp =
  | { metodo: "Input.dispatchMouseEvent"; params: Readonly<Record<string, unknown>> }
  | { metodo: "Input.dispatchKeyEvent"; params: Readonly<Record<string, unknown>> }
  | { metodo: "Input.insertText"; params: { text: string } };

const SO_MODIFICADOR: ReadonlySet<string> = new Set(["Alt", "Control", "Meta", "Shift", "AltGraph", "CapsLock"]);
/** O que o teclado da pessoa manda sem ser tecla do site (a composição do acento chega depois, como o caractere). */
const SEM_EFEITO: ReadonlySet<string> = new Set(["Dead", "Unidentified", "Process", "Compose"]);

/** O código virtual das teclas sem caractere (o Chrome decide o que fazer por ele). */
const VIRTUAIS: Readonly<Record<string, number>> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};
/** As teclas de edição e navegação: vão como rawKeyDown, sem texto (Enter é o único que leva texto, para quebrar linha). */
const DISCRETAS: ReadonlySet<string> = new Set(Object.keys(VIRTUAIS).filter((k) => k !== " "));
/** Os pontos do teclado americano que o `code` diz (o Chrome usa o código virtual do Windows). */
const PONTUACAO: Readonly<Record<string, number>> = {
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
  BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, IntlBackslash: 226, IntlRo: 193,
};
/** Os atalhos de edição que o Chrome sem janela só faz com `commands` (Ctrl no PC, ⌘ no Mac; os dois valem). */
const COMANDOS: Readonly<Record<string, string>> = { a: "selectAll", c: "copy", x: "cut", z: "undo", y: "redo" };

/** O código virtual de uma tecla (o que o Chrome do Windows daria; o do Mac aceita o mesmo pelo CDP). */
export function codigoVirtual(tecla: string, codigo?: string): number {
  if (VIRTUAIS[tecla] !== undefined) return VIRTUAIS[tecla]!;
  if (codigo) {
    const letra = /^Key([A-Z])$/.exec(codigo);
    if (letra) return letra[1]!.charCodeAt(0);
    const digito = /^(?:Digit|Numpad)(\d)$/.exec(codigo);
    if (digito) return (codigo.startsWith("Numpad") ? 96 : 48) + Number(digito[1]);
    if (PONTUACAO[codigo] !== undefined) return PONTUACAO[codigo]!;
    if (codigo === "Space") return 32;
  }
  const c = [...tecla];
  if (c.length === 1) {
    const maiuscula = c[0]!.toUpperCase();
    if (/^[A-Z0-9]$/.test(maiuscula)) return maiuscula.charCodeAt(0);
  }
  return 0;
}

const ACORDE_CTRL = 2;
const ACORDE_META = 4;
const ACORDE_SHIFT = 8;

/** A tecla é um atalho (Ctrl, ⌘ ou Alt; Shift sozinho com um caractere é só a letra maiúscula). */
function ehAtalho(mods: number): boolean {
  return (mods & ~ACORDE_SHIFT) !== 0;
}

/** O que vai ao CDP para uma entrada conferida (`lerEntradaNavegador`). [] = nada a fazer (o tamanho, uma tecla morta). */
export function chamadasCdpDaEntrada(e: EntradaNavegador): ChamadaCdp[] {
  if (e.t === "tamanho") return [];
  const mods = e.modificadores ?? 0;
  if (e.t === "mouse") {
    const apertoOuSolta = e.evento === "mousePressed" || e.evento === "mouseReleased";
    return [{ metodo: "Input.dispatchMouseEvent", params: {
      type: e.evento, x: e.x, y: e.y, modifiers: mods,
      button: e.botao ?? (apertoOuSolta ? "left" : "none"),
      clickCount: e.cliques || (apertoOuSolta ? 1 : 0),
      ...(e.evento === "mouseWheel" ? { deltaX: e.dx ?? 0, deltaY: e.dy ?? 0 } : {}),
    } }];
  }
  if (e.evento === "char") return e.texto ? [{ metodo: "Input.insertText", params: { text: e.texto } }] : [];
  const tecla = e.tecla ?? "";
  if (!tecla || SO_MODIFICADOR.has(tecla) || SEM_EFEITO.has(tecla)) return [];
  const base = { key: tecla, ...(e.codigo ? { code: e.codigo } : {}), windowsVirtualKeyCode: codigoVirtual(tecla, e.codigo), modifiers: mods };
  if (e.evento === "keyUp") return [{ metodo: "Input.dispatchKeyEvent", params: { type: "keyUp", ...base } }];
  if (ehAtalho(mods)) {
    const comando = (mods & (ACORDE_CTRL | ACORDE_META)) && !(mods & ~(ACORDE_CTRL | ACORDE_META | ACORDE_SHIFT)) ? COMANDOS[tecla.toLowerCase()] : undefined;
    const refazer = comando === "undo" && (mods & ACORDE_SHIFT) ? "redo" : comando;
    return [{ metodo: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", ...base, ...(refazer ? { commands: [refazer] } : {}) } }];
  }
  if (tecla === "Enter") return [{ metodo: "Input.dispatchKeyEvent", params: { type: "keyDown", ...base, text: "\r", unmodifiedText: "\r" } }];
  if (DISCRETAS.has(tecla)) return [{ metodo: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", ...base } }];
  const texto = e.texto ?? ([...tecla].length === 1 ? tecla : "");
  if (!texto) return [];
  return [{ metodo: "Input.dispatchKeyEvent", params: { type: "keyDown", ...base, text: texto, unmodifiedText: texto } }];
}

/** A entrada pode cair sem dano se a fila estiver cheia (o mouse andando; o próximo movimento leva a posição nova). */
export function entradaDescartavel(e: EntradaNavegador): boolean {
  return e.t === "mouse" && e.evento === "mouseMoved";
}
