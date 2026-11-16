import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** ADR-182: a janela web do Mac nasce antes do executor, na partição persistente, sem apagar o storage da mesma pessoa. */
describe("ADR-182: abertura do app do Mac (desktop/main.ts)", () => {
  const main = readFileSync("desktop/main.ts", "utf8");
  const quickChat = readFileSync("desktop/quick-chat-app.ts", "utf8");

  it("toda janela da web usa a partição persistente (o bundle fica no cache HTTP entre aberturas)", () => {
    expect(main).toContain('const PARTICAO_WEB = "persist:nod-web";');
    expect(main).not.toMatch(/partition: "nod-web"/);
    expect(main).not.toMatch(/fromPartition\("nod-web"\)/);
    expect(main.match(/partition: PARTICAO_WEB/g)?.length).toBe(2);
    expect(main).toContain("session.fromPartition(PARTICAO_WEB)");
    expect(quickChat).toContain('partition: "persist:nod-web"');
  });

  it("o storage da web só é apagado quando a pessoa ou o servidor mudou; a mesma pessoa troca só o cookie", () => {
    const conectar = main.slice(main.indexOf("async function conectar(c: Config) {"));
    expect(conectar).toContain("const mesmaPessoa = configuracao?.url === c.url && configuracao?.pessoaId === dados.escopo.pessoaId;");
    expect(conectar).toContain('await web.clearStorageData(mesmaPessoa ? { storages: ["cookies"] } : undefined);');
    expect(conectar).toContain("const comPessoa: Config = { ...c, pessoaId: dados.escopo.pessoaId };");
    expect(conectar).toContain("await guardar(comPessoa); configuracao = comPessoa;");
    // ler() devolve o pessoaId guardado (senão toda abertura contaria como pessoa nova).
    expect(main).toContain('...(typeof c.pessoaId === "string" ? { pessoaId: c.pessoaId } : {})');
  });

  it("a janela nasce logo depois do cookie, antes de montar o executor; a carga da página é aguardada no fim", () => {
    const conectar = main.slice(main.indexOf("async function conectar(c: Config) {"));
    const janela = conectar.indexOf("const carregamento = abrirJanelaWeb(c);");
    const executor = conectar.indexOf("const cfg = await montarCfg(envExecutor);");
    const vigia = conectar.indexOf("await vigia.iniciar(criado);");
    const fim = conectar.indexOf("await carregamento;");
    expect(janela).toBeGreaterThan(0);
    expect(janela).toBeLessThan(executor);
    expect(executor).toBeLessThan(vigia);
    expect(vigia).toBeLessThan(fim);
    // Só uma janela web por conexão: o loadURL mora em abrirJanelaWeb.
    expect(conectar).not.toContain("await nova.loadURL(c.url);");
    expect(main).toMatch(/function abrirJanelaWeb\(c: Config\): Promise<void> \{[\s\S]*return nova\.loadURL\(c\.url\)\.then\(\(\) => \{ anterior\?\.close\(\); mensagem = "Conectado\."; \}, \(\) => undefined\);/);
  });
});
