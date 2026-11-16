import { describe, expect, it } from "vitest";
import { dimensoesShell, lancadorShellSeguro, renderizarHomeShell } from "../../../infra/computador/shell-visual-runtime.mjs";

describe("runtime do shell visual", () => {
  it("usa dimensões padrão e aceita os limites dos breakpoints", () => {
    expect(dimensoesShell({} as NodeJS.ProcessEnv)).toEqual({ largura: 1280, altura: 800 });
    expect(dimensoesShell({ NOD_SHELL_LARGURA: "390", NOD_SHELL_ALTURA: "570" } as NodeJS.ProcessEnv)).toEqual({ largura: 390, altura: 570 });
    expect(() => dimensoesShell({ NOD_SHELL_LARGURA: "389" } as NodeJS.ProcessEnv)).toThrow("shell_dimensoes_invalidas");
  });

  it("renderiza somente placeholders escapados e recusa conteúdo executável", () => {
    expect(renderizarHomeShell("<h1>{{NOME}}</h1><p>{{DISPLAY}}</p>", { nome: "<Ada>", papel: "PM", display: ":99", hora: "14:00", data: "segunda" })).toBe("<h1>&lt;Ada&gt;</h1><p>:99</p>");
    expect(() => renderizarHomeShell("<script>alert(1)</script>", { nome: "N", papel: "A", display: ":99", hora: "", data: "" })).toThrow("shell_home_insegura");
    expect(() => renderizarHomeShell('<img src="https://fora">', { nome: "N", papel: "A", display: ":99", hora: "", data: "" })).toThrow("shell_home_insegura");
  });

  it("gera launchers com comandos fixos, sem executar conteúdo do pacote", () => {
    expect(lancadorShellSeguro("files", "/opt/nod/apps/files.svg")).toContain("Exec=/usr/bin/pcmanfm /workspace");
    expect(() => lancadorShellSeguro("files", "relativo.svg")).toThrow("shell_app_invalido");
    expect(() => lancadorShellSeguro("outro" as "files", "/tmp/x.svg")).toThrow("shell_app_invalido");
  });
});
