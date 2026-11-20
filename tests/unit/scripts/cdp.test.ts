import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { portaDoDevTools } from "../../../scripts/carga-tela/cdp.ts";

describe("porta efêmera do Chrome", () => {
  it("lê a porta publicada no perfil e recusa arquivo ausente ou inválido", () => {
    const perfil = mkdtempSync(join(tmpdir(), "nod-cdp-"));
    expect(portaDoDevTools(perfil)).toBeNull();
    writeFileSync(join(perfil, "DevToolsActivePort"), "43127\n/devtools/browser/id\n");
    expect(portaDoDevTools(perfil)).toBe(43_127);
    writeFileSync(join(perfil, "DevToolsActivePort"), "0\n");
    expect(portaDoDevTools(perfil)).toBeNull();
  });
});
