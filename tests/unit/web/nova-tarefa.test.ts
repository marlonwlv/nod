import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DonoDto } from "../../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { blocoDoContexto, CARACTERES_DO_CONTEXTO, entradaDaTarefaDaPessoa, FALAS_DO_CONTEXTO } from "../../../src/domain/frente.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { SEM_PROGRESSO } from "../../../web/lib/pilula.ts";
import { rolaAoTopoAoNavegar } from "../../../web/lib/rolagem.ts";
import { telaAoFechar, telaDaTask } from "../../../web/lib/trabalhos.ts";
import { botAceitaTarefa, CHAVE_DICA_TAREFAS, dicaDasTarefasPendente, renderNovaTarefa, renderTopoNovaTarefa } from "../../../web/telas/nova-tarefa.ts";
import { htmlDaPilula, pilulaNaConversa, type NovaTarefaNaAba } from "../../../web/telas/pilula-do-bot.ts";

/**
 * ADR-187 §5 e §7 (lote B, passo 2, 2026-11-18): a nova tarefa da pessoa. A aba presa ao campo nunca some (Paper 4q,
 * opção B: "+ Nova tarefa ⌘N" sem tarefas e o "+" ao lado da que conta), a dica uma vez por pessoa (opção C), a tela da
 * tarefa nova limpa (Paper 3b) com o "Levar o contexto da conversa" (3e) e a entrada que o servidor monta.
 */

const C = "c-ada";
const AGORA = new Date(2026, 10, 18, 15, 10).getTime();
const dono: DonoDto = { estado: { agenteId: "ada", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null }, esperas: [], fila: [] };
const tarefa = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "t1", agenteId: "ada", conversaId: C, titulo: "Landing das escolas", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60_000, iniciadoEm: AGORA - 60_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null,
  turnoVivoId: null, esperandoComputadorDe: null, forma: "frente", loteId: "l1", lote: { id: "l1", abertoEm: AGORA - 60_000, frentes: 1, abertas: 1 }, ...extra,
});

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "ada", nome: "Ada", conversaId: C, cor: "c-rouge", forma: "shape-square", ownerId: "p", titulo: "", descricao: "", confirmado: true },
      { id: "nod", nome: "Nod", conversaId: "c-nod", cor: "c-black", forma: "shape-pebble", ownerId: "p", titulo: "", descricao: "", confirmado: true, papel: "nod" },
      { id: "outra", nome: "Bia", conversaId: "c-bia", cor: "c-blue", forma: "shape-square", ownerId: "outra-pessoa", titulo: "", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null, donos: [dono] },
    tela: { tipo: "conversa", conversaId: C, agenteId: "ada" },
    ...extra,
  };
}

const NOVA: NovaTarefaNaAba = { atalho: "⌘N", aria: "Meta+N" };

describe("a aba presa ao campo sem tarefas (Paper 4q, opção B)", () => {
  it("o bot sem tarefas mostra \"+ Nova tarefa ⌘N\" (a tecla do lugar), que abre a tarefa nova", () => {
    const p = pilulaNaConversa(estadoCom([]), "ada", SEM_PROGRESSO, NOVA);
    if (p.tipo !== "vazia") throw new Error(`esperava a aba vazia, veio ${p.tipo}`);
    expect(p.html).toContain('<button type="button" class="pf-botao pf-nova" data-act="nova-tarefa" aria-keyshortcuts="Meta+N"><span class="pf-nova-texto">+ Nova tarefa</span><kbd class="pf-nova-atalho" aria-hidden="true">⌘N</kbd></button>');
    expect(p.html).not.toContain("pf-dica");
    const fora = pilulaNaConversa(estadoCom([]), "ada", SEM_PROGRESSO, { atalho: "Alt+N", aria: "Alt+N" });
    expect(fora.tipo === "vazia" && fora.html).toContain(">Alt+N</kbd>");
  });

  it("sem a guarda de quem chama (bot de outra pessoa, sem IA, boas-vindas), nada aparece, como antes", () => {
    expect(pilulaNaConversa(estadoCom([]), "ada", SEM_PROGRESSO).tipo).toBe("nada");
  });

  it("com tarefas, a aba conta e ganha o \"+\" à direita (no esqueleto, antes do selo da máquina)", () => {
    const p = pilulaNaConversa(estadoCom([tarefa()]), "ada", SEM_PROGRESSO, NOVA);
    if (p.tipo !== "pilula") throw new Error(`esperava a pílula, veio ${p.tipo}`);
    expect(p.partes.chave).toBe("ada:mais");
    const html = htmlDaPilula(p.partes, { aberta: false, escondida: false });
    expect(html).toMatch(/<\/button><button type="button" class="pf-mais" data-act="nova-tarefa" aria-label="Nova tarefa" title="Nova tarefa \(⌘N\)" aria-keyshortcuts="Meta\+N">.*<\/button><span class="pf-memoria-lugar">/);
    // Sem a guarda, a aba de antes, sem o "+" (e a chave de antes: o esqueleto é refeito quando o "+" entra ou sai).
    const sem = pilulaNaConversa(estadoCom([tarefa()]), "ada", SEM_PROGRESSO);
    expect(sem.tipo === "pilula" && sem.partes.chave).toBe("ada");
    expect(sem.tipo === "pilula" && htmlDaPilula(sem.partes, { aberta: false, escondida: false })).not.toContain("pf-mais");
  });
});

describe("a dica das tarefas (Paper 4q, opção C, uma vez por pessoa)", () => {
  it("acima da aba vazia, com o nome do bot e a tecla do lugar, \"Abrir uma tarefa\" e \"Entendi\"", () => {
    const p = pilulaNaConversa(estadoCom([]), "ada", SEM_PROGRESSO, { ...NOVA, dica: { nome: "Ada" } });
    const html = p.tipo === "vazia" ? p.html : "";
    expect(html).toContain('<h3 id="pf-dica-titulo">Trabalhos longos viram tarefas</h3>');
    expect(html).toContain("<p>Quando o pedido demora, Ada abre uma tarefa e o chat fica livre. Você também pode abrir uma: ⌘N.</p>");
    expect(html).toContain('<button type="button" class="pf-dica-abrir" data-act="nova-tarefa">Abrir uma tarefa</button><button type="button" class="pf-dica-entendi" data-act="dica-tarefas-entendi">Entendi</button>');
    expect(html.indexOf("pf-dica")).toBeLessThan(html.indexOf("pf-fechada"));
  });

  it("só depois de as preferências chegarem, e nunca de novo depois de vista; a sessão de outra pessoa esquece", () => {
    const e = estadoCom([]);
    expect(dicaDasTarefasPendente(e)).toBe(false);
    const lidas = reduzir(e, { tipo: "avisos-fechados", chaves: ["modo:total"] });
    expect(dicaDasTarefasPendente(lidas)).toBe(true);
    const vista = reduzir(lidas, { tipo: "avisos-fechados", chaves: [CHAVE_DICA_TAREFAS] });
    expect(vista.avisosFechados).toEqual(["modo:total", CHAVE_DICA_TAREFAS]);
    expect(dicaDasTarefasPendente(vista)).toBe(false);
    expect(reduzir(vista, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).avisosFechados).toBeNull();
    expect(reduzir(vista, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } }).avisosFechados).toEqual(vista.avisosFechados);
  });
});

describe("a tarefa nova (Paper 3b e 3e)", () => {
  it("só no bot da pessoa, confirmado, que não é o Nod", () => {
    const e = estadoCom([]);
    expect(botAceitaTarefa(e, "ada")).toBe(true);
    expect(botAceitaTarefa(e, "nod")).toBe(false);
    expect(botAceitaTarefa(e, "outra")).toBe(false);
    expect(botAceitaTarefa(e, null)).toBe(false);
    expect(botAceitaTarefa({ ...e, sessao: null }, "ada")).toBe(false);
  });

  it("o topo \"← Conversa · Ada · Nova tarefa\" e o miolo limpo com o chip do contexto, desligado e ligado", () => {
    const e = estadoCom([]);
    const topo = renderTopoNovaTarefa(e, "ada");
    expect(topo).toContain('data-act="fechar-trabalho"');
    expect(topo).toContain('<span class="tk-titulo nt-titulo">Ada · <b>Nova tarefa</b></span>');
    const limpa = renderNovaTarefa(e, "ada", false);
    expect(limpa).toContain('<h2 id="nt-pergunta">O que Ada vai fazer nesta tarefa?</h2>');
    expect(limpa).toContain("Começa limpa, sem o histórico da conversa.");
    expect(limpa).toContain('data-act="nova-tarefa-contexto" aria-pressed="false"');
    const levando = renderNovaTarefa(e, "ada", true);
    expect(levando).toContain('aria-pressed="true"');
    expect(levando).toContain("A tarefa leva as últimas falas da conversa com Ada");
  });

  it("Fechar e Esc voltam para a conversa; a primeira mensagem vira a tela da tarefa com o mesmo voltar; abre no topo", () => {
    const conversa = { tipo: "conversa", conversaId: C, agenteId: "ada" } as const;
    const nova = { tipo: "nova-tarefa", agenteId: "ada", voltar: conversa } as const;
    expect(telaAoFechar(nova)).toEqual(conversa);
    expect(telaDaTask(nova, "t1")).toEqual({ tipo: "trabalho", id: "t1", voltar: conversa });
    expect(rolaAoTopoAoNavegar("nova-tarefa")).toBe(true);
  });

  it("no main: ⌘N, o \"+\" e a dica abrem a tarefa nova; a primeira mensagem a cria e marca a dica como vista", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain('if (a.tipo === "nova-tarefa") { abrirNovaTarefa(); return true; }');
    expect(main).toContain('"nova-tarefa": () => abrirNovaTarefa(),');
    expect(main).toContain('if (tela.tipo === "nova-tarefa") return criarTarefaNova(tela);');
    expect(main).toContain("id = (await a.abrirTarefa(tela.agenteId, texto, levar)).trabalho.id;");
    const criar = main.slice(main.indexOf("async function criarTarefaNova"), main.indexOf("async function criarTarefaNova") + 1400);
    expect(criar).toContain("marcarDicaDasTarefasVista();");
  });
});

describe("a entrada da tarefa da pessoa (src/domain/frente.ts)", () => {
  it("a moldura, o pedido e a linha de empurrar; com o contexto, as falas no meio", () => {
    const limpa = entradaDaTarefaDaPessoa({ titulo: "Landing", pedido: "  Escreva o texto da landing.  " });
    expect(limpa.startsWith('[nod] Tarefa "Landing", aberta pela pessoa direto na tela de tarefas')).toBe(true);
    expect(limpa).toContain("\nEscreva o texto da landing.\n\n");
    expect(limpa.endsWith("Se mexer num repositório, não empurre: devolva o branch e o SHA.")).toBe(true);
    const com = entradaDaTarefaDaPessoa({ titulo: "Landing", pedido: "Escreva.", contexto: [{ autor: "pessoa", texto: "tom leve" }, { autor: "Ada", texto: "Combinado." }] });
    expect(com).toContain("trouxe para esta tarefa as últimas falas da conversa com você (contexto, não pedido novo):\n- pessoa: tom leve\n- Ada: Combinado.");
  });

  it("o contexto tem teto: as falas mais novas primeiro, cada uma cortada, nunca acima do total", () => {
    expect(blocoDoContexto([])).toBe("");
    const muitas = Array.from({ length: 40 }, (_, i) => ({ autor: "pessoa", texto: `fala ${i} ${"x".repeat(2000)}` }));
    const bloco = blocoDoContexto(muitas);
    const linhas = bloco.split("\n").slice(1);
    expect(linhas.length).toBeLessThanOrEqual(FALAS_DO_CONTEXTO);
    expect(linhas.join("\n").length).toBeLessThanOrEqual(CARACTERES_DO_CONTEXTO + FALAS_DO_CONTEXTO);
    expect(linhas.at(-1)).toContain("fala 39");
    expect(bloco).not.toContain("fala 0 ");
  });
});
