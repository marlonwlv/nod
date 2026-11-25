import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PainelPessoaDto, PainelUsoDto } from "../../../../../src/contracts/backoffice.ts";
import { NaoEncontrado, SemSessao, type ApiBackoffice } from "../../../../../web/react/backoffice/api.ts";
import { AppBackoffice, type Ambiente } from "../../../../../web/react/backoffice/app.tsx";
import { caminhoDoLogin, lerJanela, lerRota } from "../../../../../web/react/backoffice/rotas.ts";

/** ADR-194: o app do backoffice interno — shell, seções por caminho, janela 7/30/90 e os estados de sessão e 404. */
const T = "00000000-0000-4000-8000-000000000001";
const P = "00000000-0000-4000-8000-0000000000aa";
const pessoa = { tenantId: T, pessoaId: P, nome: "Pessoa A", iniciais: "PA" };
const resumo = { ...pessoa, cadastroEm: "2026-11-01T10:00:00Z", ultimoUsoEm: "2026-11-23T10:00:00Z", mensagens: 12, turnos: 8, tarefas: 2, rotinasAtivas: 1, bots: 1, apps: 1, problemas: 3, travadas: 0, macsSemContato: 0 };

const PAINEL: PainelUsoDto = {
  geradoEm: "2026-11-23T12:00:00Z",
  dias: ["2026-11-21", "2026-11-22", "2026-11-23"],
  crescimento: { totalPessoas: 4, cadastrosPorDia: [1, 0, 2], ativosPorDia: [2, 1, 3], ativosSemana: 3, ativosMes: 4 },
  ativacao: {
    funil: [
      { passo: "cadastro", rotulo: "Cadastro", pessoas: 3 },
      { passo: "onboarding", rotulo: "Concluiu o onboarding", pessoas: 2 },
      { passo: "primeiro_bot", rotulo: "Criou um bot", pessoas: 2 },
      { passo: "primeiro_app", rotulo: "Conectou um app", pessoas: 1 },
      { passo: "primeira_tarefa", rotulo: "Concluiu uma tarefa", pessoas: 1 },
    ],
    tempos: [{ passo: "primeiro_bot", rotulo: "Primeiro bot", pessoas: 2, medianaHoras: 0.5, p90Horas: 3 }],
  },
  engajamento: { mensagensPorPessoa: 6, turnosPorPessoa: 4, tarefasPorPessoa: 1, rotinasAtivasPorPessoa: 0.5, tiposDeBot: [{ nome: "auto", total: 3 }], conectores: [{ nome: "github", total: 2 }], retencao: { coorte: 2, voltaram: 1 } },
  saude: { travadas: 1, macsSemContato: 0, pessoasComProblema: 1 },
  problemas: [
    {
      chave: "ferramenta_negada:capacidade_desligada",
      fonte: "ferramenta_negada",
      motivo: "capacidade_desligada",
      rotulo: "Ferramenta negada: capacidade desligada",
      ocorrencias: 3,
      pessoasAfetadas: 1,
      tendencia: [1, 0, 2],
      casos: [{ fonte: "ferramenta_negada", motivo: "capacidade_desligada", em: "2026-11-23T09:00:00Z", conversaId: "11111111-2222-4333-8444-555555555555", turnoId: null, tarefaId: null, alvo: "Bash", pessoa }],
    },
  ],
  pessoas: [resumo],
};

const TELA: PainelPessoaDto = {
  pessoa: resumo,
  onboarding: { etapa: null, concluidoEm: "2026-11-01T11:00:00Z" },
  diasAtivos: ["2026-11-22", "2026-11-23"],
  problemas: [{ chave: "ferramenta_negada:capacidade_desligada", rotulo: "Ferramenta negada: capacidade desligada", ocorrencias: 3 }],
  linhaDoTempo: [
    { tipo: "problema", em: "2026-11-23T09:00:00Z", rotulo: "Ferramenta negada: capacidade desligada (Bash)", conversaId: "11111111-2222-4333-8444-555555555555", turnoId: null, tarefaId: null, problema: { chave: "ferramenta_negada:capacidade_desligada", fonte: "ferramenta_negada", motivo: "capacidade_desligada" } },
    { tipo: "cadastro", em: "2026-11-01T10:00:00Z", rotulo: "Cadastro", conversaId: null, turnoId: null, tarefaId: null, problema: null },
  ],
};

const api = (over: Partial<ApiBackoffice> = {}): ApiBackoffice => ({
  eu: vi.fn(async () => ({ papel: "dono" as const, nome: "Pessoa A", iniciais: "PA" })),
  uso: vi.fn(async () => PAINEL),
  problemas: vi.fn(async () => ({ geradoEm: PAINEL.geradoEm, dias: PAINEL.dias, problemas: PAINEL.problemas })),
  pessoas: vi.fn(async () => ({ geradoEm: PAINEL.geradoEm, dias: PAINEL.dias, pessoas: PAINEL.pessoas })),
  pessoa: vi.fn(async () => TELA),
  ...over,
});

/** Um navegador de mentira: o caminho e a busca andam com `empurrar`; `ir` só registra. */
function ambiente(caminho: string, busca = ""): Ambiente & { idas: string[]; empurrados: string[] } {
  let c = caminho;
  let b = busca;
  const idas: string[] = [];
  const empurrados: string[] = [];
  return {
    idas,
    empurrados,
    caminho: () => c,
    busca: () => b,
    ir: (url) => void idas.push(url),
    empurrar: (url) => {
      empurrados.push(url);
      const [cc = "", bb] = url.split("?");
      c = cc;
      b = bb ? `?${bb}` : "";
    },
    sair: vi.fn(async () => undefined),
  };
}

describe("backoffice interno (ADR-194)", () => {
  it("lê a rota pelo caminho e a janela pela busca", () => {
    expect(lerRota("/backoffice")).toEqual({ secao: "uso", pessoa: null });
    expect(lerRota("/backoffice/uso")).toEqual({ secao: "uso", pessoa: null });
    expect(lerRota("/backoffice/problemas/")).toEqual({ secao: "problemas", pessoa: null });
    expect(lerRota(`/backoffice/pessoas/${T}/${P}`)).toEqual({ secao: "pessoas", pessoa: { tenantId: T, pessoaId: P } });
    expect(lerRota("/backoffice/nada")).toEqual({ secao: null, pessoa: null });
    expect(lerRota("/backoffice/uso/x")).toEqual({ secao: null, pessoa: null });
    expect(lerJanela("?dias=7")).toBe(7);
    expect(lerJanela("?dias=8")).toBe(30);
    expect(caminhoDoLogin("/backoffice/problemas?dias=7")).toBe(`/?volta=${encodeURIComponent("/backoffice/problemas?dias=7")}`);
  });

  it("Uso (padrão): menu lateral com as seções, crescimento, funil e saúde", async () => {
    const a = api();
    render(<AppBackoffice api={a} ambiente={ambiente("/backoffice/uso")} />);
    expect(await screen.findByText("Crescimento")).toBeTruthy();
    expect(a.uso).toHaveBeenCalledWith(30);
    const nav = screen.getByRole("navigation", { name: "Seções do backoffice" });
    expect(Array.from(nav.querySelectorAll("a")).map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Uso", "/backoffice/uso"],
      ["Problemas", "/backoffice/problemas"],
      ["Pessoas", "/backoffice/pessoas"],
    ]);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("Uso");
    expect(screen.getAllByText("−1 desistiram aqui")).toHaveLength(2);
    expect(screen.getByText("Tarefas travadas")).toBeTruthy();
  });

  it("a janela é um ToggleGroup: trocar pede a seção de novo e grava ?dias= no caminho", async () => {
    const a = api();
    const amb = ambiente("/backoffice/uso");
    render(<AppBackoffice api={a} ambiente={amb} />);
    await screen.findByText("Crescimento");
    const grupo = screen.getByRole("group", { name: "Janela de dias" });
    expect(grupo).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "7 dias" })));
    expect(a.uso).toHaveBeenLastCalledWith(7);
    expect(screen.getByRole("button", { name: "7 dias" }).getAttribute("aria-pressed")).toBe("true");
    expect(amb.empurrados.at(-1)).toBe("/backoffice/uso?dias=7");
    // Clicar no que já está marcado não desmarca nem pede de novo.
    const chamadas = (a.uso as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "7 dias" })));
    expect((a.uso as ReturnType<typeof vi.fn>).mock.calls.length).toBe(chamadas);
  });

  it("navegar pelo menu troca a seção sem recarregar e mantém a janela", async () => {
    const a = api();
    const amb = ambiente("/backoffice/uso", "?dias=7");
    render(<AppBackoffice api={a} ambiente={amb} />);
    await screen.findByText("Crescimento");
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Problemas" })));
    expect(await screen.findByText("Problemas durante o uso")).toBeTruthy();
    expect(a.problemas).toHaveBeenCalledWith(7);
    expect(amb.empurrados.at(-1)).toBe("/backoffice/problemas?dias=7");
    expect(amb.idas).toEqual([]);
    expect(screen.getByText("Ferramenta negada: capacidade desligada")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("conv 11111111")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Pessoa A" });
    expect(link.getAttribute("href")).toBe(`/backoffice/pessoas/${T}/${P}`);
    await act(async () => fireEvent.click(link));
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
    expect(a.pessoa).toHaveBeenCalledWith(T, P, 7);
  });

  it("Pessoas lista cada pessoa com o resumo; a tela da pessoa tem a linha do tempo", async () => {
    const a = api();
    const { unmount } = render(<AppBackoffice api={a} ambiente={ambiente("/backoffice/pessoas")} />);
    expect(await screen.findByRole("link", { name: /Pessoa A/ })).toBeTruthy();
    expect(a.pessoas).toHaveBeenCalledWith(30);
    unmount();
    render(<AppBackoffice api={a} ambiente={ambiente(`/backoffice/pessoas/${T}/${P}`)} />);
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
    expect(screen.getByText("Ferramenta negada: capacidade desligada (Bash)")).toBeTruthy();
    expect(screen.getByRole("link", { name: /← Pessoas/ }).getAttribute("href")).toBe("/backoffice/pessoas");
  });

  it("sem sessão (401) volta ao login com o caminho atual; 404 vira Página não encontrada; outro erro, aviso", async () => {
    const amb = ambiente("/backoffice/problemas", "?dias=7");
    const { unmount } = render(<AppBackoffice api={api({ eu: async () => Promise.reject(new SemSessao()) })} ambiente={amb} />);
    await vi.waitFor(() => expect(amb.idas).toEqual([`/?volta=${encodeURIComponent("/backoffice/problemas?dias=7")}`]));
    unmount();
    const fora = render(<AppBackoffice api={api({ eu: async () => Promise.reject(new NaoEncontrado()) })} ambiente={ambiente("/backoffice/uso")} />);
    expect(await screen.findByText("Página não encontrada")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    fora.unmount();
    const caiu = ambiente("/backoffice/uso");
    const meio = render(<AppBackoffice api={api({ uso: async () => Promise.reject(new SemSessao()) })} ambiente={caiu} />);
    await vi.waitFor(() => expect(caiu.idas).toEqual([`/?volta=${encodeURIComponent("/backoffice/uso")}`]));
    meio.unmount();
    render(<AppBackoffice api={api({ uso: async () => Promise.reject(new Error("HTTP 500")) })} ambiente={ambiente("/backoffice/uso")} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("o menu da conta (Base UI Menu) mostra o papel e sai", async () => {
    const amb = ambiente("/backoffice/uso");
    render(<AppBackoffice api={api()} ambiente={amb} />);
    await screen.findByText("Crescimento");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Conta: Pessoa A" })));
    expect(await screen.findByText("Dono do backoffice")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Sair" })));
    await vi.waitFor(() => expect(amb.idas).toEqual(["/"]));
    expect(amb.sair).toHaveBeenCalled();
  });

  it("QA r220: ao navegar por um link do app, o foco vai ao título da tela nova (o link clicado some)", async () => {
    const a = api();
    render(<AppBackoffice api={a} ambiente={ambiente("/backoffice/pessoas")} />);
    const link = await screen.findByRole("link", { name: /Pessoa A/ });
    link.focus();
    await act(async () => fireEvent.click(link));
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
    const titulo = screen.getByRole("heading", { level: 1 });
    expect(document.activeElement).toBe(titulo);
    const voltar = screen.getByRole("link", { name: /← Pessoas/ });
    voltar.focus();
    await act(async () => fireEvent.click(voltar));
    await screen.findByRole("link", { name: /Pessoa A/ });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("QA r220: texto do backoffice não usa --ink-4 (2,5:1 no claro); só a marca decorativa da linha do tempo", () => {
    const css = readFileSync("web/backoffice.css", "utf8");
    expect(css).not.toMatch(/(^|[;{\s])color:\s*var\(--ink-4\)/m);
  });

  it("o CSS do backoffice usa só tokens, sem cor solta", () => {
    const css = readFileSync("web/backoffice.css", "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
