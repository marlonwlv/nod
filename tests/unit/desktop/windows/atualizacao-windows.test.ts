import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estadoNaTela } from "../../../../desktop/atualizacao-na-tela.ts";

const preload = readFileSync(new URL("../../../../desktop/windows/preload-web-windows.ts", import.meta.url), "utf8");
const preloadMac = readFileSync(new URL("../../../../desktop/preload-web.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../../../../desktop/windows/main.ts", import.meta.url), "utf8");

describe("ADR-188: o cartão \"Atualizar o nod\" e Sobre o nod também no Windows", () => {
  it("a janela web do Windows e a do Mac expõem a mesma ponte da atualização, só com canais nomeados", () => {
    const objeto = (fonte: string) => fonte.slice(fonte.indexOf('const atualizacaoApp: NonNullable<PonteAtualizacaoApp["atualizacaoApp"]> = {'), fonte.indexOf("\n};", fonte.indexOf("const atualizacaoApp:")));
    expect(objeto(preload).length).toBeGreaterThan(100);
    expect(objeto(preload)).toBe(objeto(preloadMac));
    expect(objeto(preload)).toContain("CANAIS_ATUALIZACAO.reiniciar, { quando: pedido?.quando }");
    expect(objeto(preload)).toContain("CANAIS_ATUALIZACAO.definirSozinho, ligado === true");
    expect(preload).toMatch(/\n {2}atualizacaoApp,\n/);
  });

  it("o main do Windows responde só à página do servidor conectado e reinicia sem perguntar (o motor roda fora do app)", () => {
    for (const canal of ["estado", "reiniciar", "procurar", "definirSozinho", "avisoVisto"]) expect(main).toContain(`ipcMain.handle(CANAIS_ATUALIZACAO.${canal}, (e`);
    expect(main).toMatch(/ipcMain\.handle\(CANAIS_ATUALIZACAO\.reiniciar, \(e, pedido: unknown\) => \{ if \(!daJanela\(e\)\) throw new Error\("entrada_invalida"\);/);
    expect(main).toMatch(/decidirReinicio\(p, \{ pronta: atualizacao\?\.estado\(\)\.fase === "pronta", emLigacao: false, turnos: 0, telas: 0 \}\)/);
    // O estado chega à janela quando muda, e o aviso "atualizado" sai da última versão guardada.
    expect(main).toMatch(/aoMudar: \(e\) => \{[^\n]*enviarAtualizacaoParaWeb\(\); \}/);
    expect(main).toMatch(/atualizacao = montarAtualizacao\(\);\n\s*lembrarVersao\(\);/);
  });

  it("no Windows não há o reinício com o computador parado: `sozinho` vai null", () => {
    expect(main).toContain("sozinho: null");
    expect(estadoNaTela({ fase: "pronta", versao: "1.0.4" }, { versaoAtual: "1.0.3", esperandoLivre: false, reiniciando: false, sozinho: null, atualizadoDe: null }).sozinho).toBeNull();
  });
});
