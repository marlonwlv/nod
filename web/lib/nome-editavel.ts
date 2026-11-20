/**
 * O nome que se edita no lugar (DS, revisão de 2026-11-20). Um componente só para todo nome editável da interface — o do
 * bot na gaveta e no perfil do celular, o da conta de IA aberta — para que pareçam e se comportem igual:
 *
 * - É sempre um campo, desenhado como o texto do título: sem borda; no hover, o fundo `--hover`; no foco, `--surface-raised`.
 * - Enter salva, Esc desfaz (volta ao salvo, sem fechar o que está por trás); sair do campo salva.
 * - O redesenho que tira o campo do DOM no meio da digitação não salva o texto pela metade (`preservandoCampo`).
 *
 * Quem mostra um nome editável usa `campoDeNome` e registra o dono com `registrarNomeEditavel`; o teste
 * nome-editavel.test.ts trava que não haja outro campo de nome feito à mão.
 */
import { esc } from "./render.ts";

/** O atributo que marca o campo; o valor é o dono ("bot", "conta"), que decide e grava. */
export const ATRIBUTO_NOME_EDITAVEL = "data-nome-editavel";
const SELETOR = `input[${ATRIBUTO_NOME_EDITAVEL}]`;
export const DICA_NOME_EDITAVEL = "Enter salva · Esc desfaz";

export type CampoDeNome = {
  /** Quem grava: a chave passada a `registrarNomeEditavel`. */
  dono: string;
  /** O que este campo é para o dono ("nome", "titulo", "apelido"). */
  campo: string;
  /** O id do objeto (bot, conta). */
  id: string;
  valor: string;
  /** O rótulo lido pelo leitor de tela. */
  rotulo: string;
  maxlength: number;
  /** O id do input (o `for` do rótulo); sem ele, `nome-<dono>-<campo>`. */
  inputId?: string;
  /** Classes do lugar (tamanho, alinhamento); o desenho do estado vem de `.nome-editavel`. */
  classe?: string;
  placeholder?: string;
  descritoPor?: string;
  /** Atributos a mais, já escapados (ex.: `enterkeyhint="done"`). */
  extra?: string;
};

/** O rótulo escondido e o campo. */
export function campoDeNome(p: CampoDeNome): string {
  const id = p.inputId ?? `nome-${p.dono}-${p.campo}`;
  return `<label class="sr-only" for="${esc(id)}">${esc(p.rotulo)}</label>`
    + `<input id="${esc(id)}" class="${p.classe ? `${esc(p.classe)} ` : ""}nome-editavel" ${ATRIBUTO_NOME_EDITAVEL}="${esc(p.dono)}" data-campo="${esc(p.campo)}" data-id="${esc(p.id)}" data-salvo="${esc(p.valor)}" value="${esc(p.valor)}" maxlength="${p.maxlength}" autocomplete="off" spellcheck="false"`
    + `${p.placeholder ? ` placeholder="${esc(p.placeholder)}"` : ""} title="${DICA_NOME_EDITAVEL}"${p.descritoPor ? ` aria-describedby="${esc(p.descritoPor)}"` : ""}${p.extra ? ` ${p.extra}` : ""} />`;
}

/** Chamado quando o campo perde o foco sem ter sido desfeito (Esc). O dono decide se grava, volta ou avisa. */
export type DonoDoNome = (campo: HTMLInputElement) => void;

const donos = new Map<string, DonoDoNome>();
const instalados = new WeakSet<object>();

// Revisão 3 da NOD-349: o redesenho com o foco num campo tira o input do DOM e o devolve; no Chromium isso dispara
// focusout, que salvaria o texto pela metade. Durante a troca, o focusout não conta.
let trocandoCampo = false;
export function preservandoCampo(trocar: () => void): void {
  const antes = trocandoCampo;
  trocandoCampo = true;
  try { trocar(); } finally { trocandoCampo = antes; }
}

const campoDe = (el: EventTarget | null): HTMLInputElement | null =>
  el instanceof HTMLInputElement && el.matches(SELETOR) ? el : null;

/** Registra quem grava os campos de um dono e, uma vez por documento, liga Enter, Esc e o sair do campo. */
export function registrarNomeEditavel(dono: string, gravar: DonoDoNome, doc: Document = document): void {
  donos.set(dono, gravar);
  if (instalados.has(doc)) return;
  instalados.add(doc);
  // Esc desfaz: o blur que vem depois não salva (a marca vale para aquele blur só).
  const desfeitos = new WeakSet<HTMLInputElement>();
  doc.addEventListener("keydown", (ev) => {
    const campo = campoDe(ev.target);
    if (!campo) return;
    // Revisão da NOD-349: o Enter que confirma a composição do IME não salva; depois de Enter ou Esc o foco volta ao
    // campo (o blur só dispara o salvar), para quem usa teclado não cair no começo da página.
    if (ev.isComposing) return;
    if (ev.key === "Enter") { ev.preventDefault(); campo.blur(); campo.focus(); return; }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      campo.value = campo.dataset.salvo ?? "";
      desfeitos.add(campo);
      campo.blur();
      campo.focus();
    }
  }, true);
  doc.addEventListener("focusout", (ev) => {
    if (trocandoCampo) return;
    const campo = campoDe(ev.target);
    if (!campo) return;
    if (desfeitos.has(campo)) { desfeitos.delete(campo); return; }
    donos.get(campo.getAttribute(ATRIBUTO_NOME_EDITAVEL) ?? "")?.(campo);
  });
}
