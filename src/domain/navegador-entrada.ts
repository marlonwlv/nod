import type { EntradaNavegador } from "../contracts/navegador-do-bot.ts";

/**
 * A entrada da pessoa no navegador do bot (ADR-190, decisão 4): o que a web manda pelo canal ao vivo, conferido e
 * traduzido para o agent-browser. Puro.
 *
 * definido em 2026-11-20 (o validador do OpenMausBot, comportamento e não código): números finitos dentro do viewport,
 * texto até 4096, tecla e código até 64, modificadores no bitmask do CDP (Alt 1, Control 2, Meta 4, Shift 8). O que não
 * passa é ignorado: a web nunca escolhe comando, flag, porta nem método do CDP.
 */
export const TEXTO_MAX_ENTRADA = 4096;
const TECLA_MAX = 64;
const DELTA_MAX = 10_000;

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numero = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const inteiro = (v: unknown, min: number, max: number): v is number => numero(v, min, max) && Number.isInteger(v);
const textoAte = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

const EVENTOS_MOUSE = ["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"] as const;
const EVENTOS_TECLA = ["keyDown", "keyUp", "char"] as const;
const BOTOES = ["left", "right", "middle"] as const;

/** definido em 2026-11-20: a área da vista vai de 120 px (o mínimo do palco) a 8192 px (uma tela 8K) em cada lado. */
export const AREA_MIN = 120;
export const AREA_MAX = 8192;

/** A entrada conferida contra o viewport de agora; null = fora do formato (ignorada). */
export function lerEntradaNavegador(cru: unknown, viewport: { w: number; h: number }): EntradaNavegador | null {
  if (!ehObj(cru)) return null;
  if (cru.t === "tamanho") {
    if (!numero(cru.w, AREA_MIN, AREA_MAX) || !numero(cru.h, AREA_MIN, AREA_MAX) || Object.keys(cru).length !== 3) return null;
    return { t: "tamanho", w: Math.round(cru.w), h: Math.round(cru.h) };
  }
  const mods = cru.modificadores ?? 0;
  if (!inteiro(mods, 0, 15)) return null;
  if (cru.t === "mouse") {
    const evento = EVENTOS_MOUSE.find((e) => e === cru.evento);
    if (!evento || !numero(cru.x, 0, viewport.w) || !numero(cru.y, 0, viewport.h)) return null;
    if (cru.botao !== undefined && !BOTOES.some((b) => b === cru.botao)) return null;
    const cliques = cru.cliques ?? 0;
    const dx = cru.dx ?? 0;
    const dy = cru.dy ?? 0;
    if (!inteiro(cliques, 0, 3) || !numero(dx, -DELTA_MAX, DELTA_MAX) || !numero(dy, -DELTA_MAX, DELTA_MAX)) return null;
    return { t: "mouse", evento, x: cru.x, y: cru.y, ...(cru.botao ? { botao: cru.botao as (typeof BOTOES)[number] } : {}), cliques, dx, dy, modificadores: mods };
  }
  if (cru.t === "tecla") {
    const evento = EVENTOS_TECLA.find((e) => e === cru.evento);
    if (!evento) return null;
    if (cru.texto !== undefined && !textoAte(cru.texto, TEXTO_MAX_ENTRADA)) return null;
    if (cru.codigo !== undefined && !textoAte(cru.codigo, TECLA_MAX)) return null;
    if (cru.tecla !== undefined && !textoAte(cru.tecla, TECLA_MAX)) return null;
    if (evento === "char") {
      if (typeof cru.texto !== "string" || cru.texto === "") return null;
      return { t: "tecla", evento, texto: cru.texto, modificadores: mods };
    }
    if (typeof cru.tecla !== "string" || cru.tecla === "") return null;
    return { t: "tecla", evento, tecla: cru.tecla, ...(typeof cru.codigo === "string" ? { codigo: cru.codigo } : {}), ...(typeof cru.texto === "string" ? { texto: cru.texto } : {}), modificadores: mods };
  }
  return null;
}

/**
 * As teclas que vão como `press` (o agent-browser resolve o código virtual e o texto que o `input_keyboard` cru não
 * leva). medido em 2026-11-20 (agent-browser 0.43.0, Chrome for Testing 156): `input_keyboard` keyDown "Backspace" pelo
 * stream não apaga nada; `press Backspace` pelo relay apaga.
 */
export const TECLAS_DISCRETAS: ReadonlySet<string> = new Set(["Backspace", "Enter", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const SO_MODIFICADOR: ReadonlySet<string> = new Set(["Alt", "Control", "Meta", "Shift"]);
const ACORDE = [[1, "Alt"], [2, "Control"], [4, "Meta"], [8, "Shift"]] as const;

/**
 * O que vai ao agent-browser: `stream` = mensagem pelo WebSocket de quadros; `relay` = comando `press` ou `insertText`
 * pelo `POST /api/command` do mesmo daemon. medido em 2026-11-20: um clique pelo stream seguido na hora de um
 * `insertText` pelo relay cai no campo clicado (a ordem se mantém).
 */
export type ComandoDaEntrada =
  | { via: "stream"; mensagem: Readonly<Record<string, unknown>> }
  | { via: "relay"; comando: { action: "press"; key: string } | { action: "keyboard"; subaction: "insertText"; text: string } };

/** Um atalho (Control, Alt ou Meta; Shift sozinho com um caractere é só a letra maiúscula). */
function ehAtalho(tecla: string, mods: number): boolean {
  if (SO_MODIFICADOR.has(tecla) || mods === 0) return false;
  return !(mods === 8 && [...tecla].length === 1);
}

/**
 * A tradução de uma entrada conferida. medido em 2026-11-20 (mesma bancada): `input_keyboard` com eventType "char" e
 * texto NÃO insere nada, e keyDown com `text` insere "abc" e "çã!" mas não "1234" (só dígitos, mais de um); o
 * `insertText` do relay insere todos. Por isso o `char` da web (texto, colar, acento) vai como insertText; a tecla
 * comum de um caractere segue pelo stream. A tecla solta de um `press` não vai (o press já soltou).
 */
export function comandosDaEntrada(e: EntradaNavegador): ComandoDaEntrada[] {
  // O tamanho não vai ao Chrome como entrada: o portão muda o viewport (`navegadores.tamanho`).
  if (e.t === "tamanho") return [];
  if (e.t === "mouse") {
    const apertoOuSolta = e.evento === "mousePressed" || e.evento === "mouseReleased";
    return [{ via: "stream", mensagem: {
      type: "input_mouse", eventType: e.evento, x: e.x, y: e.y,
      button: e.botao ?? (apertoOuSolta ? "left" : "none"), clickCount: e.cliques || (apertoOuSolta ? 1 : 0),
      deltaX: e.dx ?? 0, deltaY: e.dy ?? 0, modifiers: e.modificadores ?? 0,
    } }];
  }
  const mods = e.modificadores ?? 0;
  if (e.evento === "char") return [{ via: "relay", comando: { action: "keyboard", subaction: "insertText", text: e.texto ?? "" } }];
  const tecla = e.tecla ?? "";
  if (SO_MODIFICADOR.has(tecla)) return [];
  const pelaTecla = TECLAS_DISCRETAS.has(tecla) || ehAtalho(tecla, mods);
  if (pelaTecla) {
    if (e.evento === "keyUp") return [];
    return [{ via: "relay", comando: { action: "press", key: [...ACORDE.filter(([bit]) => mods & bit).map(([, nome]) => nome), tecla].join("+") } }];
  }
  const texto = e.evento === "keyDown" ? (e.texto ?? ([...tecla].length === 1 ? tecla : undefined)) : undefined;
  return [{ via: "stream", mensagem: { type: "input_keyboard", eventType: e.evento, key: tecla, ...(e.codigo ? { code: e.codigo } : {}), ...(texto ? { text: texto } : {}), modifiers: mods } }];
}

/** A entrada põe texto num campo (para a gravação: "Preencheu …"). */
export function entradaDigita(e: EntradaNavegador): boolean {
  if (e.t !== "tecla" || e.evento === "keyUp") return false;
  if (e.evento === "char") return true;
  const tecla = e.tecla ?? "";
  if (tecla === "Backspace" || tecla === "Delete") return true;
  return !TECLAS_DISCRETAS.has(tecla) && !ehAtalho(tecla, e.modificadores ?? 0) && !SO_MODIFICADOR.has(tecla);
}
