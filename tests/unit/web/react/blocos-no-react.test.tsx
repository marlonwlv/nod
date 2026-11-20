import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { regiaoPorBlocos } from "../../../../web/lib/regioes.ts";
import { montarBlocosNoReact, type BlocoDeHtml, type BlocosNoReact } from "../../../../web/react/html/regiao-por-html.tsx";

/**
 * ADR-189 (fase 6 da ADR-179): a conversa desenhada pelo React, bloco a bloco, no lugar do `regiaoPorBlocos`. Trava o
 * contrato que o main.ts usa: o mesmo DOM, os blocos iguais intactos, os novos devolvidos para animar e a fala viva
 * trocada no lugar (o morph da ADR-114: o mascote e a vaga do rótulo ficam no nó).
 */
const fala = (id: string, texto: string): BlocoDeHtml => ({ chave: `m:${id}`, html: `<article class="message bot" data-mensagem="${id}"><nod-mascote class="icon mascote" state="idle" shape="round"></nod-mascote><div class="bubble-wrap"><div class="bubble"><p>${texto}</p></div></div></article>` });
const viva = (rotulo: string, chave: string, estado = "orbit"): BlocoDeHtml => ({
  chave: "vivo:t1",
  html: `<article class="message bot fala-viva ao-vivo indicador" data-turno="t1" data-morfar aria-live="polite"><nod-mascote class="icon mascote sm" state="${estado}" shape="round" data-estado="trabalhando"></nod-mascote><div class="bubble-wrap"><span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado brilho" data-chave="${chave}">${rotulo}</span></span></div></article>`,
});
const pensar = (aberto: boolean): BlocoDeHtml => ({ chave: "m:p", html: `<div class="msg-linha"><details class="pensar" data-disclosure="pensar:t0"${aberto ? " open" : ""}><summary>Pensou por 3 s</summary><ol><li>Leu o quadro</li></ol></details></div>` });

describe("conversa desenhada pelo React, bloco a bloco (ADR-189)", () => {
  let r: BlocosNoReact;
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = `<div id="timeline"><div id="timeline-historico" class="timeline-parte"></div><div id="string" class="timeline-parte"></div></div>`;
    el = document.getElementById("timeline-historico")!;
    act(() => { r = montarBlocosNoReact(el, "timeline-historico"); });
  });
  afterEach(() => act(() => r.desmontar()));

  it("desenha o mesmo DOM que o regiaoPorBlocos", () => {
    const blocos = [fala("1", "Oi"), pensar(false), fala("2", "Tudo certo")];
    r.desenhar(blocos);
    regiaoPorBlocos("string", blocos);
    expect(el.innerHTML).toBe(document.getElementById("string")!.innerHTML);
  });

  it("os blocos iguais ficam no mesmo nó; o novo do fim volta para animar, o mais velho do alto não", () => {
    expect(r.desenhar([fala("1", "Oi"), fala("2", "Tudo certo")])).toEqual([]);
    const [b1, b2] = [...el.children];
    const mascote = el.querySelector('[data-mensagem="1"] nod-mascote');
    const chegaram = r.desenhar([fala("0", "Mais velha"), fala("1", "Oi"), fala("2", "Tudo certo"), fala("3", "Nova")]);
    expect(el.children[1]).toBe(b1);
    expect(el.children[2]).toBe(b2);
    expect(el.querySelector('[data-mensagem="1"] nod-mascote')).toBe(mascote);
    expect(chegaram).toEqual([el.children[3]]);
  });

  it("mudariam: só com chave, ordem ou HTML diferentes", () => {
    const blocos = [fala("1", "Oi")];
    r.desenhar(blocos);
    expect(r.mudariam([fala("1", "Oi")])).toBe(false);
    expect(r.mudariam([fala("1", "Olá")])).toBe(true);
    expect(r.mudariam([fala("1", "Oi"), fala("2", "x")])).toBe(true);
  });

  it("a fala viva troca o rótulo no lugar: o mascote e a vaga ficam, o rótulo de outra etapa é outro nó", () => {
    r.desenhar([viva("Lendo", "lendo")]);
    const mascote = el.querySelector("nod-mascote")!;
    const vaga = el.querySelector(".indicador-rotulo-lugar")!;
    const rotulo = el.querySelector(".indicador-rotulo")!;
    r.desenhar([viva("Escrevendo", "escrevendo", "running")]);
    expect(el.querySelector("nod-mascote")).toBe(mascote);
    expect(mascote.getAttribute("state")).toBe("running");
    expect(el.querySelector(".indicador-rotulo-lugar")).toBe(vaga);
    expect(el.querySelector(".indicador-rotulo")).not.toBe(rotulo);
    expect(el.querySelector(".indicador-rotulo")!.textContent).toBe("Escrevendo");
  });

  it("o texto que o relógio escreve no rótulo não é desfeito por um desenho com o mesmo HTML do bloco", () => {
    r.desenhar([viva("Lendo", "lendo"), fala("1", "Oi")]);
    el.querySelector(".indicador-rotulo")!.textContent = "Lendo o relatório";
    r.desenhar([viva("Lendo", "lendo"), fala("1", "Oi"), fala("2", "Nova")]);
    expect(el.querySelector(".indicador-rotulo")!.textContent).toBe("Lendo o relatório");
  });

  it("o <details> que a pessoa abriu continua aberto quando o bloco vizinho muda", () => {
    r.desenhar([pensar(false), fala("1", "Oi")]);
    const d = el.querySelector("details")!;
    d.open = true;
    r.desenhar([pensar(false), fala("1", "Oi, de novo")]);
    expect(el.querySelector("details")).toBe(d);
    expect(d.open).toBe(true);
  });

  it("a vaga que outra parte enche por fora (progresso, artefato) não é desfeita pelo React", () => {
    const comVaga: BlocoDeHtml = { chave: "m:v", html: `<article class="message bot" data-mensagem="v"><nod-mascote class="icon mascote"></nod-mascote><div class="progresso-lugar" data-frentes="f1"></div></article>` };
    r.desenhar([comVaga]);
    el.querySelector(".progresso-lugar")!.innerHTML = "<p>2 de 5 frentes</p>";
    r.desenhar([comVaga, fala("1", "Oi")]);
    expect(el.querySelector(".progresso-lugar")!.innerHTML).toBe("<p>2 de 5 frentes</p>");
  });

  it("em(): o nó regravado pela casca não é mais o desta parte", () => {
    r.desenhar([fala("1", "Oi")]);
    expect(r.em(el)).toBe(true);
    document.getElementById("timeline")!.innerHTML = `<div id="timeline-historico" class="timeline-parte"></div>`;
    expect(r.em(el)).toBe(false);
    expect(r.em(document.getElementById("timeline-historico"))).toBe(false);
  });
});
