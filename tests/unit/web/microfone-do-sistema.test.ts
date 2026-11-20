import { afterEach, describe, expect, it, vi } from "vitest";
import { botaoAjustesDoMicrofone, falhaDoMicrofone, ondeLiberarMicrofone } from "../../../web/lib/microfone-do-sistema.ts";
import { avisoDoEstadoLocal } from "../../../web/telas/ligacao.ts";
import { textoDaFalha } from "../../../web/telas/ditado.ts";

/**
 * 17/11/2026 (primeiro teste do microfone no Windows): o aviso falava dos Ajustes do Sistema do Mac e não levava a lugar
 * nenhum. No Windows o texto aponta as Configurações e, no app, o aviso traz o botão que abre a tela certa.
 */
const UA_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) nod/1.0 Chrome/130.0 Electron/33.0 Safari/537.36";

afterEach(() => vi.unstubAllGlobals());

describe("onde liberar o microfone", () => {
  it("Windows: Configurações › Privacidade e segurança › Microfone, com os aplicativos da área de trabalho", () => {
    expect(ondeLiberarMicrofone(true)).toContain("Configurações › Privacidade e segurança › Microfone");
    expect(ondeLiberarMicrofone(true)).toContain("aplicativos da área de trabalho");
    expect(ondeLiberarMicrofone(true)).not.toContain("Ajustes do Sistema");
  });
  it("Mac: Ajustes do Sistema", () => {
    expect(ondeLiberarMicrofone(false)).toContain("Ajustes do Sistema › Privacidade › Microfone");
  });
  it("o botão diz o nome da tela de cada sistema", () => {
    expect(botaoAjustesDoMicrofone("pri sm", true)).toContain('data-act="microfone-ajustes"');
    expect(botaoAjustesDoMicrofone("pri sm", true)).toContain("Abrir Configurações");
    expect(botaoAjustesDoMicrofone("pri sm", false)).toContain("Abrir Ajustes");
  });
});

describe("falha do getUserMedia", () => {
  it("NotAllowedError e SecurityError: negado em qualquer lugar", () => {
    expect(falhaDoMicrofone("NotAllowedError", false)).toBe("microfone-negado");
    expect(falhaDoMicrofone("SecurityError", true)).toBe("microfone-negado");
  });
  it("NotReadableError: negado só no app do Windows (o bloqueio dos aplicativos da área de trabalho)", () => {
    expect(falhaDoMicrofone("NotReadableError", true)).toBe("microfone-negado");
    expect(falhaDoMicrofone("NotReadableError", false)).toBe("microfone-indisponivel");
    expect(falhaDoMicrofone("NotFoundError", true)).toBe("microfone-indisponivel");
  });
});

describe("os avisos no Windows", () => {
  it("ligação: o texto das Configurações e, com a ponte, o botão", () => {
    vi.stubGlobal("navigator", { userAgent: UA_WINDOWS });
    const aviso = avisoDoEstadoLocal("microfone-negado", true, true);
    expect(aviso?.texto).toContain("Configurações › Privacidade e segurança › Microfone");
    expect(aviso?.ajustes).toBe(true);
    expect(avisoDoEstadoLocal("microfone-negado", true, false)?.ajustes).toBeUndefined();
    expect(avisoDoEstadoLocal("microfone-mudo", true, true)?.texto).toContain("Configurações");
    // No navegador quem libera é o navegador: sem botão.
    expect(avisoDoEstadoLocal("microfone-negado", false, true)?.ajustes).toBeUndefined();
    expect(avisoDoEstadoLocal("microfone-restrito", true)?.texto).toContain("deste computador");
  });
  it("ditado: o texto das Configurações", () => {
    vi.stubGlobal("navigator", { userAgent: UA_WINDOWS });
    expect(textoDaFalha("microfone-negado", true)).toContain("Configurações › Privacidade e segurança › Microfone");
    expect(textoDaFalha("microfone-negado", false)).toContain("navegador");
  });
});
