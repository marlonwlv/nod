import { describe, expect, it } from "vitest";
import { listarCofre, nomeDaCredencial } from "../../../src/use-cases/cofre.ts";
import type { ChaveDoCofreNaTela } from "../../../src/contracts/cofre.ts";
import { APPS_DO_COFRE } from "../../../src/domain/apps-do-cofre.ts";
import { fraseDoErroDaChave } from "../../../web/lib/cofre.ts";
import { itensVisiveis, quemUsaATexto, renderCofre, TELA_COFRE_INICIAL, textoDoUso, type TelaCofre } from "../../../web/telas/config-cofre.ts";

const AGORA = new Date(2026, 10, 12, 15, 0).getTime();

describe("Configurações › Cofre (Paper 07, rodada 2)", () => {
  it("o caso de uso lista nome, app e data, uma vez por (app, nome), a mais nova primeiro — sem valor nenhum", async () => {
    const linhas = [
      { alvo: "conector", chave: "EXEMPLO_API_KEY", app: "Exemplo", guardadaEm: AGORA - 3_600_000 },
      { alvo: "github_token", chave: null, app: "GitHub", guardadaEm: AGORA - 60_000 },
      { alvo: "conector", chave: "EXEMPLO_API_KEY", app: "Exemplo", guardadaEm: AGORA - 86_400_000 },
      { alvo: "composio", chave: null, app: "Composio", guardadaEm: AGORA - 7_200_000 },
      // ADR-195 (Entrega 3): a chave do alvo "app" mora no cofre em envelope (`chaves`), não se repete aqui.
      { alvo: "app", chave: "ORGO_API_KEY", app: "Orgo", guardadaEm: AGORA - 1_000 },
    ];
    const deps = {
      escopo: { tenantId: "t", pessoaId: "p" },
      repos: { propostas: { credenciaisGuardadas: async () => linhas }, cofre: { listarItens: async () => [], concessoesDosItens: async () => [] }, agentes: { buscarVarios: async () => [] } },
    } as never;
    const r = await listarCofre(deps, {} as never);
    expect(r.data.chaves).toEqual([]);
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

describe("ADR-195 (Entrega 3): chaves do Cofre na tela (Paper C1, C2 e C3)", () => {
  const chave = (p: Partial<ChaveDoCofreNaTela> = {}): ChaveDoCofreNaTela => ({
    id: "11111111-1111-4111-8111-111111111111", nome: "ORGO_API_KEY", app: "Orgo", appId: "orgo", dono: "pessoa", sua: true,
    quem: [{ agenteId: "a1", nome: "Chico", modo: "sempre" }], ultimoUsoEm: AGORA - 3 * 60_000, guardadaEm: AGORA - 86_400_000,
    testadaEm: AGORA - 60_000, dicas: null, pedidaPor: "Chico", ...p,
  });
  const base: TelaCofre = { ...TELA_COFRE_INICIAL, credenciais: [], logins: [], chaves: [chave()], apps: [APPS_DO_COFRE.orgo] };
  const bots = [{ id: "a1", nome: "Chico", cor: "c-blue" }, { id: "a2", nome: "Dante", cor: "c-orange" }];

  it("C1: a linha leva o app, a variável no selo, quem usa e o último uso, de quem é e o … com Abrir, Trocar e Remover", () => {
    const html = renderCofre({ ...base, menu: `chave:${chave().id}` }, AGORA, "UTC", bots);
    expect(html).toContain("Orgo");
    expect(html).toContain('<code class="lc-selo">ORGO_API_KEY</code>');
    expect(html).toContain("Chico usa sempre · usada há 3 min");
    expect(html).toContain("Tudo<span class=\"cofre-conta\">1</span>");
    for (const a of ['data-act="cofre-abrir-chave"', 'data-trocar="1"', 'data-act="cofre-remover-chave"']) expect(html).toContain(a);
    expect(quemUsaATexto({ quem: [] })).toBe("Nenhum bot usa ainda");
    expect(quemUsaATexto({ quem: [{ agenteId: "a", nome: "Dante", modo: "perguntar" }] })).toBe("Dante pergunta antes");
    expect(quemUsaATexto({ quem: [{ agenteId: "a", nome: "A", modo: "sempre" }, { agenteId: "b", nome: "B", modo: "sempre" }, { agenteId: "c", nome: "C", modo: "sempre" }] })).toBe("A e mais 2 usam");
    // De outra pessoa (chave do time): sem Trocar nem Remover.
    const doTime = renderCofre({ ...base, chaves: [chave({ sua: false, dono: "time" })], menu: `chave:${chave().id}` }, AGORA, "UTC", bots);
    expect(doTime).toContain("Do time");
    expect(doTime).not.toContain('data-act="cofre-remover-chave"');
    // A busca acha pelo bot que usa; a aba Logins tira as chaves.
    expect(itensVisiveis({ ...base, busca: "chico" }).cofreChaves).toHaveLength(1);
    expect(itensVisiveis({ ...base, aba: "logins" }).cofreChaves).toHaveLength(0);
    // O Novo item tem a Chave antes do Login de site (Paper C4).
    const menu = renderCofre({ ...base, menu: "novo" }, AGORA, "UTC", bots);
    expect(menu.indexOf('data-act="cofre-nova-chave"')).toBeLessThan(menu.indexOf('data-act="cofre-adicionar-login"'));
  });

  it("C2: a chave aberta mostra a variável, o valor oculto testado com Trocar, quem pode usar, o uso recente e nunca o valor", () => {
    const detalhe = { chave: chave({ quem: [{ agenteId: "a1", nome: "Chico", modo: "sempre" }] }), uso: [{ tipo: "entregue" as const, agente: "Chico", quando: AGORA - 60_000, onde: "no computador da Orgo" }, { tipo: "guardado" as const, agente: null, quando: AGORA - 120_000, peloCartaoDe: "Chico" }] };
    const aberta = { id: chave().id, detalhe, erro: false, trocando: false, erroTroca: null, guardando: false, dando: true };
    const html = renderCofre({ ...base, aberta }, AGORA, "UTC", bots);
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain("Chave sua · guardada pelo cartão de Chico");
    expect(html).toContain("Guardado, oculto");
    expect(html).toContain("· testada hoje");
    expect(html).toContain('data-act="cofre-trocar-chave"');
    expect(html).toContain('data-act-change="cofre-modo-acesso"');
    expect(html).toContain("Chico usou no computador da Orgo");
    expect(html).toContain("Você guardou pelo cartão de Chico");
    // "Dar a outro bot" oferece só quem ainda não usa.
    expect(html).toContain('data-act="cofre-dar-acesso"');
    expect(html).toContain('data-agente="a2"');
    expect(html).not.toMatch(/data-act="cofre-dar-acesso"[^>]*data-agente="a1"/);
    expect(html).toContain('data-act="cofre-remover-chave"');
    // Trocar abre o campo do valor novo, vazio.
    const trocando = renderCofre({ ...base, aberta: { ...aberta, trocando: true } }, AGORA, "UTC", bots);
    expect(trocando).toContain('data-form="cofre-guardar-troca"');
    expect(trocando).toMatch(/<input name="valor" type="password"(?![^>]*value=)/);
    expect(textoDoUso({ tipo: "negado", agente: "Dante", quando: 0 })).toBe("Dante pediu · você negou");
  });

  it("C3: a Nova chave vem com a Orgo e a ORGO_API_KEY, o valor nunca preenchido, e o erro da Orgo pelo código", () => {
    const html = renderCofre({ ...base, novaChave: { appId: "orgo", nome: "ORGO_API_KEY", agenteId: "a1", dicas: "só testes", erro: null, guardando: false } }, AGORA, "UTC", bots);
    expect(html).toContain('data-form="cofre-guardar-chave"');
    expect(html).toContain("Com um app conhecido, testamos a chave antes de guardar.");
    expect(html).toContain('value="ORGO_API_KEY"');
    expect(html).toContain('<option value="a1" selected>Chico</option>');
    expect(html).toContain('value="só testes"');
    expect(html).toMatch(/<input name="valor" type="password"(?![^>]*value=)/);
    expect(html).toContain("Guardada, ninguém vê o valor.");
    const outro = renderCofre({ ...base, novaChave: { appId: "", nome: "", agenteId: "", dicas: "", erro: null, guardando: true } }, AGORA, "UTC", bots);
    expect(outro).toContain("Sem um app conhecido, a chave é guardada sem teste.");
    expect(outro).toContain("Guardando…");
    expect(fraseDoErroDaChave("integracao_autenticacao", { nome: "Orgo", artigo: "a" })).toBe("A Orgo recusou essa chave. Confira se copiou inteira e cole de novo.");
    expect(fraseDoErroDaChave("estado_invalido", null, "X_KEY")).toBe("Já existe a chave X_KEY no cofre. Abra ela e use Trocar.");
  });
});
