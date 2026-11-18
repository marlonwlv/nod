import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtualizacaoNaTela, PedidoReinicio, RespostaReinicio } from "../../../src/contracts/desktop-atualizacao.ts";
import { criarAtualizacaoNaWeb, type PonteAtz, type TelaAtualizacao } from "../../../web/lib/atualizacao-app.ts";
import { cartaoAtualizacao, MS_SEGURAR_ATUALIZAR, renderSobre, TEXTOS_ATZ } from "../../../web/telas/atualizacao-app.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { AJUSTES, NOME_DA_SECAO } from "../../../web/lib/ajustes.ts";

const pronta: AtualizacaoNaTela = { fase: "pronta", versaoAtual: "1.0.3", versaoNova: "1.0.4", motivo: null, procuradaEm: null, esperandoLivre: false, reiniciando: false, sozinho: true, atualizadoDe: null };
const tela = (o: Partial<TelaAtualizacao> & { estado?: Partial<AtualizacaoNaTela> } = {}): TelaAtualizacao => ({ pergunta: null, pedindo: false, ...o, estado: { ...pronta, ...o.estado } });

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
  const w = criarAtualizacaoNaWeb({ ponte: () => ponte, aoMudar: () => undefined, avisarAtualizado: (v) => avisos.push(v) });
  return { w, pedidos, avisos, vistos: () => vistos, empurrar: (e: AtualizacaoNaTela) => ouvinte?.(e) };
}

describe("ADR-188: a atualização do app na janela web", () => {
  it("segurar com nada rodando: o cartão fica em Reiniciando…", async () => {
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

  it("o cartão só aparece com a versão pronta, e segura por 800 ms", () => {
    expect(cartaoAtualizacao(tela({ estado: { fase: "baixando", versaoNova: null } }), false)).toBe("");
    const html = cartaoAtualizacao(tela(), false);
    expect(MS_SEGURAR_ATUALIZAR).toBe(800);
    expect(html).toContain('data-segurar="reiniciar-app"');
    expect(html).toContain('data-segurar-ms="800"');
    expect(html).toContain('data-act="atualizar-app-dica"');
    expect(html).toContain("1.0.4 pronta · segure para reiniciar");
    // O miolo claro (por cima da tinta) não é lido duas vezes.
    expect(html).toMatch(/class="atz-claro" aria-hidden="true"/);
  });

  it("esperando o último bot: o cartão diz e oferece Cancelar", () => {
    const html = cartaoAtualizacao(tela({ estado: { esperandoLivre: true } }), false);
    expect(html).toContain(TEXTOS_ATZ.esperando);
    expect(html).toContain('data-act="atualizar-app-cancelar-espera"');
  });

  it("na barra recolhida, um redondo que segura igual; com pergunta, abre Sobre o nod", () => {
    expect(cartaoAtualizacao(tela(), true)).toContain('class="atz-redondo" data-act="atualizar-app-dica" data-segurar="reiniciar-app"');
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
