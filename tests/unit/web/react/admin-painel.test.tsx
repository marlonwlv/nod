import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PainelPessoaDto, PainelUsoDto } from "../../../../src/contracts/admin-uso.ts";
import { lerRota, NaoEncontrado, PainelAdmin, type ApiAdmin } from "../../../../web/react/admin/painel.tsx";

/** ADR-193: a página do painel admin de uso. Desenha o que o servidor manda; 404 vira "Página não encontrada". */
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

const api = (over: Partial<ApiAdmin> = {}): ApiAdmin => ({ painel: vi.fn(async () => PAINEL), pessoa: vi.fn(async () => TELA), ...over });

describe("painel admin de uso (ADR-193)", () => {
  it("lê a rota do hash", () => {
    expect(lerRota("")).toEqual({ tipo: "painel" });
    expect(lerRota(`#/pessoa/${T}/${P}`)).toEqual({ tipo: "pessoa", tenantId: T, pessoaId: P });
  });

  it("desenha crescimento, funil, saúde, ranking com casos e a tabela de pessoas", async () => {
    location.hash = "";
    const a = api();
    render(<PainelAdmin api={a} />);
    expect(await screen.findByText("Problemas durante o uso")).toBeTruthy();
    expect(a.painel).toHaveBeenCalledWith(30);
    expect(screen.getByText("Ferramenta negada: capacidade desligada")).toBeTruthy();
    expect(screen.getAllByText("−1 desistiram aqui")).toHaveLength(2);
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("conv 11111111")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /Pessoa A/ });
    expect(links.every((l) => l.getAttribute("href") === `#/pessoa/${T}/${P}`)).toBe(true);
    expect(screen.getByText("Tarefas travadas")).toBeTruthy();
  });

  it("trocar a janela pede o painel de novo com os dias", async () => {
    location.hash = "";
    const a = api();
    render(<PainelAdmin api={a} />);
    await screen.findByText("Problemas durante o uso");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "7 dias" })));
    expect(a.painel).toHaveBeenLastCalledWith(7);
    expect(screen.getByRole("button", { name: "7 dias" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a tela da pessoa mostra a linha do tempo com os problemas", async () => {
    location.hash = `#/pessoa/${T}/${P}`;
    const a = api();
    render(<PainelAdmin api={a} />);
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
    expect(a.pessoa).toHaveBeenCalledWith(T, P, 30);
    expect(screen.getByText("Ferramenta negada: capacidade desligada (Bash)")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Voltar ao painel/ })).toBeTruthy();
    location.hash = "";
  });

  it("404 do servidor vira Página não encontrada; outro erro, aviso para recarregar", async () => {
    location.hash = "";
    const { unmount } = render(<PainelAdmin api={api({ painel: async () => Promise.reject(new NaoEncontrado()) })} />);
    expect(await screen.findByText("Página não encontrada")).toBeTruthy();
    unmount();
    render(<PainelAdmin api={api({ painel: async () => Promise.reject(new Error("HTTP 500")) })} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("o CSS do painel usa só tokens, sem cor solta", () => {
    const css = readFileSync("web/admin.css", "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
