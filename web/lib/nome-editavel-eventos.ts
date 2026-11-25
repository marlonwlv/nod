/**
 * Os eventos do nome editável do DS (o HTML e as regras moram em nome-editavel.ts, sem DOM, para as telas): Enter salva,
 * Esc desfaz, sair do campo salva, e o redesenho que tira o campo do DOM não salva o texto pela metade.
 */
import { ATRIBUTO_NOME_EDITAVEL } from "./nome-editavel.ts";

const SELETOR = `input[${ATRIBUTO_NOME_EDITAVEL}]`;

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
