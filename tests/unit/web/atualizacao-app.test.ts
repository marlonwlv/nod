import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtualizacaoNaTela, PedidoReinicio, RespostaReinicio } from "../../../src/contracts/desktop-atualizacao.ts";
import { criarAtualizacaoNaWeb, type PonteAtz, type TelaAtualizacao } from "../../../web/lib/atualizacao-app.ts";
import { cartaoAtualizacao, MS_ENCHER_ATUALIZAR, MS_ENTRAR_ATUALIZAR, renderSobre, TEXTOS_ATZ } from "../../../web/telas/atualizacao-app.ts";
import { htmlAvisoAtualizado } from "../../../web/lib/aviso-atualizado-html.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { AJUSTES, NOME_DA_SECAO } from "../../../web/lib/ajustes.ts";

const pronta: AtualizacaoNaTela = { fase: "pronta", versaoAtual: "1.0.3", versaoNova: "1.0.4", motivo: null, procuradaEm: null, esperandoLivre: false, reiniciando: false, sozinho: true, atualizadoDe: null };
const tela = (o: Omit<Partial<TelaAtualizacao>, "estado"> & { estado?: Partial<AtualizacaoNaTela> } = {}): TelaAtualizacao => ({ pergunta: null, pedindo: false, enchendoDesde: null, prontaDesde: null, ...o, estado: { ...pronta, ...o.estado } });

function montar(resposta: RespostaReinicio, inicial: AtualizacaoNaTela = pronta) {
  const pedidos: PedidoReinicio[] = [];
  const avisos: string[] = [];
  let vistos = 0;
  let ouvinte: ((e: AtualizacaoNaTela) => void) | null = null;
  const ponte: PonteAtz = {
    estado: async () => inicial,
    aoMudar: (fn) => { ouvinte = fn; },
    reiniciar: async (p) => { pedidos.push(p); return resposta; },
    procurar: async () => ({ ...inicial, fase: "procurando" }),
    definirSozinho: async (ligado) => ({ ...inicial, sozinho: ligado }),
    avisoVisto: async () => { vistos++; },
  };
  const agendados: { f: () => void; ms: number }[] = [];
  const w = criarAtualizacaoNaWeb({ ponte: () => ponte, aoMudar: () => undefined, avisarAtualizado: (v) => avisos.push(v), msEncher: MS_ENCHER_ATUALIZAR, agendar: (f, ms) => agendados.push({ f, ms }), agora: () => 1_000 });
  return { w, pedidos, avisos, agendados, vistos: () => vistos, empurrar: (e: AtualizacaoNaTela) => ouvinte?.(e) };
}

describe("ADR-188: a atualização do app na janela web", () => {
  it("um clique: a tinta sobe, e só cheia o pedido sai (um segundo clique no meio não repete)", async () => {
    const t = montar({ ok: true, esperando: false });
    await t.w.carregar();
    t.w.encher();
    t.w.encher();
    expect(t.agendados.map((a) => a.ms)).toEqual([800]);
    expect(t.pedidos).toEqual([]);
    expect(t.w.tela()?.enchendoDesde).toBe(1_000);
    // Enchendo: a classe e o atraso negativo (a barra regravada continua de onde a tinta estava).
    const html = cartaoAtualizacao(t.w.tela(), false, 1_300);
    expect(html).toContain('class="atz-cartao enchendo"');
    expect(html).toContain('style="--atz-atraso:-300ms"');
    t.agendados[0]!.f();
    await Promise.resolve(); await Promise.resolve();
    expect(t.pedidos).toEqual([{ quando: "agora" }]);
    expect(t.w.tela()?.enchendoDesde).toBeNull();
  });

  it("depois do pedido, Reiniciando… com o spinner", async () => {
    const t = montar({ ok: true, esperando: false });
    await t.w.carregar();
    await t.w.reiniciar("agora");
    expect(t.pedidos).toEqual([{ quando: "agora" }]);
    expect(t.w.tela()?.estado.reiniciando).toBe(true);
    expect(cartaoAtualizacao(t.w.tela(), false)).toContain(TEXTOS_ATZ.reiniciando);
  });

  it("com bot trabalhando, o cartão vira a pergunta (esperar, reiniciar já, cancelar)", async () => {
    const t = montar({ ok: false, motivo: "ocupado", turnos: 1, telas: 0 });
    await t.w.carregar();
    await t.w.reiniciar("agora");
    expect(t.w.tela()?.pergunta).toEqual({ tipo: "ocupado", turnos: 1, telas: 0 });
    const html = cartaoAtualizacao(t.w.tela(), false);
    expect(html).toContain("Um bot está trabalhando neste Mac");
    for (const acao of ["atualizar-app-quando-livre", "atualizar-app-forcar", "atualizar-app-fechar"]) expect(html).toContain(`data-act="${acao}"`);
    t.w.fecharPergunta();
    expect(t.w.tela()?.pergunta).toBeNull();
  });

  it("em ligação, recusa com a frase e só o OK", async () => {
    const t = montar({ ok: false, motivo: "emLigacao" });
    await t.w.carregar();
    await t.w.reiniciar("agora");
    const html = cartaoAtualizacao(t.w.tela(), false);
    expect(html).toContain(TEXTOS_ATZ.emLigacao);
    expect(html).not.toContain("atualizar-app-forcar");
  });

  it("o aviso \"atualizado\" sai uma vez e avisa o Mac que foi visto", async () => {
    const t = montar({ ok: true, esperando: false }, { ...pronta, fase: "ociosa", versaoAtual: "1.0.4", versaoNova: null, atualizadoDe: "1.0.3" });
    await t.w.carregar();
    expect(t.avisos).toEqual(["1.0.4"]);
    expect(t.vistos()).toBe(1);
    t.empurrar({ ...pronta, fase: "ociosa", versaoAtual: "1.0.4", versaoNova: null });
    expect(t.avisos).toHaveLength(1);
  });

  it("sem a ponte (navegador, Quick Chat), nada aparece e nada é pedido", async () => {
    const w = criarAtualizacaoNaWeb({ ponte: () => undefined, aoMudar: () => undefined, avisarAtualizado: () => undefined });
    await w.carregar();
    await w.reiniciar("agora");
    expect(w.tela()).toBeNull();
    expect(cartaoAtualizacao(w.tela(), false)).toBe("");
  });

  it("o cartão só aparece com a versão pronta; é um botão de clique comum (sem segurar)", () => {
    expect(cartaoAtualizacao(tela({ estado: { fase: "baixando", versaoNova: null } }), false)).toBe("");
    const html = cartaoAtualizacao(tela(), false);
    expect(html).toContain('data-act="atualizar-app"');
    expect(html).not.toContain("data-segurar");
    expect(html).toContain("1.0.4 pronta · clique para reiniciar");
    // A tinta leva o mesmo tempo no CSS e no relógio que pede o reinício.
    expect(readFileSync("web/atualizacao-app.css", "utf8")).toContain(`--ms-encher: ${MS_ENCHER_ATUALIZAR}ms`);
    // O miolo claro (por cima da tinta) não é lido duas vezes.
    expect(html).toMatch(/class="atz-claro" aria-hidden="true"/);
  });

  it("o cartão entra animado uma vez: a barra regravada depois não repete a entrada", async () => {
    const t = montar({ ok: true, esperando: false });
    await t.w.carregar();
    expect(t.w.tela()?.prontaDesde).toBe(1_000);
    expect(cartaoAtualizacao(t.w.tela(), false, 1_100)).toContain('class="atz atz-entra" style="--atz-entrada:-100ms"');
    expect(cartaoAtualizacao(t.w.tela(), false, 1_000 + MS_ENTRAR_ATUALIZAR + 500)).toContain('<div class="atz"><button');
    // Um estado novo com a versão ainda pronta não reinicia a entrada.
    t.empurrar({ ...pronta, sozinho: false });
    expect(t.w.tela()?.prontaDesde).toBe(1_000);
    expect(readFileSync("web/atualizacao-app.css", "utf8")).toContain(`--ms-entrar: ${MS_ENTRAR_ATUALIZAR}ms`);
  });

  it("o aviso \"nod atualizado\": o check, a versão e Novidades", () => {
    const html = htmlAvisoAtualizado("1.0.4");
    expect(html).toContain("nod atualizado para a <b>1.0.4</b>");
    expect(html).toContain(">Novidades</button>");
    expect(TEXTOS_ATZ.atualizado("1.0.4")).toBe("nod atualizado para a 1.0.4");
  });

  it("esperando o último bot: o cartão diz e oferece Cancelar", () => {
    const html = cartaoAtualizacao(tela({ estado: { esperandoLivre: true } }), false);
    expect(html).toContain(TEXTOS_ATZ.esperando);
    expect(html).toContain('data-act="atualizar-app-cancelar-espera"');
  });

  it("na barra recolhida, um redondo que enche igual; com pergunta, abre Sobre o nod", () => {
    expect(cartaoAtualizacao(tela(), true)).toContain('class="atz-redondo" data-act="atualizar-app"');
    expect(cartaoAtualizacao(tela({ pergunta: { tipo: "emLigacao" } }), true)).toContain('data-secao="sobre"');
  });

  it("Sobre o nod: a versão pronta com Reiniciar agora, o interruptor e o Procurar agora", () => {
    const html = renderSobre(tela(), true, Date.now());
    expect(html).toContain("A versão 1.0.4 está pronta");
    expect(html).toContain('data-act="atualizar-app-agora"');
    expect(html).toContain('data-act="atualizar-app-sozinho"');
    expect(html).toMatch(/data-act="atualizar-app-procurar" disabled/);
    expect(renderSobre(tela({ estado: { fase: "ociosa", versaoNova: null } }), true, Date.now())).toContain("O nod está atualizado");
    // Desligada (fora de Aplicativos): o motivo, sem o grupo de atualizações.
    const desligada = renderSobre(tela({ estado: { fase: "desligada", versaoNova: null, motivo: "Mova o nod para Aplicativos para receber atualizações." } }), true, Date.now());
    expect(desligada).toContain("Mova o nod para Aplicativos");
    expect(desligada).not.toContain("atualizar-app-sozinho");
  });

  it("Sobre o nod no Windows: sem o interruptor de reiniciar sozinho, que o sistema não tem", () => {
    const html = renderSobre(tela({ estado: { sozinho: null } }), true, Date.now());
    expect(html).not.toContain("atualizar-app-sozinho");
    expect(html).toContain("atualizar-app-procurar");
    expect(html).toContain("neste computador");
  });

  it("Sobre o nod no navegador explica que a web já vem atualizada", () => {
    expect(renderSobre(null, false, 0)).toContain("No navegador");
  });

  it("a seção entra nas Configurações, na busca dos ajustes e no CSS da página", () => {
    expect(SECOES_ESPACO.map((s) => s.id)).toContain("sobre");
    expect(NOME_DA_SECAO.sobre).toBe("Sobre o nod");
    expect(AJUSTES.filter((a) => a.secao === "sobre").map((a) => a.id)).toEqual(["sobre", "reiniciar-sozinho", "procurar-atualizacoes"]);
    expect(readFileSync("web/index.html", "utf8")).toContain('href="/atualizacao-app.css"');
  });
});

describe("ADR-188: a simulação no navegador (só na 5280)", () => {
  it("só liga em loopback, com uma versão válida", async () => {
    const { versaoSimuladaNaWeb } = await import("../../../web/lib/atualizacao-simulada-web.ts");
    expect(versaoSimuladaNaWeb({ hostname: "127.0.0.1", search: "?simular-atualizacao=1.0.4" })).toBe("1.0.4");
    expect(versaoSimuladaNaWeb({ hostname: "app.nodbot.ai", search: "?simular-atualizacao=1.0.4" })).toBeNull();
    expect(versaoSimuladaNaWeb({ hostname: "localhost", search: "?simular-atualizacao=lixo" })).toBeNull();
    expect(versaoSimuladaNaWeb({ hostname: "localhost", search: "" })).toBeNull();
  });

  it("acha a versão, pergunta uma vez com simular-ocupado e \"reinicia\" recarregando", async () => {
    const { criarPonteSimuladaNaWeb } = await import("../../../web/lib/atualizacao-simulada-web.ts");
    const timers: { f: () => void; ms: number }[] = [];
    let recarregou = 0;
    const p = criarPonteSimuladaNaWeb({ versao: "1.0.4", ocupado: true, recarregar: () => { recarregou++; }, agendar: (f, ms) => timers.push({ f, ms }), agora: () => 0 });
    while (timers.length) timers.shift()!.f();
    expect((await p.estado()).fase).toBe("pronta");
    expect(await p.reiniciar({ quando: "agora" })).toEqual({ ok: false, motivo: "ocupado", turnos: 1, telas: 0 });
    expect(await p.reiniciar({ quando: "forcar" })).toEqual({ ok: true, esperando: false });
    while (timers.length) timers.shift()!.f();
    expect(recarregou).toBe(1);
  });
});
