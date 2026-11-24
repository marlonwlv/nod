import { describe, expect, it } from "vitest";
import { htmlDaLista, htmlDoComp, htmlMenuNome } from "../../../web/lib/canvas-html.ts";
import { htmlDialogoComputador, rotuloDoFechar } from "../../../web/lib/computador.ts";
import { aoColega } from "../../../web/lib/esperas-de-colega.ts";
import { textoRecusas } from "../../../web/lib/midia.ts";
import { textoPararTasks } from "../../../web/lib/trabalhos.ts";
import { passos } from "../../../web/telas/app-acesso.ts";

// Regression: QA-187 (r186) — o #276 e o #285 tiraram o artigo fixo antes do nome do bot (o gênero não se sabe: "do Ana",
// "ao Nina", "à Chico"), mas sobraram frases no canvas, no computador do bot, na espera por colega, nos anexos, no Parar das
// tarefas e nos passos do card de acesso. Com a regra do Gil (PR #276): "de X", "a X", "com X"; sem nome, o de sempre.
const ARTIGO_ANTES_DO_NOME = /\b(do|da|ao|à|pelo|pela|com o|com a) (Ana|Chico)\b/;

describe("nome do bot sem artigo fixo (QA-187)", () => {
  it("canvas: busca, título da lista, campo e balão", () => {
    const menu = htmlMenuNome({ lista: [], aberto: null, busca: "", nome: "Ana" });
    expect(menu).toContain('placeholder="Buscar canvas de Ana"');
    const comp = htmlDoComp({ chip: null, nome: "Chico", escrevendo: false, enviando: false });
    expect(comp).toContain('placeholder="Peça a Chico sobre esta tela…"');
    expect(comp).toContain('aria-label="Pedir a Chico"');
    for (const html of [menu, comp]) expect(html).not.toMatch(ARTIGO_ANTES_DO_NOME);
  });

  it("canvas: a lista diz Canvas de Ana", () => {
    const lista = htmlDaLista({ lista: [], filtro: "todos", busca: "", nome: "Ana", miniatura: () => null } as unknown as Parameters<typeof htmlDaLista>[0]);
    expect(lista).toContain("Canvas de Ana");
    expect(lista).not.toMatch(ARTIGO_ANTES_DO_NOME);
  });

  it("computador do bot: Fechar devolve a Ana", () => {
    expect(htmlDialogoComputador("Ana")).toContain("Fechar devolve a Ana");
    expect(htmlDialogoComputador("Ana")).not.toMatch(ARTIGO_ANTES_DO_NOME);
    expect(rotuloDoFechar("Ana", true, null, false)).toEqual({ rotulo: "Fechar e devolver a Ana (Esc)", dica: "Fechar devolve a Ana" });
  });

  it("espera por colega: a Chico; sem nome, ao colega", () => {
    expect(aoColega("Chico")).toBe("a Chico");
    expect(aoColega("  Ana ")).toBe("a Ana");
    expect(aoColega(" ")).toBe("ao colega");
  });

  it("anexos: fora da pasta de Ana; sem nome, do bot", () => {
    expect(textoRecusas([{ motivo: "fora_da_pasta", n: 1 }], "Ana")).toBe("1 arquivo não foi anexado: fica fora da pasta de Ana.");
    expect(textoRecusas([{ motivo: "fora_da_pasta", n: 1 }])).toBe("1 arquivo não foi anexado: fica fora da pasta do bot.");
  });

  it("Parar as tarefas: de Ana; sem nome, do bot", () => {
    const duas = [{ titulo: "A" }, { titulo: "B" }];
    expect(textoPararTasks(duas, "Ana")).toBe("Parar as 2 tarefas de Ana?");
    expect(textoPararTasks(duas)).toBe("Parar as 2 tarefas do bot?");
  });

  it("card de acesso: Permitir a Ana", () => {
    const html = passos("Slack", "Ana", 2);
    expect(html).toContain("Permitir a Ana");
    expect(html).not.toMatch(ARTIGO_ANTES_DO_NOME);
  });
});
