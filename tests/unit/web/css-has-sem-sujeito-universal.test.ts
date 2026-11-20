import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-189 (medido em 2026-11-19, scripts/carga-tela com CARGA_TRACE_S): uma regra com `:has()` cujo SUJEITO (o último
 * composto do seletor) casa com qualquer elemento — `*`, `:not(.x)`, `.app *` — faz o Chrome invalidar a subárvore
 * inteira da âncora do `:has()` toda vez que um nó entra ou sai do DOM perto dela. Com a âncora no `html` ou no `.stage`,
 * cada mascote que repintava o SVG e cada bloco novo da conversa recalculava o estilo de ~40 mil elementos (~180 ms, a
 * tarefa longa que segurava a tecla no campo). O sujeito precisa nomear o que estiliza: uma classe, um id, uma tag ou um
 * atributo. Quando a condição é "a página inteira está num estado", ela vira uma classe no `<html>` posta pelo JS.
 */
const RAIZ = fileURLToPath(new URL("../../../web/", import.meta.url));

function arquivosCss(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const caminho = join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" || d.name === "vendor" || d.name === "public" ? [] : arquivosCss(caminho);
    return d.name.endsWith(".css") ? [caminho] : [];
  });
}

/** Os seletores de cada regra (o texto antes de `{`, sem @media/@supports/@container e sem comentários). */
export function seletoresDoCss(css: string): string[] {
  const sem = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const saida: string[] = [];
  let i = 0;
  let inicio = 0;
  let dentroDeDeclaracao = false;
  const pilha: boolean[] = []; // true = bloco de regra (declarações); false = bloco de @-regra que contém regras
  while (i < sem.length) {
    const c = sem[i];
    if (c === "{") {
      const cabeca = sem.slice(inicio, i).trim();
      const ehArroba = cabeca.startsWith("@");
      if (!dentroDeDeclaracao && !ehArroba && cabeca) saida.push(...dividirLista(cabeca));
      pilha.push(!ehArroba);
      dentroDeDeclaracao = !ehArroba;
      inicio = i + 1;
    } else if (c === "}") {
      pilha.pop();
      dentroDeDeclaracao = pilha.at(-1) ?? false;
      inicio = i + 1;
    } else if (c === ";" && !dentroDeDeclaracao) {
      inicio = i + 1; // @import, @charset…
    }
    i++;
  }
  return saida;
}

/** Divide "a, b:is(c, d)" pelas vírgulas de fora dos parênteses. */
function dividirLista(lista: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const c of lista) {
    if (c === "(" || c === "[") nivel++;
    if (c === ")" || c === "]") nivel--;
    if (c === "," && nivel === 0) { partes.push(atual.trim()); atual = ""; continue; }
    atual += c;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

/** O último composto do seletor (depois do último combinador de fora dos parênteses). */
export function sujeito(seletor: string): string {
  let nivel = 0;
  let corte = 0;
  for (let i = 0; i < seletor.length; i++) {
    const c = seletor[i];
    if (c === "(" || c === "[") nivel++;
    else if (c === ")" || c === "]") nivel--;
    else if (nivel === 0 && (c === " " || c === ">" || c === "+" || c === "~")) corte = i + 1;
  }
  return seletor.slice(corte).trim();
}

/**
 * Pseudo-elementos que moram na shadow DOM do navegador (`::placeholder`, `::-webkit-*`…): a invalidação atravessa a
 * fronteira e o Chrome invalida a subárvore inteira da âncora, como um sujeito universal (medido no mesmo trace).
 */
const PSEUDO_DA_SHADOW_DO_NAVEGADOR = /::(?:placeholder|-webkit-|-moz-|file-selector-button|part|slotted|cue|backdrop)/;

/** O composto casa com qualquer elemento? (nada que o nomeie fora de :not/:has/pseudo) */
export function sujeitoUniversal(composto: string): boolean {
  if (PSEUDO_DA_SHADOW_DO_NAVEGADOR.test(composto)) return true;
  // :is()/:where() com algum ramo universal também é universal.
  const is = /^:(?:is|where)\((.*)\)$/.exec(composto);
  if (is) return dividirLista(is[1] ?? "").some((ramo) => sujeitoUniversal(sujeito(ramo)));
  // Tira o que não nomeia: :not(...), :has(...), pseudo-classes e pseudo-elementos com ou sem argumento.
  let resto = composto;
  for (;;) {
    const antes = resto;
    resto = resto.replace(/:{1,2}[a-z-]+\((?:[^()]|\([^()]*\))*\)/gi, "").replace(/:{1,2}[a-z-]+/gi, "");
    if (resto === antes) break;
  }
  resto = resto.replace(/\*/g, "").trim();
  // Só uma tag (`svg`, `span`, `textarea`) também não basta: o Chrome invalida toda tag igual da subárvore da âncora — no
  // mesmo trace, os milhares de <span> do código colorido e os <svg> dos ícones da conversa a cada nó novo.
  return resto === "" || /^[a-z][a-z0-9-]*$/i.test(resto);
}

describe("CSS: :has() sem sujeito universal (ADR-189)", () => {
  it("nenhuma regra com :has() termina num sujeito que casa com qualquer elemento", () => {
    const ruins = arquivosCss(RAIZ).flatMap((arq) =>
      seletoresDoCss(readFileSync(arq, "utf8"))
        .filter((s) => s.includes(":has("))
        // `label:has(input:checked)`: com o único `:has()` no próprio sujeito, a âncora é o sujeito e a invalidação fica nele.
        .filter((s) => s.slice(0, s.length - sujeito(s).length).includes(":has("))
        .filter((s) => sujeitoUniversal(sujeito(s)))
        .map((s) => `${arq.slice(RAIZ.length)}: ${s}`),
    );
    expect(ruins).toEqual([]);
  });

  it("o varredor acha o caso ruim e deixa passar o bom", () => {
    expect(sujeitoUniversal(sujeito(".a:has(> .b) > :not(.c)"))).toBe(true);
    expect(sujeitoUniversal(sujeito("html:has(.x) :is(.app, .app *, .y)"))).toBe(true);
    expect(sujeitoUniversal(sujeito(".a:has(.b) > .c > *"))).toBe(true);
    expect(sujeitoUniversal(sujeito(".a:has(.b) > .c::before"))).toBe(false);
    expect(sujeitoUniversal(sujeito(".a:is(:focus-within, :has(.b)) .c::placeholder"))).toBe(true);
    expect(sujeitoUniversal(sujeito(".a:has(.b) .c:not(:disabled)"))).toBe(false);
    expect(sujeitoUniversal(sujeito(".a:has(.b)"))).toBe(false);
    expect(sujeitoUniversal(sujeito(".a:has(.b) .c svg"))).toBe(true);
    expect(sujeitoUniversal(sujeito(".a:has(.b) svg.ic"))).toBe(false);
    expect(seletoresDoCss("@media (x) { .a, .b:is(.c, .d) { color: red } } .e { x: y }")).toEqual([".a", ".b:is(.c, .d)", ".e"]);
  });
});
