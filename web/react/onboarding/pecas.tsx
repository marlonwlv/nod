import { createElement, useLayoutEffect, useRef, type HTMLAttributes } from "react";
import type { Agente } from "../../../src/contracts/agente.ts";
import { htmlMascote, type EstadoMascote, type TamanhoMascote } from "../../lib/mascote.ts";

/**
 * ADR-179 (fase 5, região #onboarding): as peças pequenas que as telas do onboarding repetem. O visual é o de sempre: as
 * classes são as de web/onboarding.css (ob-*, ap-*, ec-*, cb-*), para a região trocar de motor sem trocar de cara.
 */

/** A roda de "girando" ao lado de um rótulo (decorativa: o rótulo é o que se lê). */
export function Gira({ grande = false }: { grande?: boolean }) {
  return <span className={`ob-gira${grande ? " grande" : ""}`} aria-hidden="true" />;
}

/** A roda que é o próprio estado (sem botão ao lado): tem nome para o leitor de tela. */
export function Girando({ rotulo, classe = "grande" }: { rotulo: string; classe?: string }) {
  return <span className={`ob-gira ${classe}`} role="img" aria-label={rotulo} />;
}

/**
 * Um ícone de traço que já existe como SVG em string (web/lib/icones.ts, os logos das IAs, os ícones do cartão). As
 * strings são constantes do próprio código, nunca texto da pessoa ou do servidor: por isso podem entrar como HTML.
 * Sem `className`, o invólucro é `display: contents` (.rx-svg): para o layout, o SVG fica onde sempre esteve.
 */
export function Svg({ html, className, ...resto }: { html: string; className?: string } & Omit<HTMLAttributes<HTMLSpanElement>, "dangerouslySetInnerHTML" | "children">) {
  return <span className={className ?? "rx-svg"} {...resto} dangerouslySetInnerHTML={{ __html: html }} />;
}

const cacheDeAtributos = new Map<string, [string, string][]>();

/** Os atributos do `<nod-mascote>` que web/lib/mascote.ts monta (a fonte única do personagem, da frente das animações). */
function atributosDoMascote(html: string): [string, string][] {
  const guardado = cacheDeAtributos.get(html);
  if (guardado) return guardado;
  const t = document.createElement("template");
  t.innerHTML = html;
  const el = t.content.firstElementChild;
  const lista: [string, string][] = el ? [...el.attributes].map((a) => [a.name, a.value]) : [];
  if (cacheDeAtributos.size > 200) cacheDeAtributos.clear();
  cacheDeAtributos.set(html, lista);
  return lista;
}

/**
 * O personagem (`<nod-mascote>`, o elemento da frente das animações). Os atributos vêm de `htmlMascote`, sem cópia da
 * regra: o elemento continua o mesmo e só troca de atributos quando o bot, o tamanho ou o estado mudam — sem recriar o
 * nó, o personagem não reinicia a animação a cada desenho.
 */
export function Mascote({ bot, tamanho = "", estado = "disponivel" }: { bot: Pick<Agente, "nome" | "cor" | "forma">; tamanho?: TamanhoMascote; estado?: EstadoMascote }) {
  const ref = useRef<HTMLElement | null>(null);
  const html = htmlMascote(bot, tamanho, estado);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const novos = atributosDoMascote(html);
    const nomes = new Set(novos.map(([n]) => n));
    for (const a of [...el.attributes]) if (!nomes.has(a.name)) el.removeAttribute(a.name);
    for (const [n, v] of novos) if (el.getAttribute(n) !== v) el.setAttribute(n, v);
  }, [html]);
  return createElement("nod-mascote", { ref });
}
