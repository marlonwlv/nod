import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EstadoIa } from "../../../../../src/contracts/estado-ia.ts";
import type { IaNoMac } from "../../../../../src/contracts/onboarding.ts";
import { EsteComputador } from "../../../../../web/react/onboarding/este-computador.tsx";
import type { FonteIa, VistaComputador } from "../../../../../web/telas/este-computador.ts";
import { desenhar } from "./ajuda.tsx";

/** ADA-242 em React (ADR-179, fase 5): a tela "Este computador" (2a–2g). Os estados são testados em este-computador.test.ts. */
const mac = (estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): FonteIa => ({ mac: { ia: "claude-cli", estado, mensagem: "", em: 0, ...extra } });
const inv = (estado: IaNoMac["estado"]): FonteIa => ({ inventario: { id: "claude-cli", estado } });
const login = (p: Record<string, unknown>) => ({ fase: "aberto", ...p }) as unknown as EstadoIa["login"];
const base: Omit<VistaComputador, "fontes"> = { agora: 0, emFoco: null, ocupado: false, colarCodigo: true, nota: null };
const tela = (fontes: VistaComputador["fontes"], p: Partial<VistaComputador> = {}) => desenhar((a) => <EsteComputador v={{ ...base, fontes, ...p }} executar={a.executar} />);

describe("Este computador", () => {
  it("2c: Instalar e entrar nas duas IAs e Pular por agora; 2a: Continuar e a conta", () => {
    const c = tela({ "claude-cli": inv("ausente"), "codex-cli": { inventario: { id: "codex-cli", estado: "ausente" } } });
    expect(c.html).toContain('data-estado="2c"');
    expect(c.cliques()).toEqual([
      { acao: "computador-instalar", dados: { ia: "claude-cli" }, rotulo: "Instalar e entrar" },
      { acao: "computador-instalar", dados: { ia: "codex-cli" }, rotulo: "Instalar e entrar" },
      { acao: "computador-pular", dados: {}, rotulo: "Pular por agora" },
    ]);
    expect(c.html).toContain("Também funciona sozinho ou como reserva do Claude.");
    expect(c.html).not.toContain("Outras IAs");
    const a = tela({ "claude-cli": mac("pronta", { conta: { email: "ana@x.com" } as EstadoIa["conta"] }) });
    expect(a.html).toContain("O Claude já está aqui.");
    expect(a.html).toContain("Conectado como ana@x.com");
    expect(a.cliques().map((x) => x.acao)).toEqual(["computador-continuar"]);
  });

  it("2f: Conferir de novo, Abrir de novo e o campo do código só com a ponte do Mac; 2d: Cancelar no lugar de Pular", () => {
    const f = { "claude-cli": mac("entrando", { login: login({ verificarDeNovo: true }) }) };
    const comCampo = tela(f);
    expect(comCampo.cliques().map((x) => x.acao)).toEqual(expect.arrayContaining(["computador-abrir", "computador-conferir"]));
    const campo = comCampo.getByLabelText("Código do Claude");
    fireEvent.change(campo, { target: { value: "abc-123" } });
    fireEvent.submit(campo.closest("form")!);
    expect(comCampo.executar).toHaveBeenLastCalledWith("computador-codigo", { ia: "claude-cli", codigo: "abc-123" });
    comCampo.unmount();
    expect(tela(f, { colarCodigo: false }).queryByLabelText("Código do Claude")).toBeNull();
    const d = tela({ "claude-cli": mac("entrando", { login: login({}) }) });
    const acoes = d.cliques().map((x) => x.acao);
    expect(acoes).toContain("computador-cancelar");
    expect(acoes).not.toContain("computador-pular");
  });

  it("o CLI abaixo do piso: 'Atualizar e entrar', não só entrar", () => {
    const h = tela({ "claude-cli": mac("desatualizada") });
    expect(h.html).toContain("Atualizar e entrar");
    expect(h.cliques().map((x) => x.acao)).not.toContain("computador-entrar");
  });

  it("escapa a conta vinda do CLI (o React escreve texto, não HTML)", () => {
    const h = tela({ "claude-cli": mac("pronta", { conta: { email: "<img src=x>" } as EstadoIa["conta"] }) });
    expect(h.container.querySelector("img")).toBeNull();
    expect(h.html).toContain("&lt;img src=x&gt;");
  });

  it("ocupado: os botões ficam desligados e a nota aparece como alerta", () => {
    const h = tela({ "claude-cli": inv("ausente") }, { ocupado: true, nota: "Não deu para falar com o Claude agora. Tente de novo." });
    expect((h.getByRole("button", { name: "Instalar e entrar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.getByRole("alert").textContent).toContain("Não deu para falar com o Claude");
  });
});
