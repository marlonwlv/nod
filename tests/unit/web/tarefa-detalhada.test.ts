import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDetalheDto, TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto } from "../../../web/lib/atividade.ts";
import { htmlDoMenuDaAba } from "../../../web/telas/abas-de-tarefa.ts";
import { chipDaFalaNaFrente, htmlComposer } from "../../../web/telas/conversa.ts";
import { campoDaTarefa, conversaDaTarefa, falaDoPedido, htmlEntrega, htmlPassos, htmlSaidaDaParada, itensDaVolta, linhaDoFim, PASSOS_A_VISTA, perguntaAberta, type PassoDaTarefa } from "../../../web/telas/tarefa-detalhada.ts";
import { blocosAoVivoDaTask, blocosDoHistoricoDaTask } from "../../../web/telas/trabalhos.ts";

/**
 * ADR-187 §6 (lote B, passo 4, 2026-11-18; Paper 4k, 4l, 4m, 4n e 4s): dentro da tarefa — a conversa detalhada (o pedido,
 * as falas, os passos com o que fizeram, o que roda agora), o campo com tudo do campo da conversa e o Parar dela no lugar do
 * enviar, as saídas da parada e a entrega da feita à vista.
 */
const AGORA = new Date(2026, 10, 18, 15, 10).getTime();
const SEG = 1000;
const tarefa = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "t1", agenteId: "b1", conversaId: "c1", titulo: "PR #821", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60 * SEG, iniciadoEm: AGORA - 60 * SEG, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null,
  turnoVivoId: null, esperandoComputadorDe: null, forma: "frente", loteId: "l1", lote: null, ...extra,
});
const autoria = (tipo: "pessoa" | "agente") => ({ autor_tipo: tipo, autor_id: tipo === "pessoa" ? "p" : "b1", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 });
const fala = (id: string, em: number, texto: string, de: "pessoa" | "agente" = "agente", extra: Partial<Mensagem> = {}): Mensagem =>
  ({ tenantId: "t", id, conversaId: "c1", turnoId: de === "agente" ? "tv1" : null, autoria: autoria(de), kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: em, trabalhoId: "t1", fimDoTurno: false, ...extra }) as never;
const passo = (seq: number, em: number, rotulo: string, extra: Partial<PassoDaTarefa> = {}): PassoDaTarefa =>
  ({ seq, em, tipo: "ferramenta", classe: "comando", ferramenta: "Bash", rotulo, resumo: null, acaoId: `a${seq}`, falhou: false, turnoId: "tv1", ...extra });

function estadoCom(t: TrabalhoDto, detalhe: Omit<TrabalhoDetalheDto, "trabalho">): Estado {
  const e: Estado = {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "b1", nome: "Ada", conversaId: "c1", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos: [t], pressao: null, memoriaTotalMb: null, donos: [] },
    tela: { tipo: "trabalho", id: t.id, voltar: { tipo: "inicio" } },
  };
  return reduzir(e, { tipo: "hidratar-trabalho", detalhe: { trabalho: t, ...detalhe }, agora: AGORA });
}
const html = (blocos: { html: string }[]): string => blocos.map((b) => b.html).join("");

describe("o campo da tarefa segue o estado dela (Paper 4k, 4l, 4m e 4n)", () => {
  it("rodando: recado no meio do trabalho, o Parar no lugar do enviar e o Esc para", () => {
    const c = campoDaTarefa(tarefa(), "Ada");
    expect(c).toMatchObject({ placeholder: "Mande um recado para a tarefa…", nota: "Ada está trabalhando · o recado entra no meio do trabalho", dica: "Esc para parar", parar: true, saida: false });
    expect(campoDaTarefa(tarefa({ estado: "na_fila" }), "Ada").parar).toBe(true);
  });

  it("precisa de você: a resposta livre, o anel azul e nada de Parar", () => {
    expect(campoDaTarefa(tarefa({ estado: "precisa_de_voce" }), "Ada")).toMatchObject({ placeholder: "Sua resposta para Ada…", precisa: true, parar: false });
  });

  it("parada: as duas saídas, e a nota diz que o recado guardado é o primeiro que ela lê (ADR-185)", () => {
    const c = campoDaTarefa(tarefa({ estado: "parado" }), "Ada");
    expect(c).toMatchObject({ placeholder: "Diga o que fazer agora…", saida: true, parar: false });
    expect(c.nota).toBe("Parada · nada rodando. Mandar uma mensagem continua a tarefa com Ada.");
    expect(campoDaTarefa(tarefa({ estado: "parado" }), "Ada", 1).nota).toBe("Parada · nada rodando. Seu recado ficou guardado: é a primeira coisa que Ada lê ao continuar.");
    const saida = htmlSaidaDaParada("t1");
    expect(saida).toContain('data-act="continuar-tarefa" data-id="t1">Continuar de onde parou<');
    expect(saida).toContain('data-act="encerrar-tarefa" data-id="t1">Encerrar a tarefa<');
  });

  it("feita: pedir mais reabre; sem tarefa carregada, o campo neutro", () => {
    expect(campoDaTarefa(tarefa({ estado: "terminado" }), "Ada")).toMatchObject({ placeholder: "Pedir mais alguma coisa nesta tarefa…", parar: false, saida: false });
    expect(campoDaTarefa(undefined, "Ada")).toMatchObject({ parar: false, nota: "" });
  });

  it("o campo é o da conversa (clipe, IA, ditado) com o Parar da tarefa, em pílula, no lugar do enviar", () => {
    const campo = htmlComposer("Mande um recado para a tarefa…", [], { seletor: true, anexos: "tudo", bot: "Ada", tarefa: "t1" });
    expect(campo).toContain('class="parar-envio parar-tarefa" data-act="parar-trabalho" data-id="t1" aria-label="Parar a tarefa"');
    expect(campo).toContain(">Parar</span></button>");
    expect(campo).toContain('data-act="anexar"');
    expect(campo).toContain('id="composer-arquivos"');
    expect(campo).toContain('id="composer-ia"');
    expect(campo).toContain('data-act="enviar"');
    expect(campo).not.toContain('data-act="parar-conversa"');
  });
});

describe("a conversa detalhada (Paper 4k)", () => {
  it("falas e passos na ordem; os passos seguidos num bloco, com o argumento; o texto já falado sai; o do turno vivo fica para o ao vivo", () => {
    const mensagens = [fala("m1", AGORA - 50 * SEG, "Vou começar pelo diff."), fala("m2", AGORA - 20 * SEG, "Unidade ok.")];
    const passos = [
      passo(1, AGORA - 49 * SEG, "Leu o diff", { resumo: "3 arquivos" }),
      passo(2, AGORA - 40 * SEG, "Rodou um comando", { resumo: "npm test" }),
      passo(3, AGORA - 30 * SEG, "Escreveu", { tipo: "texto", classe: "texto", ferramenta: null, resumo: "Unidade ok." }),
      passo(4, AGORA - 29 * SEG, "Escreveu", { tipo: "texto", classe: "texto", ferramenta: null, resumo: "Agora o rollback, antes da integração." }),
      passo(5, AGORA - 10 * SEG, "Rodou um comando", { resumo: "npm run test:integration", turnoId: "tv2" }),
    ];
    const itens = conversaDaTarefa(mensagens, passos, "tv2");
    expect(itens.map((i) => (i.tipo === "fala" ? i.m.id : i.tipo === "passos" ? i.passos.map((p) => p.seq).join(",") : `narracao:${i.texto}`))).toEqual(["m1", "1,2", "narracao:Agora o rollback, antes da integração.", "m2"]);
    const bloco = htmlPassos(passos.slice(0, 2));
    expect(bloco).toContain('<span class="tk-passo-rot">Rodou um comando</span><span class="tk-passo-res">npm test</span>');
  });

  it("acima do teto, os passos mais antigos recolhem em \"mais N passos\"", () => {
    const muitos = Array.from({ length: PASSOS_A_VISTA + 4 }, (_, i) => passo(i + 1, AGORA + i, `Passo ${i + 1}`));
    const bloco = htmlPassos(muitos);
    expect(bloco).toContain("<summary>mais 6 passos</summary>");
    expect(bloco.indexOf("Passo 10")).toBeGreaterThan(bloco.indexOf("</details>"));
    expect(htmlPassos([passo(1, AGORA, "Um", { falhou: true })])).toContain('<div class="tk-passo falhou">');
  });

  it("a volta de agora pelos frames: narração, as ferramentas dela com o argumento, sem a gravada nem a que roda", () => {
    let a = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Leio o diff."), "Leu um arquivo", undefined, "x1", "src/a.ts");
    a = comFerramenta(a, "Leu um arquivo", undefined, "x2", "src/b.ts");
    a = comFerramenta(comTexto(a, "Agora os testes."), "Rodou um comando", undefined, "x3", "npm test");
    expect(itensDaVolta(a, new Set(["x1"]))).toEqual([
      { tipo: "narracao", texto: "Leio o diff." },
      { tipo: "passos", passos: [{ rotulo: "Leu um arquivo", resumo: "src/b.ts", falhou: false }] },
      { tipo: "narracao", texto: "Agora os testes." },
    ]);
  });

  it("a tela: o pedido da pessoa num cartão (e não como balão), os passos entre as falas e o agora com o argumento", () => {
    const t = tarefa({ turnoVivoId: "tv2" });
    const mensagens = [fala("p1", t.criadoEm, "Revise o PR #821 e diga se está pronto.", "pessoa"), fala("m1", AGORA - 50 * SEG, "Vou começar pelo diff.")];
    const e = estadoCom(t, { mensagens, passos: [passo(1, AGORA - 45 * SEG, "Leu o diff", { resumo: "3 arquivos" })] });
    expect(falaDoPedido(t, mensagens)?.id).toBe("p1");
    const historico = html(blocosDoHistoricoDaTask(e, "t1"));
    expect(historico).toContain('<div class="tk-pedido-rot">Pedido · escrito por você</div>');
    expect(historico).toContain("Revise o PR #821 e diga se está pronto.");
    expect(historico).not.toContain('data-mensagem="p1"');
    expect(historico.indexOf("Vou começar pelo diff.")).toBeLessThan(historico.indexOf("Leu o diff"));
    const vivo = { ...e, atividades: { c1: { tv2: comFerramenta(ATIVIDADE_VAZIA, "Rodou um comando", { texto: "Rodando um comando", frentes: false }, "y1", "npm run test:integration") } } };
    const aoVivo = html(blocosAoVivoDaTask(vivo, "t1"));
    expect(aoVivo).toContain('<span class="tk-agora-txt">Rodando um comando</span>');
    expect(aoVivo).toContain('<div class="tk-agora-detalhe">npm run test:integration</div>');
  });

  it("o pedido que o dono escreveu ao abrir a frente vem do detalhe", () => {
    const e = estadoCom(tarefa(), { mensagens: [], pedidoDoBot: "Revise o PR #821." });
    expect(html(blocosDoHistoricoDaTask(e, "t1"))).toContain('<div class="tk-pedido-rot">Pedido · escrito por Ada</div>');
  });

  it("a fala guardada pelo Parar leva o chip só com a tarefa parada (ADR-185)", () => {
    const m = fala("r1", AGORA - 5 * SEG, "usa o banco de staging", "pessoa");
    const parada = estadoCom(tarefa({ estado: "parado", terminadoEm: AGORA }), { mensagens: [fala("m0", AGORA - 30 * SEG, "Começando."), m], falasNaFila: [{ mensagemId: "r1", situacao: "guardada" }] });
    expect(html(blocosDoHistoricoDaTask(parada, "t1"))).toContain("Guardada · Ada lê quando a tarefa continuar");
    const continuada = estadoCom(tarefa({ estado: "rodando" }), { mensagens: [fala("m0", AGORA - 30 * SEG, "Começando."), m], falasNaFila: [{ mensagemId: "r1", situacao: "guardada" }] });
    expect(html(blocosDoHistoricoDaTask(continuada, "t1"))).not.toContain("Guardada");
    expect(chipDaFalaNaFrente("guardada", "Ada", { rodando: false })).toContain("Guardada · Ada lê quando a tarefa continuar");
  });

  it("precisa de você: a pergunta aberta vira o cartão com as opções na própria conversa (Paper 4n)", () => {
    const t = tarefa({ estado: "precisa_de_voce" });
    const pergunta = fala("q1", AGORA - 5 * SEG, "Posso rodar a integração no staging?", "agente", { payload: { kind: "pedido_a_pessoa", decisaoId: "d1", opcoes: ["Pode rodar no staging", "Não, pare na unidade"] } as never });
    expect(perguntaAberta(t, [pergunta])?.decisaoId).toBe("d1");
    expect(perguntaAberta(tarefa(), [pergunta])).toBeNull();
    const h = html(blocosDoHistoricoDaTask(estadoCom(t, { mensagens: [pergunta] }), "t1"));
    expect(h).toContain("Ada precisa de você");
    expect(h).toContain('class="tk-opcao primeira" data-act="responder-opcao" data-id="d1" data-texto="Pode rodar no staging"');
    expect(h).toContain('data-texto="Não, pare na unidade"');
  });
});

describe("o fim da tarefa (Paper 4l e 4m)", () => {
  it("parada: \"Você parou a tarefa\"; feita: a linha do feito e a entrega à vista (validação de 2026-11-18, observação (a))", () => {
    expect(linhaDoFim(tarefa({ estado: "parado", terminadoEm: AGORA }), "Ada")).toContain("Você parou a tarefa · 15:10");
    expect(linhaDoFim(tarefa({ estado: "terminado", terminadoEm: AGORA }), "Ada")).toContain("Tarefa feita · 15:10 · o resultado também foi para a conversa com Ada");
    const feita = tarefa({ estado: "terminado", terminadoEm: AGORA, resumo: { feito: "1. O pão mais antigo tem 14 mil anos.\n2. …", falta: "conferir a fonte" } });
    const e = estadoCom(feita, { mensagens: [fala("m1", AGORA - SEG, "Listei as três curiosidades e devolvi o resumo.")] });
    const fim = html(blocosAoVivoDaTask(e, "t1"));
    expect(fim).toContain('<section class="tk-entrega" aria-label="Entrega">');
    expect(fim).toContain("O pão mais antigo tem 14 mil anos.");
    expect(fim).toContain("conferir a fonte");
    expect(htmlEntrega(feita, "1. O pão mais antigo tem 14 mil anos.\n2. …")).toBe("");
    expect(htmlEntrega({ ...feita, estado: "parado" }, null)).toBe("");
  });

  it("\"Fazer aqui\" saiu do topo e mora no menu da aba, só quando valia", () => {
    expect(htmlDoMenuDaAba(tarefa(), { fazerNaConversa: true })).toContain('data-aba-acao="fazer-aqui">Fazer na conversa');
    expect(htmlDoMenuDaAba(tarefa())).not.toContain("fazer-aqui");
  });
});

describe("a API das saídas da parada e do clipe", () => {
  afterEach(() => vi.unstubAllGlobals());
  type ApiDeTeste = { criarApi: (escopo: { tenantId: string; pessoaId: string }) => { encerrarTrabalho(id: string): Promise<unknown>; escreverNoTrabalho(id: string, texto: string, anexos?: readonly string[]): Promise<unknown> } };

  it("Encerrar é POST trabalhos/:id/encerrar; a fala na tarefa leva os anexos quando há", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ ok: true, ids: {} })); });
    const api = (await vi.importActual<ApiDeTeste>("../../../web/lib/api.ts")).criarApi({ tenantId: "t", pessoaId: "p" });
    await api.encerrarTrabalho("t1");
    await api.escreverNoTrabalho("t1", "veja o print", ["a1"]);
    await api.escreverNoTrabalho("t1", "Continue de onde parou.");
    expect(chamadas.map((c) => `${c.init.method} ${c.url}`)).toEqual(["POST /api/t/t/trabalhos/t1/encerrar", "POST /api/t/t/trabalhos/t1/mensagens", "POST /api/t/t/trabalhos/t1/mensagens"]);
    expect(JSON.parse(String(chamadas[1]?.init.body))).toEqual({ texto: "veja o print", anexos: ["a1"] });
    expect(JSON.parse(String(chamadas[2]?.init.body))).toEqual({ texto: "Continue de onde parou." });
  });
});

describe("o desenho (web/chat.css e web/tokens.css)", () => {
  const css = readFileSync(new URL("../../../web/chat.css", import.meta.url), "utf8");
  const tokens = readFileSync(new URL("../../../web/tokens.css", import.meta.url), "utf8");

  it("os tokens novos existem no claro e nos dois escuros", () => {
    for (const t of ["--chat-pedido-fundo", "--chat-pedido-contorno", "--chat-tinta-passo", "--chat-saida-contorno", "--chat-precisa-fundo", "--chat-precisa-contorno"]) {
      expect(tokens.split(`${t}:`).length - 1).toBe(3);
      expect(css).toContain(`var(${t})`);
    }
  });

  it("o Parar da tarefa é a pílula de 32 com o rótulo; o campo que espera a pessoa tem o anel azul", () => {
    expect(css).toContain(".composer .box > .parar-envio.parar-tarefa { display: inline-flex; align-items: center; gap: 8px; width: auto; height: 32px;");
    expect(css).toContain(".composer .box.tk-precisa-campo { border-color: transparent; box-shadow: 0 0 0 1.5px var(--chat-aba-precisa)");
  });
});
