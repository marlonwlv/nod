import { describe, expect, it } from "vitest";
import type { LoginDoCofreNaTela } from "../../../src/contracts/navegador-do-bot.ts";
import { criarTelaCofre, destinoAoApagar } from "../../../web/lib/cofre.ts";
import { TELA_COFRE_INICIAL } from "../../../web/telas/config-cofre.ts";

// QA-206: Apagar, Desfazer e Ver todos tiram da tela o botão focado; o foco tem destino (no Chrome real ia ao <body>).
const login = (id: string, site: string) => ({ id, site, usuario: "an…", criadoEm: "2026-11-25T01:00:00Z" }) as unknown as LoginDoCofreNaTela;
const logins = [login("a", "a.com.br"), login("b", "b.com.br"), login("c", "c.com.br")];

describe("Cofre › foco depois de a linha sumir (QA-206)", () => {
  it("vai ao “…” da seguinte, da anterior e, sem nenhuma, ao Novo item", () => {
    const t = { ...TELA_COFRE_INICIAL, logins };
    expect(destinoAoApagar(t, "b")).toBe('[data-act="cofre-menu-item"][data-id="login:c"]');
    expect(destinoAoApagar(t, "c")).toBe('[data-act="cofre-menu-item"][data-id="login:b"]');
    expect(destinoAoApagar({ ...t, apagando: new Set(["a", "c"]) }, "b")).toBe('[data-act="cofre-menu-novo"]');
    expect(destinoAoApagar({ ...t, filtro: "c.com.br" }, "c")).toBe('[data-act="cofre-menu-novo"]');
    expect(destinoAoApagar({ ...t, apagando: new Set(["a", "c"]), adicionando: true }, "b")).toBe('.cofre-dialogo input[name="site"]');
  });

  it("Apagar, Desfazer e Ver todos pedem o destino antes do desenho", async () => {
    const focos: string[] = []; let desfazer: (() => void) | null = null;
    const tela = criarTelaCofre({
      api: () => ({ cofre: async () => ({ credenciais: [] }) as never, cofreLogins: async () => ({ logins }), apagarDoCofre: async () => ({ ok: true }) }),
      render: () => {}, avisar: (_t, d) => { desfazer = d; }, esperar: () => 0, cancelar: () => {}, focar: (s) => focos.push(s),
    });
    await tela.abrir();
    tela.apagarLogin("a");
    expect(focos.at(-1)).toBe('[data-act="cofre-menu-item"][data-id="login:b"]');
    desfazer!();
    expect(focos.at(-1)).toBe('[data-act="cofre-menu-item"][data-id="login:a"]');
    tela.filtrar("b.com.br");
    tela.verTodos();
    expect(focos.at(-1)).toBe('[data-act="cofre-menu-novo"]');
    expect(tela.estado().filtro).toBeNull();
    expect(tela.estado().aba).toBe("tudo");
  });
});
