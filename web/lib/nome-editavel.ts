/**
 * O nome que se edita no lugar (DS, revisão de 2026-11-20). Um componente só para todo nome editável da interface — o do
 * bot na gaveta e no perfil do celular, o da conta de IA aberta — para que pareçam e se comportem igual:
 *
 * - É sempre um campo, desenhado como o texto do título: sem borda; no hover, o fundo `--hover`; no foco, `--surface-raised`.
 * - Enter salva, Esc desfaz (volta ao salvo, sem fechar o que está por trás); sair do campo salva.
 * - O redesenho que tira o campo do DOM no meio da digitação não salva o texto pela metade (`preservandoCampo`).
 *
 * Quem mostra um nome editável usa `campoDeNome` (aqui, sem DOM, para as telas) e registra o dono com
 * `registrarNomeEditavel` (nome-editavel-eventos.ts, o teclado e o foco); o teste nome-editavel.test.ts trava que não haja
 * outro campo de nome feito à mão.
 */
import { esc } from "./escape.ts";

/** O atributo que marca o campo; o valor é o dono ("bot", "conta"), que decide e grava. */
export const ATRIBUTO_NOME_EDITAVEL = "data-nome-editavel";
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
