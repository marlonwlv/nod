import { describe, expect, it } from "vitest";
import { htmlMenuDoMais, linhasDoBot, menuDoMaisAbre, rotuloDoMais, rotuloDoMenuDoMais, type OpcoesDoMenuDoMais } from "../../../web/telas/folha-mais.ts";

/**
 * XUM-8 (pedido do Marlon, 2026-11-26): o "Capturar" sai da barra do campo e vai para dentro do +, que passa a abrir um
 * menu com duas linhas, nesta ordem: Anexar (o que o + fazia) e Capturar (o que o botão fazia). Cada linha com ícone e
 * rótulo; o Capturar só existe onde a ponte do Mac sabe capturar.
 */
const base: OpcoesDoMenuDoMais = { anexar: true, capturar: true, novaTarefa: null, ensinar: null };
const rotulos = (html: string) => [...html.matchAll(/<button[^>]*data-mais-pc="([^"]+)"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?(?:<span[^>]*>)?(?:<span>)?([^<]+)/g)].map((m) => [m[1], m[2]]);

describe("menu do + no computador (XUM-8)", () => {
  it("com o Mac que captura, o menu tem Anexar e depois Capturar, cada um com ícone e papel de item de menu", () => {
    const html = htmlMenuDoMais(base);
    expect(rotulos(html)).toEqual([["anexar", "Anexar"], ["capturar", "Capturar"]]);
    expect(html).toMatch(/^<div role="menu" class="menu-do-mais" aria-label="Anexar e capturar">/);
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html.match(/<svg class="mm-ic"[^>]*aria-hidden="true"/g)).toHaveLength(2);
    // A dica do antigo botão continua no Capturar (o Espaço troca para janela na captura do macOS).
    expect(html).toContain('data-mais-pc="capturar" title="Capturar janela ou região (Espaço troca para janela)"');
  });

  it("sem a captura (web, Windows antigo, celular) ou sem anexo, o Capturar some", () => {
    expect(rotulos(htmlMenuDoMais({ ...base, capturar: false }))).toEqual([["anexar", "Anexar"]]);
    // A captura cai no anexo do campo: campo sem anexo não tem para onde mandar a captura.
    expect(htmlMenuDoMais({ ...base, anexar: false })).not.toContain("capturar");
  });

  it("o + abre o menu com Anexar e Capturar; só com o anexo, segue abrindo o seletor de arquivo direto", () => {
    expect(menuDoMaisAbre(base)).toBe(true);
    expect(menuDoMaisAbre({ ...base, capturar: false })).toBe(false);
    expect(menuDoMaisAbre({ ...base, anexar: false })).toBe(false);
    expect(menuDoMaisAbre({ ...base, capturar: false, ensinar: { agenteId: "a1", nome: "Ada" } })).toBe(true);
  });

  it("com o navegador do bot, o Capturar entra logo depois do Anexar, antes de Nova tarefa e Ensinar", () => {
    const html = htmlMenuDoMais({ ...base, novaTarefa: { texto: "⌘N", aria: "Meta+N" }, ensinar: { agenteId: "a1", nome: "Ada" } });
    expect(rotulos(html).map(([q]) => q)).toEqual(["anexar", "capturar", "nova-tarefa", "ensinar"]);
    expect(rotuloDoMenuDoMais({ ...base, novaTarefa: { texto: "⌘N", aria: "Meta+N" }, ensinar: { agenteId: "a1", nome: "Ada" } })).toBe("Anexar, capturar, tarefa e ensinar");
  });

  it("o nome do + para leitor de tela diz o que o menu tem e mantém o aviso do modo total", () => {
    const l = linhasDoBot({ temArquivo: true, dona: true, modo: "total", ia: null });
    expect(rotuloDoMais({ ...l, modo: null, ia: null }, false, base)).toBe("Anexar e capturar");
    expect(rotuloDoMais({ ...l, modo: null, ia: null }, true, base)).toBe("Anexar e capturar · Ignorar todas as aprovações ligado");
    // Sem o menu (só o anexo) e no celular (sem `pc`), o nome de antes.
    expect(rotuloDoMais({ ...l, modo: null, ia: null }, false, { ...base, capturar: false })).toBe("Anexar");
    expect(rotuloDoMais(l)).toBe("Anexar, modo e IA · Ignorar todas as aprovações ligado");
  });
});
