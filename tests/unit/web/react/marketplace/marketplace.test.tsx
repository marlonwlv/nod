import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARCA_REGIAO } from "../../../../../web/react/regioes.tsx";
import { desenharMarketplace, desmontarMarketplace } from "../../../../../web/react/marketplace/regiao.tsx";
import { criarApiSimulada } from "../../../../../web/react/marketplace/simulado.ts";
import type { InicialDoMarketplace } from "../../../../../web/react/marketplace/tipos.ts";

/**
 * ADR-179: a região #marketplace no React — o modal inteiro com o adaptador simulado (latência 0). O que importa: o que o
 * Paper mostra em cada estado, o Esc que fecha pelo dono do estado, o valor da chave que só passa pelo campo e o lote que
 * pede confirmação para Ler e alterar.
 */
let regiao: HTMLElement;
const aoFechar = vi.fn();
let vez = 0;

function abrir(inicial: InicialDoMarketplace = {}, opcoes: Parameters<typeof criarApiSimulada>[0] = {}) {
  const api = criarApiSimulada({ latenciaMs: 0, ...opcoes });
  act(() => desenharMarketplace({ vez: ++vez, api, inicial, aoFechar }));
  return api;
}

beforeEach(() => {
  regiao = document.createElement("div");
  regiao.id = "marketplace";
  document.body.append(regiao);
  aoFechar.mockReset();
  localStorage.clear();
});
afterEach(() => {
  act(() => desmontarMarketplace());
  regiao.remove();
});

describe("o Marketplace em modal", () => {
  it("monta a região uma vez, abre um <dialog> modal e não usa data-act", () => {
    abrir();
    expect(regiao.hasAttribute(MARCA_REGIAO)).toBe(true);
    const d = regiao.querySelector("dialog");
    expect(d?.open).toBe(true);
    expect(regiao.querySelector("[data-act]")).toBeNull();
    act(() => desenharMarketplace(null));
    expect(regiao.querySelector("dialog")).toBeNull();
  });

  it("D1: a navegação, o topo com 4 conectados, a busca com o total, os chips e a faixa de atenção", () => {
    abrir();
    const nav = screen.getByRole("navigation", { name: "Marketplace" });
    expect(within(nav).getByRole("button", { name: "Apps" }).getAttribute("aria-current")).toBe("page");
    expect(nav.textContent).toContain("PluginsEm breve");
    expect(nav.textContent).toContain("BotsEm breve");
    expect(screen.getByRole("button", { name: /4 conectados/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("Buscar entre 1.445 apps")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Categorias" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Todos", "Reuniões", "Comunicação", "Vendas", "Produtividade", "Mais"]);
    const atencao = screen.getByRole("region", { name: "Precisa de atenção" });
    expect(atencao.textContent).toContain("A chave parou de funcionar · foi apagada ou trocada no Fireflies");
    expect(within(atencao).getByRole("button", { name: "Trocar a chave" })).toBeTruthy();
    const pipedrive = regiao.querySelector('[data-app="pipedrive"]');
    expect(pipedrive?.textContent).toContain("Chave de API · Vendas");
    expect(regiao.querySelector('[data-app="fathom"]')?.textContent).toContain("Resume reuniões");
  });

  it("T1: buscar 'reuniões' lista três apps em duas colunas, com a legenda dos dois jeitos de conectar", () => {
    abrir({ busca: "reuniões" });
    expect(screen.getByRole("heading", { name: "3 apps para “reuniões”" })).toBeTruthy();
    expect([...regiao.querySelectorAll(".rx-mk-grade [data-app]")].map((e) => e.getAttribute("data-app"))).toEqual(["fathom", "fireflies", "microsoft-teams"]);
    expect(regiao.textContent).toContain("Entrar com a conta abre a página do app para você autorizar.");
    expect(regiao.textContent).toContain("Chave de API pede um código que você gera no próprio app.");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.queryByText(/apps para/)).toBeNull();
  });

  it("o chip de categoria lista a categoria; 'Mais' abre o menu com o resto", () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Vendas" }));
    expect(screen.getByRole("heading", { name: "Vendas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mais" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Projetos" }));
    expect(screen.getByRole("heading", { name: "Projetos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Projetos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Esc (o 'cancel' do <dialog>) e o × fecham pelo dono do estado", () => {
    abrir();
    const d = regiao.querySelector("dialog")!;
    const ev = new Event("cancel", { cancelable: true });
    act(() => { d.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Fechar o Marketplace" })[0]!);
    expect(aoFechar).toHaveBeenCalledTimes(2);
  });

  it("'Avançado' chama a tela de sempre", () => {
    const aoAbrirAvancado = vi.fn();
    abrir({}, { aoAbrirAvancado });
    fireEvent.click(screen.getByRole("button", { name: "Avançado" }));
    expect(aoAbrirAvancado).toHaveBeenCalled();
  });
});

describe("conectar com a chave (T2–T5)", () => {
  it("T2: o caminho, a frase, os passos, o cadeado; Conectar apagado até colar a chave", async () => {
    abrir({ vista: { tipo: "chave", slug: "fireflies" } });
    await screen.findByLabelText("Chave de API");
    expect(screen.getByRole("heading", { name: "Conectar o Fireflies" })).toBeTruthy();
    expect(regiao.textContent).toContain("O Fireflies conecta com uma chave de API: um código que vale como senha");
    expect([...regiao.querySelectorAll(".rx-mk-passo")].map((p) => p.textContent)).toEqual(["1Entre no Fireflies e abra Settings › Developer settings", "2Em API key, clique em copiar", "3Volte aqui e cole no campo abaixo"]);
    expect(screen.getByRole("link", { name: "Abrir o Fireflies" }).getAttribute("href")).toBe("https://app.fireflies.ai");
    expect(regiao.textContent).toContain("A chave vai cifrada para o serviço de conexão do nod. Nenhum bot vê a chave, e ela nunca aparece no chat.");
    const campo = screen.getByLabelText("Chave de API") as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.getAttribute("autocomplete")).toBe("off");
    expect(campo.hasAttribute("data-1p-ignore")).toBe(true);
    const conectar = screen.getByRole("button", { name: "Conectar" }) as HTMLButtonElement;
    expect(conectar.disabled).toBe(true);
    fireEvent.input(campo, { target: { value: "ff_live_123" } });
    expect(conectar.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(campo.type).toBe("text");
    expect(campo.value).toBe("ff_live_123");
  });

  it("T3: o Freshdesk pede o endereço (com https:// e .freshdesk.com em volta) e a chave; os dois são obrigatórios", async () => {
    abrir({ vista: { tipo: "chave", slug: "freshdesk" } });
    const endereco = (await screen.findByLabelText("Endereço da conta")) as HTMLInputElement;
    expect(endereco.closest(".rx-mk-campo")?.textContent).toBe("https://.freshdesk.com");
    expect(regiao.textContent).toContain("É o começo do endereço que você abre no navegador.");
    const conectar = screen.getByRole("button", { name: "Conectar" }) as HTMLButtonElement;
    fireEvent.input(endereco, { target: { value: "acme" } });
    expect(conectar.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Chave de API"), { target: { value: "x" } });
    expect(conectar.disabled).toBe(false);
  });

  it("T4 e T5: testa (campos lidos, 'Testando a chave…'), a recusa pinta o campo e o aviso é neutro; o valor fica só no campo", async () => {
    const api = abrir({ vista: { tipo: "chave", slug: "fireflies" } });
    const espia = vi.spyOn(api, "conectarComChave");
    const campo = (await screen.findByLabelText("Chave de API")) as HTMLInputElement;
    fireEvent.input(campo, { target: { value: "chave-errada-que-nao-vaza" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    expect(screen.getByRole("button", { name: /Testando a chave…/ })).toBeTruthy();
    expect(campo.readOnly).toBe(true);
    expect(regiao.textContent).toContain("Perguntando ao Fireflies se a chave vale. Leva alguns segundos.");
    await screen.findByText("O Fireflies recusou essa chave.");
    expect(espia).toHaveBeenCalledWith("fireflies", { api_key: "chave-errada-que-nao-vaza" });
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(campo.closest(".rx-mk-campo")?.classList.contains("rx-mk-recusado")).toBe(true);
    expect(regiao.querySelector(".cp-erro-ic")?.textContent).toBe("!");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    // O valor mora só no <input>: nem no resto do DOM, nem na foto, nem no armazenamento do navegador.
    const semCampo = regiao.cloneNode(true) as HTMLElement;
    for (const i of semCampo.querySelectorAll("input")) i.remove();
    expect(semCampo.innerHTML).not.toContain("chave-errada-que-nao-vaza");
    expect(JSON.stringify(api.ler(), (_k, v: unknown) => (v instanceof Set ? [...v] : v))).not.toContain("chave-errada");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("a chave aceita leva ao 'Quem pode usar', com 'Conectado agora · a chave está guardada'", async () => {
    abrir({ vista: { tipo: "chave", slug: "pipedrive" } });
    fireEvent.input(await screen.findByLabelText("Chave de API"), { target: { value: "boa" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await screen.findByRole("heading", { name: "Quem pode usar o Pipedrive?" });
    expect(regiao.textContent).toContain("Conectado agora · a chave está guardada");
  });

  it("D1 → 'Trocar a chave' abre o formulário do app em atenção; '‹ Apps' volta", async () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Trocar a chave" }));
    await screen.findByLabelText("Chave de API");
    fireEvent.click(regiao.querySelector<HTMLElement>(".rx-mk-trilha-voltar")!);
    expect(screen.getByPlaceholderText("Buscar entre 1.445 apps")).toBeTruthy();
  });
});

describe("quem pode usar, em lote (T6 e T6b)", () => {
  const t6: InicialDoMarketplace = { vista: { tipo: "acessos", slug: "fireflies", conectorId: "sim-fireflies", conectadoAgora: true }, selecionados: ["clarice", "ada"] };

  it("T6: 2 de 5 selecionados, Aplicar aos 2, o nível de cada bot, quem segue o padrão e o padrão do app", () => {
    abrir(t6, { firefliesConectado: true });
    expect(screen.getByText("2 de 5 selecionados")).toBeTruthy();
    expect(screen.getByText("Aplicar aos 2:")).toBeTruthy();
    const todos = screen.getByRole("checkbox", { name: "Selecionar todos" }) as HTMLInputElement;
    expect(todos.indeterminate).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Selecionar Clarice" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Selecionar Frida" }) as HTMLInputElement).checked).toBe(false);
    const clarice = screen.getByRole("group", { name: "Acesso de Clarice" });
    expect(within(clarice).getByRole("button", { name: "Ler" }).getAttribute("aria-pressed")).toBe("true");
    expect(regiao.textContent).toContain("Acompanhamento do time · segue o padrão");
    expect(regiao.textContent).toContain("Vale também para quem segue o padrão no Fireflies.");
    expect(within(screen.getByRole("group", { name: "Bots novos começam com" })).getByRole("button", { name: "Nenhum" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Desconectar o Fireflies" })).toBeTruthy();
  });

  it("Ler e alterar para os 2 pede confirmação (T6b); Liberar aplica o lote confirmado e limpa a seleção", async () => {
    const api = abrir(t6, { firefliesConectado: true });
    const espia = vi.spyOn(api, "aplicarLote");
    fireEvent.click(within(screen.getByRole("group", { name: "Aplicar aos 2" })).getByRole("button", { name: "Ler e alterar" }));
    const confirma = screen.getByRole("alertdialog");
    expect(confirma.textContent).toContain("Liberar Ler e alterar no Fireflies para 2 bots?");
    expect(confirma.textContent).toContain("Clarice e Ada poderão pôr o robô numa reunião e enviar áudio sem perguntar. Apagar fica de fora.");
    expect(espia).not.toHaveBeenCalled();
    fireEvent.click(within(confirma).getByRole("button", { name: "Liberar" }));
    expect(espia).toHaveBeenCalledWith("sim-fireflies", "escrita", ["clarice", "ada"], true);
    await waitFor(() => expect(screen.getByText("Selecionar todos")).toBeTruthy());
    expect(within(screen.getByRole("group", { name: "Acesso de Ada" })).getByRole("button", { name: "Ler e alterar" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("o recibo do lote fica dentro do modal, com Desfazer que volta os níveis de antes", async () => {
    abrir(t6, { firefliesConectado: true });
    fireEvent.click(within(screen.getByRole("group", { name: "Aplicar aos 2" })).getByRole("button", { name: "Ler e alterar" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Liberar" }));
    const recibo = await screen.findByText("Clarice e Ada agora leem e alteram no Fireflies.");
    expect(regiao.contains(recibo)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await screen.findByText("Desfeito. Voltou como estava.");
    expect(within(screen.getByRole("group", { name: "Acesso de Clarice" })).getByRole("button", { name: "Ler" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("group", { name: "Acesso de Ada" })).getByRole("button", { name: "Nenhum" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();
  });

  it("'Desconectar o X' desliga o app (as escolhas ficam) e volta para Apps", async () => {
    const api = abrir(t6, { firefliesConectado: true });
    const espia = vi.spyOn(api, "desconectar");
    fireEvent.click(screen.getByRole("button", { name: "Desconectar o Fireflies" }));
    expect(espia).toHaveBeenCalledWith("sim-fireflies");
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Buscar apps" })).toBeTruthy());
    expect(api.ler().apps.find((a) => a.slug === "fireflies")).toMatchObject({ desligado: true });
  });

  it("Esc na confirmação só cancela a confirmação (o modal fica); Ler vai direto, sem perguntar", () => {
    const api = abrir({ ...t6, confirmarEscrita: true }, { firefliesConectado: true });
    const espia = vi.spyOn(api, "aplicarLote");
    fireEvent.keyDown(screen.getByRole("button", { name: "Liberar" }), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(aoFechar).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("group", { name: "Aplicar aos 2" })).getByRole("button", { name: "Ler" }));
    expect(espia).toHaveBeenCalledWith("sim-fireflies", "leitura", ["clarice", "ada"], false);
  });

  it("o padrão em Ler e alterar também pede confirmação", () => {
    abrir(t6, { firefliesConectado: true });
    fireEvent.click(within(screen.getByRole("group", { name: "Bots novos começam com" })).getByRole("button", { name: "Ler e alterar" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("para os bots novos e quem segue o padrão?");
  });

  it("'N conectados ›' lista os conectados com Abrir: o app de login abre nas Contas (ADR-196), e dali o 'Quem pode usar'", () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /4 conectados/ }));
    expect(screen.getByRole("heading", { name: "Conectados" })).toBeTruthy();
    expect([...regiao.querySelectorAll("[data-app]")].map((e) => e.getAttribute("data-app"))).toEqual(["github", "googledrive", "slack", "fireflies"]);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Slack" }));
    expect(screen.getByRole("heading", { name: "Contas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Opções do Slack" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Quem pode usar" }));
    expect(screen.getByRole("heading", { name: "Quem pode usar o Slack?" })).toBeTruthy();
    expect(regiao.textContent).toContain("Conectado · pela sua conta");
  });

  it("o login de um app de conta mostra a espera na linha e, conectado, vai sozinho ao 'Quem pode usar'", async () => {
    vi.useFakeTimers();
    try {
      const api = criarApiSimulada({ latenciaMs: 100 });
      act(() => desenharMarketplace({ vez: ++vez, api, inicial: {}, aoFechar }));
      fireEvent.click(screen.getByRole("button", { name: "Conectar Notion" }));
      expect(regiao.querySelector('[data-app="notion"]')?.textContent).toContain("Esperando você entrar no Notion…");
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(screen.getByRole("heading", { name: "Quem pode usar o Notion?" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
