import { describe, expect, it } from "vitest";
import { listarCofre, nomeDaCredencial } from "../../../src/use-cases/cofre.ts";
import { renderCofre, TELA_COFRE_INICIAL } from "../../../web/telas/config-cofre.ts";

const AGORA = new Date(2026, 10, 12, 15, 0).getTime();

describe("Configurações › Cofre (Paper 07, rodada 2)", () => {
  it("o caso de uso lista nome, app e data, uma vez por (app, nome), a mais nova primeiro — sem valor nenhum", async () => {
    const linhas = [
      { alvo: "conector", chave: "EXEMPLO_API_KEY", app: "Exemplo", guardadaEm: AGORA - 3_600_000 },
      { alvo: "github_token", chave: null, app: "GitHub", guardadaEm: AGORA - 60_000 },
      { alvo: "conector", chave: "EXEMPLO_API_KEY", app: "Exemplo", guardadaEm: AGORA - 86_400_000 },
      { alvo: "composio", chave: null, app: "Composio", guardadaEm: AGORA - 7_200_000 },
    ];
    const deps = { repos: { propostas: { credenciaisGuardadas: async () => linhas } } } as never;
    const r = await listarCofre(deps, {} as never);
    expect(r.data.credenciais).toEqual([
      { nome: "Token do GitHub", app: "GitHub", guardadaEm: AGORA - 60_000 },
      { nome: "EXEMPLO_API_KEY", app: "Exemplo", guardadaEm: AGORA - 3_600_000 },
      { nome: "Chave do Composio", app: "Composio", guardadaEm: AGORA - 7_200_000 },
    ]);
    expect(Object.keys(r.data.credenciais[0]!).sort()).toEqual(["app", "guardadaEm", "nome"]);
    expect(nomeDaCredencial({ alvo: "conector", chave: null })).toBe("Chave");
  });

  it("a seção: carregando, vazio, erro com Tentar de novo, e a lista com o nome, o app e quando", () => {
    expect(renderCofre(TELA_COFRE_INICIAL, AGORA)).toContain("Abrindo o cofre…");
    expect(renderCofre({ credenciais: [], carregando: false, erro: false }, AGORA)).toContain("Nenhuma chave guardada ainda");
    expect(renderCofre({ credenciais: null, carregando: false, erro: true }, AGORA)).toContain('data-act="recarregar-cofre"');
    const html = renderCofre({ credenciais: [{ nome: "<b>X</b>", app: "Exemplo", guardadaEm: AGORA - 60_000 }], carregando: false, erro: false }, AGORA, "America/Sao_Paulo");
    expect(html).toContain("<h2>Cofre</h2>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).toContain("Exemplo");
    expect(html).toContain("guardada hoje");
  });
});
