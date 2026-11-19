import { describe, expect, it, vi } from "vitest";
import { comVerificadorDoProvisorio, criarTravaDeSessao } from "../../../web/lib/trava-sessao.ts";

describe("trava das mudanças de sessão", () => {
  it("login primeiro impede o provisório de substituir a sessão", async () => {
    const trava = criarTravaDeSessao();
    let sessao: "nenhuma" | "conta" | "provisorio" = "nenhuma";
    let liberarLogin!: () => void;
    const portao = new Promise<void>((resolve) => { liberarLogin = resolve; });
    const loginApi = vi.fn(async () => { await portao; sessao = "conta"; });
    const provisorioApi = vi.fn(async () => { sessao = "provisorio"; });
    const abrirProvisorio = () => trava.executar(async () => {
      if (sessao === "conta") return;
      await provisorioApi();
    });

    const login = trava.executar(loginApi);
    await Promise.resolve();
    const provisorio = abrirProvisorio();
    await Promise.resolve();
    expect(loginApi).toHaveBeenCalledOnce();
    expect(provisorioApi).not.toHaveBeenCalled();
    liberarLogin();

    await Promise.all([login, provisorio]);
    expect(provisorioApi).not.toHaveBeenCalled();
    expect(sessao).toBe("conta");
  });

  it("provisório primeiro termina antes do login, que fica como sessão final", async () => {
    const trava = criarTravaDeSessao();
    let sessao: "nenhuma" | "conta" | "provisorio" = "nenhuma";
    let liberarProvisorio!: () => void;
    const portao = new Promise<void>((resolve) => { liberarProvisorio = resolve; });
    const provisorioApi = vi.fn(async () => { await portao; sessao = "provisorio"; });
    const loginApi = vi.fn(async () => { sessao = "conta"; });

    const provisorio = trava.executar(provisorioApi);
    await Promise.resolve();
    const login = trava.executar(loginApi);
    await Promise.resolve();
    expect(loginApi).not.toHaveBeenCalled();
    liberarProvisorio();

    await Promise.all([provisorio, login]);
    expect(provisorioApi).toHaveBeenCalledOnce();
    expect(loginApi).toHaveBeenCalledOnce();
    expect(sessao).toBe("conta");
  });
});

describe("verificador do espaço provisório", () => {
  const valor = "a".repeat(43);

  it("só persiste o novo verificador depois do sucesso", async () => {
    const gravar = vi.fn();
    await expect(comVerificadorDoProvisorio({ ler: () => null, gravar, gerar: () => valor, abrir: async () => false })).resolves.toBe(false);
    expect(gravar).not.toHaveBeenCalled();

    await expect(comVerificadorDoProvisorio({ ler: () => null, gravar, gerar: () => valor, abrir: async () => true })).resolves.toBe(true);
    expect(gravar).toHaveBeenCalledOnce();
    expect(gravar).toHaveBeenCalledWith(valor);
  });
});
