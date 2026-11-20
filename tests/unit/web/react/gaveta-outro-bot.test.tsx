import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estadoInicial, type Estado } from "../../../../web/estado/reducer.ts";
import { montarRegiaoPorHtml, type RegiaoPorHtml } from "../../../../web/react/html/regiao-por-html.tsx";
import { desmontarRegiao, regioesMontadas } from "../../../../web/react/regioes.tsx";
import { renderDetalhes } from "../../../../web/telas/detalhes.ts";

/**
 * O cabeçalho do painel do bot mostrava o nome de outro bot ("Vera") com a conversa da Ada aberta (Paper J2, visto no app
 * em 2026-11-20). Causa: com a gaveta no React (ADR-189), o `<input id="gvn-nome" value="…">` vira `defaultValue` e o
 * mesmo nó era reaproveitado entre bots (a chave era o id, igual nos dois): o React troca o valor inicial, mas o campo já
 * tem valor próprio e ficava com o do bot anterior. Conserto: a identidade leva a chave do bot (`data-chave`).
 */
const BOTS = [
  { id: "vera", nome: "Vera", titulo: "Revisora de PRs", conversaId: "c-vera", cor: "c-purple", forma: "shape-circle", ownerId: "p", confirmado: true, descricao: "" },
  { id: "ada", nome: "Ada", titulo: "PM", conversaId: "c-ada", cor: "c-red", forma: "shape-circle", ownerId: "p", confirmado: true, descricao: "" },
];
const naConversa = (b: (typeof BOTS)[number]): Estado => ({
  ...estadoInicial,
  sessao: { pessoaId: "p", tenantId: "t" } as never,
  tela: { tipo: "conversa", conversaId: b.conversaId, agenteId: b.id },
  frota: { agentes: BOTS } as never,
});

describe("a gaveta troca de bot (D, J2)", () => {
  let r: RegiaoPorHtml;
  beforeEach(() => {
    document.body.innerHTML = `<aside id="detalhes"></aside>`;
    act(() => { r = montarRegiaoPorHtml("detalhes"); });
  });
  afterEach(() => {
    for (const id of regioesMontadas()) act(() => desmontarRegiao(id));
  });

  it("o nome e o subtítulo são os do bot à vista depois de vir de outro bot", () => {
    act(() => r.desenhar(renderDetalhes(naConversa(BOTS[0]!))));
    expect(document.querySelector<HTMLInputElement>("#gvn-nome")!.value).toBe("Vera");
    act(() => r.desenhar(renderDetalhes(naConversa(BOTS[1]!))));
    const nome = document.querySelector<HTMLInputElement>("#gvn-nome")!;
    expect(nome.dataset.id).toBe("ada");
    expect(nome.value).toBe("Ada");
    expect(document.querySelector<HTMLInputElement>("#gvn-sub")!.value).toBe("PM");
  });

  it("no mesmo bot o campo é o mesmo nó (o que a pessoa digita fica)", () => {
    act(() => r.desenhar(renderDetalhes(naConversa(BOTS[1]!))));
    const antes = document.querySelector<HTMLInputElement>("#gvn-nome")!;
    antes.value = "Ada Lovelace";
    act(() => r.desenhar(renderDetalhes(naConversa(BOTS[1]!))));
    expect(document.querySelector("#gvn-nome")).toBe(antes);
    expect(antes.value).toBe("Ada Lovelace");
  });
});
