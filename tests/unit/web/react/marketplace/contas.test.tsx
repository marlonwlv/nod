import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desenharMarketplace, desmontarMarketplace } from "../../../../../web/react/marketplace/regiao.tsx";
import { criarApiSimulada } from "../../../../../web/react/marketplace/simulado.ts";
import { arrumarBots, LISTA_CHEIA } from "../../../../../web/react/marketplace/quem-pode-usar.tsx";
import { problemaDoRotulo, resumoDeQuemUsa, rotuloDoNome, sugestoesLivres } from "../../../../../web/react/marketplace/contas.ts";
import type { InicialDoMarketplace } from "../../../../../web/react/marketplace/tipos.ts";

/**
 * ADR-196 (Paper "Apps com mais de uma conta", M1–M8): a tela Contas e o "Quem pode usar" de uma conta, com o adaptador
 * simulado (latência 0). O que importa: o nome antes do login, a espera na linha, o menu do kit, renomear e remover com a
 * lista de quem perde, o limite de cinco e a lista de bots que aguenta um time grande.
 */
let regiao: HTMLElement;
const aoFechar = vi.fn();
let vez = 0;

function abrir(inicial: InicialDoMarketplace, opcoes: Parameters<typeof criarApiSimulada>[0] = {}) {
  const api = criarApiSimulada({ latenciaMs: 0, ...opcoes });
  act(() => desenharMarketplace({ vez: ++vez, api, inicial, aoFechar }));
  return api;
}
const contas = (adicionando = false): InicialDoMarketplace => ({ vista: { tipo: "contas", slug: "gmail", ...(adicionando ? { adicionando: true } : {}) } });

beforeEach(() => {
  regiao = document.createElement("div");
  regiao.id = "marketplace";
  document.body.append(regiao);
  aoFechar.mockReset();
});
afterEach(() => {
  act(() => desmontarMarketplace());
  regiao.remove();
});

describe("as contas de um app (ADR-196)", () => {
  it("M1: a conta de hoje numa linha, com o e-mail, quem usa, o ⋯ e o Adicionar com o contador", () => {
    abrir(contas(), { contasDoGmail: [] });
    expect(screen.getByRole("heading", { name: "Contas" })).toBeTruthy();
    const lista = screen.getByRole("list", { name: "Contas do Gmail" });
    expect(lista.textContent).toContain("voce@empresa.example");
    expect(lista.textContent).toContain("Clarice e mais 2 bots");
    expect(screen.getByRole("button", { name: /Adicionar outra conta/ }).textContent).toContain("1 de 5");
    expect(regiao.textContent).toContain("1 conta conectada");
  });

  it("M2→M3→M4: o nome antes do login, a espera na linha e, conectada, o 'Quem pode usar' da conta nova", async () => {
    abrir(contas(), { contasDoGmail: [] });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar outra conta/ }));
    const campo = screen.getByRole("textbox", { name: "Como chamar esta conta?" });
    const continuar = screen.getByRole("button", { name: /Continuar no Google/ });
    expect((continuar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "Pessoal" } });
    expect(regiao.textContent).toContain("Os bots vão ver Gmail (Pessoal)");
    fireEvent.click(continuar);
    expect(await screen.findByText(/Esperando você entrar no Google/)).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Quem pode usar o Gmail (Pessoal)?" })).toBeTruthy();
    expect(regiao.textContent).toContain("pessoal@exemplo.com");
    expect(regiao.textContent).toContain("Vale só para esta conta.");
    // O "Apps" da trilha volta às contas do app, não ao início.
    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Apps" }));
    expect(screen.getByRole("list", { name: "Contas do Gmail" }).textContent).toContain("Gmail (Pessoal)");
  });

  it("M2: nome repetido ou com parênteses não continua; a sugestão já usada some; Esc cancela", () => {
    abrir(contas(true), { contasDoGmail: ["pessoal"] });
    const campo = screen.getByRole("textbox", { name: "Como chamar esta conta?" });
    expect(screen.queryByRole("button", { name: "pessoal" })).toBeNull();
    fireEvent.change(campo, { target: { value: "Pessoal" } });
    expect(screen.getByRole("alert").textContent).toBe("Já tem uma conta com esse nome.");
    expect((screen.getByRole("button", { name: /Continuar no Google/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "a(b)" } });
    expect(screen.getByRole("alert").textContent).toContain("sem parênteses");
    fireEvent.click(screen.getByRole("button", { name: "trabalho" }));
    expect((campo as HTMLInputElement).value).toBe("trabalho");
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Como chamar esta conta?" })).toBeNull();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("M5: o menu da linha; Remover só na conta a mais; Esc fecha e devolve o foco ao ⋯", () => {
    abrir(contas(), { contasDoGmail: ["pessoal"] });
    const mais = screen.getByRole("button", { name: "Opções do Gmail (pessoal)" });
    fireEvent.click(mais);
    const menu = screen.getByRole("menu", { name: "Opções do Gmail (pessoal)" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Quem pode usar", "Renomear", "Desconectar", "Remover esta conta"]);
    expect(document.activeElement?.textContent).toBe("Quem pode usar");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Renomear");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(mais);
    expect(aoFechar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Opções do Gmail" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Remover esta conta" })).toBeNull();
  });

  it("M6: renomear troca só o que vai entre parênteses", async () => {
    abrir(contas(), { contasDoGmail: ["pessoal"] });
    fireEvent.click(screen.getByRole("button", { name: "Opções do Gmail (pessoal)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Renomear" }));
    const campo = screen.getByRole("textbox", { name: "Nome da conta" });
    expect((campo as HTMLInputElement).value).toBe("pessoal");
    expect(regiao.textContent).toContain("Muda só o nome. Acessos, regras e histórico continuam valendo.");
    fireEvent.change(campo, { target: { value: "Família" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Contas do Gmail" }).textContent).toContain("Gmail (Família)"));
  });

  it("M7: remover mostra quem perde o acesso; Cancelar volta; confirmar tira a linha", async () => {
    abrir(contas(), { contasDoGmail: ["pessoal"] });
    fireEvent.click(screen.getByRole("button", { name: "Opções do Gmail (pessoal)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remover esta conta" }));
    const alerta = screen.getByRole("alertdialog", { name: "Remover o Gmail (pessoal)?" });
    expect(alerta.textContent).toContain("2 bots perdem o acesso a maria@pessoal.example.");
    expect(within(alerta).getByRole("list", { name: "Quem perde o acesso" }).textContent).toContain("ClariceLer e alterar");
    expect(document.activeElement?.textContent).toBe("Cancelar");
    fireEvent.keyDown(alerta, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(aoFechar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Opções do Gmail (pessoal)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remover esta conta" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover a conta" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("list", { name: "Contas do Gmail" }).textContent).not.toContain("Gmail (pessoal)");
  });

  it("M8: com cinco contas, Adicionar some e a linha diz o limite", () => {
    abrir(contas(), { contasDoGmail: ["pessoal", "familia", "acme", "vendas"] });
    expect(screen.queryByRole("button", { name: /Adicionar outra conta/ })).toBeNull();
    expect(regiao.textContent).toContain("Até 5 contas do Gmail");
    expect(regiao.textContent).toContain("5 de 5");
    expect(regiao.textContent).toContain("5 contas conectadas");
  });

  it("M4: com dezenas de bots, busca, filtro e o grupo dos que seguem o padrão recolhido", () => {
    abrir({ vista: { tipo: "acessos", slug: "gmail", conectorId: "sim-gmail--pessoal", conectadoAgora: true, conta: "gmail--pessoal" } }, { contasDoGmail: ["pessoal"], botsAMais: 27 });
    expect(screen.getByRole("searchbox", { name: "Buscar bots" }).getAttribute("placeholder")).toBe("Buscar entre 32 bots");
    const grupo = screen.getByRole("group", { name: "Quem pode usar o Gmail (pessoal)" });
    expect(within(grupo).getAllByRole("checkbox", { name: /^Selecionar (?!todos)/ }).map((c) => c.getAttribute("aria-label"))).toEqual(["Selecionar Clarice", "Selecionar Frida"]);
    expect(grupo.textContent).toContain("30 bots seguem o padrão");
    fireEvent.click(within(grupo).getByRole("button", { name: /30 bots seguem o padrão/ }));
    expect(within(grupo).getAllByRole("checkbox", { name: /^Selecionar (?!todos)/ })).toHaveLength(32);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar bots" }), { target: { value: "fri" } });
    expect(within(grupo).getAllByRole("checkbox", { name: /^Selecionar (?!todos)/ }).map((c) => c.getAttribute("aria-label"))).toEqual(["Selecionar Frida"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar bots" }), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Mostrar" })).getByRole("button", { name: "Com acesso 2" }));
    expect(within(grupo).getAllByRole("checkbox", { name: /^Selecionar (?!todos)/ })).toHaveLength(2);
  });

  it("o app de chave e o GitHub não têm Contas: seguem direto ao 'Quem pode usar'", () => {
    abrir({ vista: { tipo: "inicio" } }, { firefliesConectado: true });
    fireEvent.click(screen.getByRole("button", { name: /conectados/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir Fireflies" }));
    expect(screen.getByRole("heading", { name: "Quem pode usar o Fireflies?" })).toBeTruthy();
  });
});

describe("as regras da tela de contas", () => {
  it("resume quem usa, sugere nomes livres e acha o rótulo do nome", () => {
    const bots = [{ id: "a", nome: "Clarice" }, { id: "b", nome: "Ada" }, { id: "c", nome: "Frida" }];
    expect(resumoDeQuemUsa(bots, {})).toBe("Nenhum bot ainda");
    expect(resumoDeQuemUsa(bots, { a: "escrita" })).toBe("Clarice");
    expect(resumoDeQuemUsa(bots, { a: "escrita", b: "leitura" })).toBe("Clarice e mais 1 bot");
    expect(resumoDeQuemUsa(bots, { a: "escrita", b: "leitura", c: "personalizado" })).toBe("Clarice e mais 2 bots");
    expect(sugestoesLivres(["pessoal"])).toEqual(["trabalho", "cliente"]);
    expect(rotuloDoNome("Gmail", "Gmail (Família)")).toBe("Família");
    expect(rotuloDoNome("Gmail", "Gmail")).toBe("");
    expect(problemaDoRotulo("", [])).toBeNull();
    expect(problemaDoRotulo("x".repeat(21), [])).toBe("Até 20 letras.");
  });

  it("a lista cheia: até oito bots fica como sempre", () => {
    const bots = Array.from({ length: LISTA_CHEIA }, (_, i) => ({ id: `b${i}`, nome: `B${i}`, titulo: "", forma: "shape-circle" as const, cor: "c-blue" as const }));
    const r = arrumarBots(bots, {}, () => true, "todos", "", true);
    expect(r.visiveis).toHaveLength(LISTA_CHEIA);
    expect(r.recolhidos).toHaveLength(0);
  });
});
