import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aguardandoPorAgente, contadorDosTrabalhos, motivoDaFrase, MOTIVO_MAX, rotuloDosTrabalhos, textoAguardando } from "../../../web/lib/aguardando.ts";
import { AJUSTES, ajusteDoHash, buscarAjustes, caminhoDoAjuste, linkDoAjuste } from "../../../web/lib/ajustes.ts";
import { aplicarBalaoCor, CHAVE_BALAO, lerBalaoCor } from "../../../web/lib/balao.ts";
import { ACOES_DA_PALETA, filtrarPaleta, itensDaPaleta, moverNaPaleta } from "../../../web/lib/paleta.ts";
import { CHAVE_SONS, criarVigiaDeSons, gravarSons, INTERVALO_MIN_MS, lerSons, notasDoSom, podeTocar, tocarNotas, type ContextoDeAudio } from "../../../web/lib/sons.ts";
import { linhaConfig } from "../../../web/lib/linha-config.ts";
import { renderBuscaAjustes } from "../../../web/telas/espaco.ts";
import { listaDaPaleta } from "../../../web/telas/paleta.ts";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { NaoLidosDto } from "../../../src/contracts/nao-lidos.ts";

const ler = (f: string): string => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");
const pedido = (id: string, agenteId: string, frase: string) => ({ decisao: { id, agenteId, conversaId: `c-${agenteId}`, frase } });
const armazem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("ADR-167: tokens", () => {
  const tokens = ler("tokens.css");
  it("uma base por tema, a fonte do sistema e nenhuma Geist", () => {
    expect(tokens).toMatch(/--base: #1c1c1c;/);
    expect(tokens.match(/--base: #f5f5f5;/g)).toHaveLength(2);
    expect(tokens).toMatch(/--font-sans: -apple-system, BlinkMacSystemFont/);
    expect(tokens).not.toMatch(/@font-face|"Geist/);
    expect(ler("index.html")).not.toMatch(/geist/i);
  });
  it("a escala fechada de 7 tamanhos com corpo 14, raios, 5 sombras e movimento nomeado", () => {
    for (const [nome, px] of [["titulo-1", 26], ["titulo-2", 22], ["titulo-3", 17], ["corpo", 14], ["corpo-2", 13], ["rotulo", 12], ["legenda", 11]] as const) expect(tokens).toContain(`--fs-${nome}: ${px}px;`);
    for (const s of ["controle", "inline", "popover", "modal", "janela"]) expect(tokens.match(new RegExp(`--sombra-${s}:`, "g"))).toHaveLength(3);
    for (const d of ["instantaneo", "rapido", "normal", "lento", "mais-lento", "gaveta"]) expect(tokens).toMatch(new RegExp(`--dur-${d}: \\d+ms;`));
    expect(tokens).toContain("--raio-full: 9999px;");
    expect(tokens).toContain("--curva: cubic-bezier(.22, 1, .36, 1);");
  });
  it("no escuro não há sombra: todo nível é a borda clara sutil", () => {
    const escuro = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
    for (const s of ["controle", "inline", "popover", "modal", "janela"]) expect(escuro).toMatch(new RegExp(`--sombra-${s}: 0 0 0 \\.5px rgba\\(255, 255, 255, \\.1\\d\\);`));
    expect(escuro).toMatch(/--shadow-pop: 0 0 0 \.5px rgba\(255, 255, 255, \.12\);/);
  });
  it("movimento reduzido zera as durações nomeadas", () => {
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{ --dur-instantaneo: \.01ms;/);
  });
});

describe("ADR-167: Aguardando você (telas 16/16b)", () => {
  it("um por bot, o primeiro pedido da fila decide o motivo e o alvo; conta o resto", () => {
    const m = aguardandoPorAgente([pedido("d1", "a", "Quer enviar 2 e-mails\n  para a Lipe"), pedido("d2", "b", "Rebaseio?"), pedido("d3", "a", "Outra")]);
    expect(m.get("a")).toEqual({ agenteId: "a", conversaId: "c-a", decisaoId: "d1", motivo: "Quer enviar 2 e-mails para a Lipe", total: 2 });
    expect(m.get("b")?.total).toBe(1);
  });
  it("a prévia em laranja diz o motivo; sem frase, só o rótulo", () => {
    expect(textoAguardando({ motivo: "enviar 2 e-mails" })).toBe("Aguardando você: enviar 2 e-mails");
    expect(textoAguardando({ motivo: "Quer enviar 2 e-mails para a Lipe?" })).toBe("Aguardando você: enviar 2 e-mails para a Lipe");
    expect(textoAguardando({ motivo: "" })).toBe("Aguardando você");
    expect(motivoDaFrase("x".repeat(500))).toHaveLength(MOTIVO_MAX);
  });
  it("a linha Trabalhos: N aguardando ganha do número; sem nada, vazia", () => {
    expect(contadorDosTrabalhos({ abertos: 4, aguardando: 2 })).toEqual({ texto: "2 aguardando", tom: "aguardando" });
    expect(contadorDosTrabalhos({ abertos: 4, aguardando: 0 })).toEqual({ texto: "4", tom: "neutro" });
    expect(contadorDosTrabalhos({ abertos: 0, aguardando: 0 })).toBeNull();
    expect(rotuloDosTrabalhos({ abertos: 1, aguardando: 2 })).toBe("Trabalhos, 1 aberto, 2 aguardando você");
  });
  it("a barra: sem sino nem ícone de Trabalhos no topo do computador; a linha leva ao cartão pendente", () => {
    const main = ler("main.ts");
    const topo = main.slice(main.indexOf('const html = `<div class="search-wrap">'), main.indexOf('<label class="search"'));
    expect(topo).not.toContain("renderChamada");
    expect(topo).not.toContain("renderIconeTrabalhos");
    expect(main).toContain('if (el.dataset.pendente) return verPerguntaNaConversa(el.dataset.conversa ?? "", el.dataset.agente ?? "", el.dataset.pendente);');
    const ds = ler("ds.css");
    expect(ds).toMatch(/nod-mascote\[data-aviso="decisao"\], nod-mascote\[data-aviso="pergunta"\] \{ --nod-aviso: var\(--aguardando-ponto\); \}/);
    expect(ds).toMatch(/nod-mascote\[data-aviso="nao-lido"\] \{ --nod-aviso: var\(--signal\); \}/);
  });
});

describe("ADR-167: catálogo de ajustes, busca e link", () => {
  it("todo ajuste tem título e uma frase que começa por verbo no imperativo (maiúscula) e ids únicos", () => {
    expect(new Set(AJUSTES.map((a) => a.id)).size).toBe(AJUSTES.length);
    for (const a of AJUSTES) {
      expect(a.titulo.length).toBeGreaterThan(0);
      expect(a.frase).toMatch(/^[A-ZÁÉÍÓÚ]/);
      expect(a.id).toMatch(/^[a-z0-9-]{1,40}$/);
    }
  });
  it("busca sem acento e por palavra-chave; o título que começa pelo termo vem antes", () => {
    expect(buscarAjustes("escuro")[0]?.id).toBe("tema");
    expect(buscarAjustes("SOM").map((a) => a.id).slice(0, 2)).toEqual(["som-mensagem", "som-aprovacao"]);
    expect(buscarAjustes("aprovacao").map((a) => a.id)).toContain("som-aprovacao");
    expect(buscarAjustes("")).toEqual([]);
    expect(caminhoDoAjuste(AJUSTES.find((a) => a.id === "tema")!)).toEqual(["Configurações", "Geral", "Aparência"]);
  });
  it("o link tem o id e volta ao ajuste; hash desconhecido ou estranho não abre nada", () => {
    expect(linkDoAjuste("http://127.0.0.1:5274/?x=1#velho", "tema")).toBe("http://127.0.0.1:5274/?x=1#ajuste=tema");
    expect(ajusteDoHash("#ajuste=tema")?.id).toBe("tema");
    expect(ajusteDoHash("#ajuste=nao-existe")).toBeNull();
    expect(ajusteDoHash("#ajuste=<script>")).toBeNull();
  });
  it("a linha com `ajuste` ganha o id e o copiar link; a busca lista título, frase e caminho", () => {
    const html = linhaConfig({ titulo: "Tema", ajuste: "tema", detalhe: "Escolha", controle: { tipo: "switch", ligado: false, acao: "x" } });
    expect(html).toContain('id="ajuste-tema"');
    expect(html).toContain('data-act="copiar-link-ajuste" data-ajuste="tema"');
    const achados = renderBuscaAjustes("tema");
    expect(achados).toContain('data-act="ir-ao-ajuste" data-ajuste="tema"');
    expect(achados).toContain("Geral › Aparência");
    expect(renderBuscaAjustes("zzz")).toContain("Nenhum ajuste com “zzz”");
  });
  it("as ações novas têm handler no main.ts", () => {
    const main = ler("main.ts");
    for (const a of ["ir-ao-ajuste", "copiar-link-ajuste", "alternar-balao-cor", "alternar-som-app"]) expect(main).toMatch(new RegExp(`^\\s+"${a}":`, "m"));
  });
});

describe("ADR-167: paleta ⌘K (tela 08)", () => {
  const itens = itensDaPaleta({
    mod: "⌘",
    bots: [{ id: "ada", nome: "Ada", titulo: "PM", conversaId: "c1", previa: "Feito. NOD-512" }, { id: "dante", nome: "Dante", titulo: "Dev Sr", conversaId: "c2" }],
    trabalhos: [{ id: "t1", titulo: "Aprovação em lote de pedidos iguais", botNome: "Gil", quando: "ontem" }],
  });
  it("bots com ⌘1…, trabalhos como conversas, ajustes com o caminho e ações com o atalho", () => {
    expect(itens[0]).toMatchObject({ grupo: "Bots", titulo: "Ada · PM", sub: "Feito. NOD-512", teclas: ["⌘", "1"] });
    expect(itens.find((i) => i.chave === "trab:t1")).toMatchObject({ grupo: "Conversas", sub: "Gil · ontem" });
    expect(itens.find((i) => i.chave === "ajuste:tema")).toMatchObject({ grupo: "Ajustes", sub: "Configurações › Geral › Aparência" });
    expect(itens.find((i) => i.chave === "acao:novo-bot")).toMatchObject({ grupo: "Ações", teclas: ["⌘", "N"] });
    expect(itens.filter((i) => i.grupo === "Ações")).toHaveLength(ACOES_DA_PALETA.length);
  });
  it("frente de comportamento: as salas (conversas em grupo) entram em Conversas e abrem a sala", () => {
    const comSala = itensDaPaleta({ mod: "⌘", bots: [], trabalhos: [], salas: [{ id: "s1", nome: "Lançamento de março", conversaId: "cs1", membros: "Ada, Gil" }] });
    expect(comSala.find((i) => i.chave === "sala:s1")).toMatchObject({ grupo: "Conversas", titulo: "Lançamento de março", sub: "Ada, Gil", destino: { tipo: "sala", salaId: "s1", conversaId: "cs1" } });
    expect(filtrarPaleta(comSala, "lancamento").map((i) => i.chave)).toContain("sala:s1");
  });
  it("vazia mostra os primeiros de cada grupo, sem os ajustes; buscando, acha por palavra e sem acento", () => {
    const vazia = filtrarPaleta(itens, "");
    expect(vazia.some((i) => i.grupo === "Ajustes")).toBe(false);
    expect(vazia[0]?.grupo).toBe("Bots");
    expect(filtrarPaleta(itens, "escuro").map((i) => i.chave)).toEqual(["ajuste:tema", "acao:tema-escuro"]);
    expect(filtrarPaleta(itens, "aprovacao lote")[0]?.chave).toBe("trab:t1");
    expect(filtrarPaleta(itens, "da")[0]?.chave).toBe("bot:dante");
    expect(filtrarPaleta(itens, "xyzw")).toEqual([]);
  });
  it("setas dão a volta; outra tecla não é da lista", () => {
    expect(moverNaPaleta(0, 3, "ArrowUp")).toBe(2);
    expect(moverNaPaleta(2, 3, "ArrowDown")).toBe(0);
    expect(moverNaPaleta(1, 3, "End")).toBe(2);
    expect(moverNaPaleta(1, 0, "ArrowDown")).toBeNull();
    expect(moverNaPaleta(1, 3, "a")).toBeNull();
  });
  it("o desenho: opção selecionada, grupo com nome e teclas; vazio diz o termo", () => {
    const html = listaDaPaleta(filtrarPaleta(itens, ""), 0, () => "<i></i>", "");
    expect(html).toContain('id="paleta-i-0" data-indice="0" aria-selected="true"');
    expect(html).toContain('role="group" aria-label="Bots"');
    expect(html).toContain('<kbd class="ds-kbd">⌘</kbd><kbd class="ds-kbd">1</kbd>');
    expect(listaDaPaleta([], 0, () => "", "xyz")).toContain("Nada encontrado para “xyz”");
  });
});

describe("ADR-167: sons opcionais", () => {
  it("desligados por padrão; a escolha é deste computador", () => {
    const a = armazem();
    expect(lerSons(a)).toEqual({ mensagem: false, aprovacao: false });
    gravarSons({ mensagem: true, aprovacao: false }, a);
    expect(a.m.get(CHAVE_SONS)).toBe('{"mensagem":true,"aprovacao":false}');
    expect(lerSons(a)).toEqual({ mensagem: true, aprovacao: false });
    a.setItem(CHAVE_SONS, "lixo{");
    expect(lerSons(a)).toEqual({ mensagem: false, aprovacao: false });
  });
  it("notas curtas e baixas; tocar agenda cada nota no Web Audio", () => {
    for (const t of ["mensagem", "aprovacao"] as const) for (const n of notasDoSom(t)) { expect(n.dur).toBeLessThanOrEqual(0.3); expect(n.ganho).toBeLessThanOrEqual(0.12); }
    const inicios: number[] = [];
    const ctx: ContextoDeAudio = {
      currentTime: 10,
      destination: {},
      createOscillator: () => ({ type: "", frequency: { value: 0 }, connect: () => undefined, start: (t) => void inicios.push(t), stop: () => undefined }),
      createGain: () => ({ gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined }),
    };
    tocarNotas(ctx, notasDoSom("aprovacao"));
    expect(inicios).toEqual([10, 10.12]);
  });
  it("o vigia: a 1ª leitura só fixa a base; o novo toca se ligado, um por intervalo", () => {
    let agora = 0;
    let escolha = { mensagem: true, aprovacao: true };
    const tocados: string[] = [];
    const v = criarVigiaDeSons({ escolha: () => escolha, tocar: (t) => void tocados.push(t), agora: () => agora });
    const item = (id: string) => ({ decisao: { id, agenteId: "a", conversaId: "c", tipo: "aprovacao", fioId: null }, estadoColuna: "aberto", gemeas: [] });
    const sv = (ids: string[]) => ({ itens: ids.map(item) }) as unknown as SuaVezDto;
    v.suaVez(sv(["d1"]));
    expect(tocados).toEqual([]);
    agora = 10_000;
    v.suaVez(sv(["d1", "d2"]));
    expect(tocados).toEqual(["aprovacao"]);
    agora += INTERVALO_MIN_MS - 1;
    v.suaVez(sv(["d1", "d2", "d3"]));
    expect(tocados).toEqual(["aprovacao"]);
    escolha = { mensagem: true, aprovacao: false };
    agora += 10_000;
    v.suaVez(sv(["d1", "d2", "d3", "d4"]));
    expect(tocados).toEqual(["aprovacao"]);
    v.naoLidos({ conversas: [] } as NaoLidosDto);
    expect(podeTocar(0, INTERVALO_MIN_MS)).toBe(true);
  });
});

describe("ADR-167: balão da pessoa preto por padrão", () => {
  it("a cor do bot é opção guardada neste computador e marcada no <html>", () => {
    const a = armazem();
    const raiz = { dataset: {} as Record<string, string | undefined> };
    expect(lerBalaoCor(a)).toBe(false);
    aplicarBalaoCor(true, raiz, a);
    expect(raiz.dataset.balao).toBe("cor");
    expect(a.m.get(CHAVE_BALAO)).toBe("cor");
    aplicarBalaoCor(false, raiz, a);
    expect(raiz.dataset.balao).toBeUndefined();
    expect(a.m.has(CHAVE_BALAO)).toBe(false);
  });
  it("o index.html aplica antes do primeiro quadro com a mesma chave; o CSS troca a skin pela tinta da base", () => {
    expect(ler("index.html")).toContain(`localStorage.getItem("${CHAVE_BALAO}") === "cor"`);
    expect(ler("ds.css")).toMatch(/html:not\(\[data-balao="cor"\]\) \[class\*="balao-c-"\] \{ --balao-fundo: var\(--balao-pessoa\);/);
  });
});
