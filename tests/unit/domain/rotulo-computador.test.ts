import { describe, expect, it } from "vitest";
import { FERRAMENTAS_COMPUTADOR } from "../../../src/contracts/ferramentas-computador.ts";
import { dominioDaUrl, rotuloDoComputador } from "../../../src/domain/computador.ts";
import { resumoDaFerramenta } from "../../../src/domain/resumo-do-passo.ts";
import { frameDaFerramenta, frameVivoDoEvento } from "../../../src/domain/rotulo-ferramenta.ts";

/** D · Computador do bot (item 1): o rótulo da linha de atividade enquanto o bot usa o computador. */

/** O rótulo como a linha viva o mostra: o executor monta o resumo do argumento e o servidor, o frame. */
const emUso = (ferramenta: string, input: Record<string, unknown>) => frameDaFerramenta(`mcp__nod__${ferramenta}`, "id-1", resumoDaFerramenta(`mcp__nod__${ferramenta}`, input)).emUso.texto;

describe("rótulos das ferramentas do computador", () => {
  it("navegar: 'Abrindo {domínio}' sem www., sem caminho, busca nem credencial", () => {
    expect(emUso("computador_navegar", { url: "https://www.nfse.prefeitura.gov.br/guias?x=1" })).toBe("Abrindo nfse.prefeitura.gov.br");
    expect(emUso("computador_navegar", { url: "https://pt.wikipedia.org/wiki/Brasil" })).toBe("Abrindo pt.wikipedia.org");
    expect(emUso("computador_navegar", { url: "http://usuario:senha@WWW.Exemplo.com:8080/a" })).toBe("Abrindo exemplo.com");
    expect(emUso("computador_navegar", { url: "nada disso" })).toBe("Abrindo uma página");
    expect(rotuloDoComputador("computador_navegar")).toBe("Abrindo uma página");
  });

  it("observar, terminal e abas", () => {
    expect(emUso("computador_observar", {})).toBe("Olhando a tela");
    expect(emUso("computador_observar", { forcar: true })).toBe("Olhando a tela");
    expect(emUso("computador_terminal", { comando: "ls -la" })).toBe("Rodando no terminal");
    expect(emUso("computador_abas", { aba: 2 })).toBe("Trocando de aba");
  });

  it("interagir: clique é 'Clicando na tela'; texto e tecla são 'Digitando na tela'", () => {
    expect(emUso("computador_interagir", { tipo: "clicar", quadro: "q", x: 10, y: 20 })).toBe("Clicando na tela");
    expect(emUso("computador_interagir", { tipo: "digitar", quadro: "q", texto: "minha senha secreta" })).toBe("Digitando na tela");
    expect(emUso("computador_interagir", { tipo: "tecla", quadro: "q", tecla: "Enter" })).toBe("Digitando na tela");
    expect(emUso("computador_interagir", { tipo: "rolar", quadro: "q", delta: 300 })).toBe("Rolando a tela");
    expect(emUso("computador_interagir", { tipo: "outro", quadro: "q" })).toBe("Mexendo na tela");
    expect(rotuloDoComputador("computador_interagir", "constructor")).toBe("Mexendo na tela");
  });

  it("o resumo do interagir é só o tipo: nunca o texto digitado nem a tecla", () => {
    expect(resumoDaFerramenta("mcp__nod__computador_interagir", { tipo: "digitar", quadro: "q", texto: "minha senha secreta" })).toBe("digitar");
    expect(resumoDaFerramenta("mcp__nod__computador_interagir", { tipo: "digitar do jeito que eu quiser", quadro: "q" })).toBeUndefined();
    const f = frameVivoDoEvento({ tipo: "tool_use", id: "t1", nome: "mcp__nod__computador_interagir", input: { tipo: "digitar", quadro: "q", texto: "minha senha secreta" } } as never);
    expect(JSON.stringify(f)).not.toContain("senha");
  });

  it("todas em português, nunca o nome cru nem o genérico 'Usando o computador'", () => {
    for (const nome of Object.keys(FERRAMENTAS_COMPUTADOR)) {
      const r = rotuloDoComputador(nome);
      expect(r, nome).not.toBe("Usando o computador");
      expect(r, nome).not.toMatch(/computador_|_|\b(?:open|click|type|tab|screen|terminal run)\b/i);
    }
  });

  it("dominioDaUrl aceita a URL curta do resumo e recusa o que não é domínio", () => {
    expect(dominioDaUrl("www.exemplo.com.br/caminho")).toBe("exemplo.com.br");
    expect(dominioDaUrl("https://localhost:3000")).toBe("localhost");
    expect(dominioDaUrl("")).toBeNull();
    expect(dominioDaUrl("<script>")).toBeNull();
  });
});
