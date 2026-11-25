import { describe, expect, it } from "vitest";
import { listarCofre, nomeDaCredencial } from "../../../src/use-cases/cofre.ts";
import { itensVisiveis, renderCofre, TELA_COFRE_INICIAL, type TelaCofre } from "../../../web/telas/config-cofre.ts";

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
    expect(renderCofre(TELA_COFRE_INICIAL, AGORA, "UTC")).toContain("Abrindo o cofre…");
    expect(renderCofre({ credenciais: [], carregando: false, erro: false }, AGORA, "UTC")).toContain("Nada guardado ainda.");
    expect(renderCofre({ credenciais: null, carregando: false, erro: true }, AGORA, "UTC")).toContain('data-act="recarregar-cofre"');
    const html = renderCofre({ credenciais: [{ nome: "<b>X</b>", app: "Exemplo", guardadaEm: AGORA - 60_000 }], carregando: false, erro: false }, AGORA, "America/Sao_Paulo");
    expect(html).toContain("<h2>Cofre</h2>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).toContain("Exemplo");
    expect(html).toContain("guardada hoje");
  });

  describe("Paper \"Cofre · chaves e logins\" (C1, C4, C7)", () => {
    const base: TelaCofre = {
      ...TELA_COFRE_INICIAL,
      credenciais: [{ nome: "ORGO_API_KEY", app: "Orgo", guardadaEm: AGORA - 60_000 }, { nome: "Token do GitHub", app: "GitHub", guardadaEm: AGORA - 120_000 }, { nome: "Chave do Composio", app: "Composio", guardadaEm: AGORA - 180_000 }],
      logins: [{ id: "l1", site: "gov.br", usuario: "ra…@exemplo.com", criadoEm: AGORA - 60_000 }, { id: "l2", site: "itau.com.br", usuario: "", criadoEm: AGORA - 60_000 }],
    };

    it("a barra conta Tudo, Chaves e Logins; cada grupo é uma .lc-lista e o nome da variável vira selo", () => {
      const html = renderCofre(base, AGORA, "UTC");
      expect(html).toMatch(/data-aba="tudo">Tudo<span class="cofre-conta">5</);
      expect(html).toMatch(/data-aba="chaves">Chaves<span class="cofre-conta">3</);
      expect(html).toMatch(/data-aba="logins">Logins<span class="cofre-conta">2</);
      expect(html.match(/class="lc-lista"/g)).toHaveLength(2);
      expect(html).toContain('<b>Orgo<code class="lc-selo">ORGO_API_KEY</code></b>');
      expect(html).toContain("Token do GitHub · guardada");
      expect(html).toMatch(/Composio<\/b>.*?<span class="lc-quando">Do time<\/span>/);
      expect(html).toContain('data-act="cofre-menu-item" data-id="login:l1"');
      expect(html).toContain("sem usuário");
    });

    it("a aba e a busca só filtram o que já veio (sem acento nem caixa)", () => {
      expect(itensVisiveis({ ...base, aba: "chaves" }).logins).toEqual([]);
      expect(itensVisiveis({ ...base, aba: "logins" }).chaves).toEqual([]);
      const r = itensVisiveis({ ...base, busca: "GÓV" });
      expect(r.chaves).toEqual([]);
      expect(r.logins.map((l) => l.id)).toEqual(["l1"]);
      expect(itensVisiveis({ ...base, busca: "orgo_api" }).chaves.map((c) => c.app)).toEqual(["Orgo"]);
      expect(renderCofre({ ...base, busca: "nada-disso" }, AGORA, "UTC")).toContain("Nada no cofre com “nada-disso”.");
      expect(itensVisiveis({ ...base, apagando: new Set(["l1"]) }).logins.map((l) => l.id)).toEqual(["l2"]);
    });

    it("o Novo item abre o menu com Login de site; o … do login tem Apagar; o vazio é o C4", () => {
      expect(renderCofre(base, AGORA, "UTC")).not.toContain("cofre-novo-menu");
      const novo = renderCofre({ ...base, menu: "novo" }, AGORA, "UTC");
      expect(novo).toContain('aria-expanded="true"');
      expect(novo).toContain('data-act="cofre-adicionar-login"');
      const mais = renderCofre({ ...base, menu: "login:l2" }, AGORA, "UTC");
      expect(mais).toMatch(/data-act="cofre-apagar-login" data-id="l2"/);
      expect(mais).not.toMatch(/data-act="cofre-apagar-login" data-id="l1"/);
      expect(renderCofre({ ...base, credenciais: [], logins: [] }, AGORA, "UTC")).toContain("Nada guardado ainda.");
    });

    it("o diálogo Novo login é modal, fecha pelo fundo, pelo × e pelo Cancelar, e nunca traz a senha", () => {
      const html = renderCofre({ ...base, adicionando: true, erroNovo: "Preencha o site e a senha." }, AGORA, "UTC");
      expect(html).toContain('role="dialog" aria-modal="true"');
      expect(html.match(/data-act="cofre-cancelar-login"/g)).toHaveLength(3);
      expect(html).toContain('role="alert">Preencha o site e a senha.');
      expect(/<input name="senha"[^>]*>/.exec(html)![0]).not.toMatch(/\svalue=/);
    });
  });
});
