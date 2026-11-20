import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ContaIa, CotaDaContaDto } from "../../../src/contracts/contas-ia.ts";
import { hora } from "../../../web/lib/render.ts";
import { htmlMenuConta, informacoesDaVersao, itensDoMenuConta, ITENS_SUPORTE, provedoresDoMenu, teclaDoMenuConta, type DadosMenuConta } from "../../../web/telas/menu-conta.ts";

/**
 * Spec do item 2 (2026-11-12): o menu da conta no avatar do rodapé — a ordem dos itens (com e sem o espaço provisório), os
 * dois submenus (Provedores de IA e Suporte), o teclado (função pura) e o rodapé sem a engrenagem.
 */
const AGORA = new Date(2026, 10, 12, 15, 0).getTime();
const RENOVA = new Date(2026, 10, 12, 18, 40).getTime();
const SEMANA = new Date(2026, 10, 16, 9, 0).getTime();
const MAC = "22222222-2222-4222-8222-222222222222";
const cota = (cinco: number | null, semana: number | null = 0.2): CotaDaContaDto => ({
  cincoHoras: cinco === null ? null : { utilizacao: cinco, renovaEm: RENOVA },
  semana: semana === null ? null : { utilizacao: semana, renovaEm: SEMANA },
  situacao: "livre", voltaEm: null, medidoEm: AGORA - 60_000, maquinaId: MAC, renovou: { cincoHoras: null, semana: null },
});
const conta = (id: string, apelido: string, o: Partial<ContaIa> = {}): ContaIa => ({
  id, ia: "claude-cli", impressao: "0".repeat(64), apelido, email: null, organizacao: null, plano: "Max", corporativa: false, posicao: 0,
  entraNaTrocaAutomatica: true, noLimiteAte: null, maquinas: [{ maquinaId: MAC, nome: "MacBook Air", estado: "pronta" }], ...o,
});
const base: DadosMenuConta = { faixa: null, conexao: "Conectada", conta: { email: "ana@x.com", senha: true } };
const ler = (f: string): string => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");
/** Os data-* dos itens de um trecho de HTML, na ordem. */
const itens = (h: string) => [...h.matchAll(/role="menuitem" (data-[a-z]+="[^"]+")/g)].map((m) => m[1]);
const menuPrincipal = (h: string) => h.slice(h.indexOf('class="mc-menu"'), h.indexOf('class="mc-sub"') > 0 ? h.indexOf('class="mc-sub"') : undefined);

describe("ordem dos itens", () => {
  it("com conta: Provedores de IA, Agentes, Suporte, Configurações, divisória e Sair", () => {
    expect(itensDoMenuConta(base)).toEqual(["provedores", "agentes", "suporte", "configuracoes", "sair"]);
    const h = menuPrincipal(htmlMenuConta(base));
    expect(itens(h)).toEqual(['data-sub="provedores"', 'data-secao="agentes"', 'data-sub="suporte"', 'data-secao="geral"', 'data-conta="sair"']);
    expect(h.indexOf("<hr>")).toBeGreaterThan(h.indexOf('data-secao="geral"'));
    expect(h.indexOf("<hr>")).toBeLessThan(h.indexOf('data-conta="sair"'));
  });

  it("no espaço provisório, no lugar de Sair: Criar conta ou entrar (e Sou da equipe… quando houver)", () => {
    const sem = { ...base, conta: { email: null, senha: false } };
    expect(itensDoMenuConta(sem)).toEqual(["provedores", "agentes", "suporte", "configuracoes", "inicio"]);
    expect(itensDoMenuConta({ ...sem, equipe: "/api/sessao/google" })).toEqual(["provedores", "agentes", "suporte", "configuracoes", "inicio", "equipe"]);
    const h = htmlMenuConta({ ...sem, equipe: "app" });
    expect(h).not.toContain('data-conta="sair"');
    expect(h).toContain("Criar conta ou entrar");
    expect(h).toContain("Sou da equipe: conectar com a chave");
  });

  it("sem contas no servidor, só os quatro itens", () => {
    expect(itensDoMenuConta({})).toEqual(["provedores", "agentes", "suporte", "configuracoes"]);
    expect(htmlMenuConta({ faixa: null, conexao: "Conectada" })).not.toContain("<hr>");
  });

  it("a meta de Configurações é a tecla (⌘, ou a do lugar) e os itens com submenu têm chevron e aria-haspopup", () => {
    const h = htmlMenuConta(base);
    expect(h).toMatch(/data-secao="geral">[\s\S]*?<span class="mc-meta">⌘,<\/span>/);
    expect(htmlMenuConta({ ...base, teclas: { ajustes: "Ctrl+,", atalhos: "Ctrl+/" } })).toContain("Ctrl+,");
    expect(h).toMatch(/data-sub="provedores" aria-haspopup="menu" aria-expanded="false" aria-controls="mc-sub-provedores">[\s\S]*?mc-chevron/);
    expect(h).toMatch(/data-sub="suporte" aria-haspopup="menu"/);
  });

  it("a faixa de aviso fica acima dos itens, fora do role=menu; o bloco de quem está logado saiu", () => {
    const h = htmlMenuConta({ ...base, faixa: { texto: "Claude desconectada", botao: "Conectar" } });
    expect(h.indexOf("mc-faixa")).toBeLessThan(h.indexOf('role="menu"'));
    expect(h).not.toContain("mc-quem");
  });

  it("no celular (folha), sem submenus nem teclas: Provedores abre a seção e o Suporte vira Ajuda e Enviar feedback", () => {
    const h = htmlMenuConta(base, true);
    expect(h).not.toContain("data-sub=");
    expect(h).not.toContain("mc-sub");
    expect(h).not.toContain("⌘");
    expect(itens(h)).toEqual(['data-secao="conexao"', 'data-secao="agentes"', 'data-secao="ajuda"', 'data-secao="feedback"', 'data-secao="geral"', 'data-conta="sair"']);
  });
});

describe("submenus", () => {
  it("Provedores de IA: uma linha por conta logada (informativa), separadas, e por último Gerenciar provedores", () => {
    const contas = [conta("a", "Pessoal", { cota: cota(0.42) }), conta("b", "Trabalho", { posicao: 1, cota: cota(0.1, 0.73) }), conta("c", "Fora", { posicao: 2, maquinas: [] })];
    const p = provedoresDoMenu(contas, AGORA);
    expect(p.linhas).toEqual([
      { titulo: "Claude · Pessoal", detalhe: `5 h · renova ${hora(RENOVA)}`, pct: 42 },
      { titulo: "Claude · Trabalho", detalhe: "Semana · renova 16/11 às " + hora(SEMANA), pct: 73 },
    ]);
    // A meta do item: o maior uso da conta em uso (a primeira da fila), não da lista toda.
    expect(p.pct).toBe(42);
    const h = htmlMenuConta({ ...base, provedores: p });
    expect(h).toContain('<span class="mc-meta">42% usado</span>');
    const sub = h.slice(h.indexOf('aria-label="Provedores de IA"'), h.indexOf('aria-label="Suporte"'));
    expect(sub).toContain('id="mc-sub-provedores"');
    expect([...sub.matchAll(/class="mc-info"/g)]).toHaveLength(2);
    expect(sub).toMatch(/role="menuitem" aria-disabled="true" class="mc-info">[\s\S]*Claude · Pessoal[\s\S]*5 h · renova[\s\S]*42% usado/);
    expect(sub.indexOf("Claude · Trabalho")).toBeGreaterThan(sub.indexOf("<hr>"));
    expect(itens(sub)).toEqual(['data-secao="conexao"']);
    expect(sub.lastIndexOf("Gerenciar provedores")).toBeGreaterThan(sub.lastIndexOf("mc-info"));
  });

  it("sem leitura de uso: a meta some e a linha mostra só o nome", () => {
    const p = provedoresDoMenu([conta("a", "Pessoal")], AGORA);
    expect(p).toEqual({ pct: null, linhas: [{ titulo: "Claude · Pessoal", detalhe: "", pct: null }] });
    const h = htmlMenuConta({ ...base, provedores: p });
    expect(h).not.toContain("% usado");
    expect(h).not.toContain("mc-info-detalhe");
    expect(provedoresDoMenu([], AGORA)).toEqual({ pct: null, linhas: [] });
    expect(htmlMenuConta(base)).toMatch(/id="mc-sub-provedores"[^>]*hidden><button[^>]*data-secao="conexao"/);
  });

  it("Suporte: Ajuda, Atalhos de teclado (⌘/), Enviar feedback e Sobre o nod", () => {
    const h = htmlMenuConta(base);
    const sub = h.slice(h.indexOf('id="mc-sub-suporte"'));
    expect(ITENS_SUPORTE).toEqual(["ajuda", "atalhos", "feedback", "sobre"]);
    expect(itens(sub)).toEqual(['data-secao="ajuda"', 'data-acao="atalhos"', 'data-secao="feedback"', 'data-acao="sobre"']);
    expect(sub).toMatch(/Atalhos de teclado<\/span><span class="mc-meta">⌘\/<\/span>/);
    expect(sub).toContain("Sobre o nod");
  });

  it("Sobre o nod copia a versão e o navegador", () => {
    expect(informacoesDaVersao("1.2.3", "Mozilla/5.0")).toBe("nod 1.2.3\nNavegador: Mozilla/5.0");
    expect(informacoesDaVersao("1.2.3", "")).toBe("nod 1.2.3");
  });
});

describe("teclado (teclaDoMenuConta)", () => {
  const no = (indice: number, o: Partial<{ total: number; noSubmenu: boolean; temSubmenu: boolean }> = {}) => ({ indice, total: 5, noSubmenu: false, temSubmenu: false, ...o });

  it("↓ sem foco vai ao 1º item; ↑/↓ andam e dão a volta; Home e End vão às pontas", () => {
    expect(teclaDoMenuConta("ArrowDown", no(-1))).toEqual({ tipo: "focar", indice: 0 });
    expect(teclaDoMenuConta("ArrowDown", no(1))).toEqual({ tipo: "focar", indice: 2 });
    expect(teclaDoMenuConta("ArrowDown", no(4))).toEqual({ tipo: "focar", indice: 0 });
    expect(teclaDoMenuConta("ArrowUp", no(0))).toEqual({ tipo: "focar", indice: 4 });
    expect(teclaDoMenuConta("ArrowUp", no(-1))).toEqual({ tipo: "focar", indice: 4 });
    expect(teclaDoMenuConta("Home", no(3))).toEqual({ tipo: "focar", indice: 0 });
    expect(teclaDoMenuConta("End", no(0))).toEqual({ tipo: "focar", indice: 4 });
  });

  it("→ abre o submenu só num item que tem; ← e Esc fecham o submenu; Esc no menu fecha o menu", () => {
    expect(teclaDoMenuConta("ArrowRight", no(0, { temSubmenu: true }))).toEqual({ tipo: "abrir-submenu" });
    expect(teclaDoMenuConta("ArrowRight", no(1))).toBeNull();
    expect(teclaDoMenuConta("ArrowRight", no(0, { noSubmenu: true, temSubmenu: true }))).toBeNull();
    expect(teclaDoMenuConta("ArrowLeft", no(0, { noSubmenu: true }))).toEqual({ tipo: "fechar-submenu" });
    expect(teclaDoMenuConta("ArrowLeft", no(0))).toBeNull();
    expect(teclaDoMenuConta("Escape", no(2, { noSubmenu: true }))).toEqual({ tipo: "fechar-submenu" });
    expect(teclaDoMenuConta("Escape", no(2))).toEqual({ tipo: "fechar-menu" });
  });

  it("outras teclas seguem com o navegador (Enter clica o item)", () => {
    expect(teclaDoMenuConta("Enter", no(0))).toBeNull();
    expect(teclaDoMenuConta("a", no(0))).toBeNull();
    expect(teclaDoMenuConta("ArrowDown", no(-1, { total: 0 }))).toBeNull();
  });
});

describe("rodapé e CSS", () => {
  const main = ler("main.ts");
  const rodape = main.slice(main.indexOf('<div class="rodape">'), main.indexOf("</div>`;", main.indexOf('<div class="rodape">')));

  it("a engrenagem saiu do rodapé; Conectar aplicativos fica, e o ⌘, segue abrindo Configurações", () => {
    expect(rodape).not.toContain('data-act="abrir-ajustes"');
    expect(rodape).toMatch(/data-tela="conectores"[^>]*aria-label="Conectar aplicativos"/);
    expect(rodape).toContain('class="me conta-pilula');
    expect(rodape).toMatch(/data-act="menu-conta" aria-haspopup="menu" aria-expanded="\$\{menuContaAberto\(\)/);
    expect(main).toMatch(/if \(a\.tipo === "ajustes"\) \{ abrirEspaco\("geral"\)/);
  });

  it("os tempos do movimento: 100 ms para abrir e fechar, 50 ms na troca de submenu, seco com reduced-motion", () => {
    const css = ler("menu-conta.css");
    expect(css).toMatch(/animation: mc-entra 100ms cubic-bezier\(0\.165, 0\.84, 0\.44, 1\)/);
    expect(css).toMatch(/\.fechando \{ animation: mc-sai 100ms/);
    expect(css).toMatch(/\.saindo \{ animation: mc-sub-sai 50ms/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    expect(css).toMatch(/transition: color 300ms cubic-bezier\(0\.2, 0, 0, 1\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    expect(ler("index.html")).toContain('<link rel="stylesheet" href="/menu-conta.css" />');
  });
});
