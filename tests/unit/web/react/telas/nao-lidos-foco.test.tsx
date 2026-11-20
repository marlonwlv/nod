import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversaNaoLida } from "../../../../../src/contracts/nao-lidos.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { focoAntesDeMarcarTudo, focoAntesDeSair } from "../../../../../web/lib/nao-lidos-foco.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaNaoLidos, type AcoesDeNaoLidos } from "../../../../../web/react/telas/nao-lidos.tsx";

/**
 * QA-156: na tela Não lidos (React, padrão desde o #214), marcar pelo ✓ com o teclado, com E na última linha ou pelo
 * "Marcar tudo como lido" deixava o foco no <body>. As ações aqui fazem o que o main faz (o ajudante antes de a linha
 * sair, a linha sai quando a lista volta do servidor).
 */
const AGORA = new Date(2026, 8, 29, 12, 0).getTime();
const AS_8 = new Date(2026, 8, 29, 8, 0).getTime();
const naoLida = (id: string): ConversaNaoLida =>
  ({ conversaId: id, tipo: "propria", agenteId: "a1", salaId: null, total: 1, primeiraId: "m1", desde: AS_8, ultimaEm: AS_8, mensagens: [], daRotina: false });
const base: Estado = {
  ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "a1", nome: "Dev 1", titulo: "Dev Sr", cor: "c-green", forma: "shape-cloud", ownerId: "p", conversaId: "c1" }] } as never,
};

function montar(ids: string[], comAjudante: boolean) {
  let e: Estado = { ...base, naoLidos: { conversas: ids.map(naoLida) } };
  const loja = criarLoja(() => e);
  const sair = (ids: string[]) => act(() => { e = { ...e, naoLidos: { conversas: e.naoLidos!.conversas.filter((c) => !ids.includes(c.conversaId)) } }; loja.avisar(); });
  const acoes: AcoesDeNaoLidos = {
    abrirConversa: () => {}, abrirSala: () => {},
    marcarLida: (c) => {
      const item = document.querySelector(`.nl-item[data-conversa="${c}"]`);
      if (comAjudante) focoAntesDeSair(item);
      item?.classList.add("nl-sai");
      sair([c]);
    },
    marcarTudo: () => { if (comAjudante) focoAntesDeMarcarTudo(); sair(ids); },
  };
  const r = render(<TelaNaoLidos loja={loja} acoes={acoes} />, { container: document.body.appendChild(document.createElement("div")) });
  const linha = (c: string) => r.container.querySelector<HTMLElement>(`.nl-item[data-conversa="${c}"]`);
  return { ...r, linha };
}

describe("QA-156: o foco ao marcar como lido", () => {
  it("sem o ajudante (como na main), o ✓ pelo teclado deixa o foco no <body>", () => {
    const t = montar(["c1", "c2", "c3"], false);
    const check = t.linha("c2")!.querySelector<HTMLButtonElement>(".nl-check")!;
    check.focus();
    check.click();
    expect(document.activeElement).toBe(document.body);
    t.unmount();
  });

  it("✓ na linha do meio: o foco vai ao abrir da próxima e fica no mesmo nó depois do redesenho", () => {
    const t = montar(["c1", "c2", "c3"], true);
    const check = t.linha("c2")!.querySelector<HTMLButtonElement>(".nl-check")!;
    check.focus();
    check.click();
    expect(t.linha("c2")).toBeNull();
    expect(document.activeElement).toBe(t.linha("c3")!.querySelector(".nl-abrir"));
    t.unmount();
  });

  it("✓ na última linha vai à anterior; na única, ao título, que fica no 'Tudo em dia'", () => {
    const t = montar(["c1", "c2"], true);
    let check = t.linha("c2")!.querySelector<HTMLButtonElement>(".nl-check")!;
    check.focus(); check.click();
    expect(document.activeElement).toBe(t.linha("c1")!.querySelector(".nl-abrir"));
    check = t.linha("c1")!.querySelector<HTMLButtonElement>(".nl-check")!;
    check.focus(); check.click();
    expect(t.container.querySelector(".nl-vazio")).toBeTruthy();
    expect(document.activeElement).toBe(t.container.querySelector(".tela-nao-lidos h1"));
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    t.unmount();
  });

  it("Marcar tudo como lido pelo teclado: o foco vai ao título; foco fora da tela não é mexido", () => {
    const t = montar(["c1", "c2"], true);
    const tudo = t.container.querySelector<HTMLButtonElement>(".nl-tudo")!;
    tudo.focus(); tudo.click();
    expect(document.activeElement).toBe(t.container.querySelector(".tela-nao-lidos h1"));
    t.unmount();
    const fora = document.body.appendChild(document.createElement("button"));
    const u = montar(["c1"], true);
    fora.focus();
    u.linha("c1")!.querySelector<HTMLButtonElement>(".nl-check")!.click();
    expect(document.activeElement).toBe(fora);
    u.unmount(); fora.remove();
  });
});
