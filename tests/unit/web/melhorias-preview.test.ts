import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { renderMensagem, renderTimeline, situacaoNaFila } from "../../../web/telas/conversa.ts";
import { renderFaixaParada } from "../../../web/telas/faixa-parada.ts";

const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

describe("o Parar é uma linha discreta, não uma caixa vermelha", () => {
  it("o caso comum diz só 'Parado por você', sem contagens nem ×", () => {
    const h = renderFaixaParada({ interrompidas: 2, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(h).toContain("<span>Parado por você</span>");
    expect(h).not.toMatch(/interrompida\(s\)|não interrompida|já entregue|Nada foi reenviado|fechar-faixa/);
  });

  it("os números só aparecem quando contam algo inesperado, com o detalhe no title", () => {
    const h = renderFaixaParada({ interrompidas: 1, naoInterrompidas: [{ turnoId: "abcdef1234", motivo: "em outra máquina" }], jaEntregues: [{ id: "m1", em: Date.UTC(2026, 10, 16, 22, 0) }], nadaRodando: false });
    expect(h).toContain("1 continuou rodando");
    expect(h).toContain('title="abcdef12: em outra máquina"');
    expect(h).toContain("1 resposta já tinha saído");
  });

  it("'Nada estava rodando' continua escrito", () => {
    expect(renderFaixaParada({ interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true })).toContain("Nada estava rodando.");
  });

  it("na conversa: sem caixa e sem vermelho, cinza em corpo 2; some com a próxima mensagem", () => {
    const c = css("casca.css");
    expect(c).toMatch(/\.timeline \.faixa\.faixa-parada \{[^}]*border: 0;[^}]*background: none; color: var\(--ink-3\); font-size: var\(--fs-corpo-2\);/);
    const m = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(m).toContain('if (estado.faixaParada) dispatch({ tipo: "faixa", faixa: null });');
  });
});

describe("ADR-185: o selo da fala que o turno vivo absorveu", () => {
  const C = "c1";
  const mensagem = { tenantId: "t", id: "m2", conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto: "resume em 3", payload: null, confianca: "confiavel", parcial: false, criadoEm: 2 } as unknown as Mensagem;
  const comSessao = (lidoEm: number | null) => {
    const conversa: ConversaDto = {
      conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
      mensagens: [mensagem], turnosPendentes: [], turnosEmCurso: [{ id: "t1", estado: "despachando", desde: 1, mensagemId: "m1" }], turnosCancelados: [], propostas: [], fios: [],
      turnosNaSessao: [{ id: "t2", mensagemId: "m2", absorvidoPor: "t1", lidoEm }],
    };
    const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 3 });
    return { ...e, frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C }] } as never };
  };

  it("escrita e não lida: 'Entregue · <bot> lê quando terminar o que está fazendo', sem Cancelar (ela já está na sessão)", () => {
    const s = situacaoNaFila(mensagem, comSessao(null));
    expect(s).toMatchObject({ tipo: "na_sessao", texto: "Entregue · Nina lê quando terminar o que está fazendo", turnoId: "t2" });
    expect(s?.botao).toBeUndefined();
    expect(renderMensagem(mensagem, comSessao(null))).toContain('data-fila="na_sessao"');
  });

  it("lida: 'Lida'", () => {
    expect(situacaoNaFila(mensagem, comSessao(5))).toMatchObject({ tipo: "lida", texto: "Lida" });
  });
});

describe("ADR-185: a faixa do Parar sai quando a fala devolvida começa a rodar", () => {
  it("turno do chat despachado na conversa aberta tira o 'Parado por você'; o da frente não", () => {
    const base = { ...estadoInicial, tela: { tipo: "conversa", conversaId: "c1" }, faixaParada: { interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false } } as never;
    const frame = (dados: Record<string, unknown>) => ({ tipo: "frame", frame: { tipo: "turno.iniciado", dados: { conversaId: "c1", turnoId: "t9", kind: "turno_despachado", ...dados } }, agora: 10 }) as never;
    expect(reduzir(base, frame({})).faixaParada).toBeNull();
    expect(reduzir(base, frame({ trabalhoId: "f1" })).faixaParada).not.toBeNull();
    expect(reduzir(base, frame({ kind: "turno_criado" })).faixaParada).not.toBeNull();
  });

  it("o Parar de um bot não aparece na conversa de outro (validação de 2026-11-19)", () => {
    const conversa: ConversaDto = {
      conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
      mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    };
    const aberta = { ...reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 10 }), tela: { tipo: "conversa", conversaId: "c1", agenteId: "a" } } as never;
    const parada = (conversaId: string) => reduzir(aberta, { tipo: "frame", frame: { tipo: "parada.faixa", dados: { conversaId, interrompidas: 1 } }, agora: 10 } as never);
    const timeline = (e: ReturnType<typeof reduzir>) => renderTimeline(e.conversas.c1 ?? null, e);
    expect(timeline(parada("c1"))).toContain("Parado por você");
    expect(timeline(parada("c2"))).not.toContain("Parado por você");
    expect(timeline(reduzir(aberta, { tipo: "faixa", faixa: { interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false }, conversaId: "c2" }))).not.toContain("Parado por você");
  });
});

describe("ADR-185: o texto que a pessoa parou no meio", () => {
  const C = "c1";
  const PARADO = Date.UTC(2026, 10, 16, 21, 22);
  const fala = (extra: Partial<Mensagem>) => ({ tenantId: "t", id: "b1", conversaId: C, turnoId: "t1", autoria: { autor_tipo: "agente", autor_id: "a" }, kind: "texto", texto: "1. Uma lenda\n\nTexto longo", payload: null, confianca: "confiavel", parcial: true, criadoEm: PARADO, ...extra }) as unknown as Mensagem;
  const estadoCom = (m: Mensagem) => {
    const conversa: ConversaDto = {
      conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
      mensagens: [m], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    };
    return { ...reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: PARADO }), frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C }] } as never };
  };

  it("parado pela pessoa: a linha 'Parado por você · hora' no lugar do 'parcial', e o texto recolhido", () => {
    const m = fala({ paradaPelaPessoaEm: PARADO });
    const h = renderMensagem(m, estadoCom(m));
    expect(h).toContain('class="linha-parada"');
    expect(h).toContain("Parado por você · ");
    expect(h).toContain('data-act="alternar-texto"');
    expect(h).toContain("Mostrar o texto todo");
    expect(h).toMatch(/class="message bot[^"]* texto-recolhido/);
    expect(h).not.toContain(">parcial<");
  });

  it("ADR-186: interrompida pela mensagem nova: 'Interrompido pela sua mensagem · hora', recolhida, sem 'parcial' (mesmo se o turno depois foi parado)", () => {
    const m = fala({ payload: { kind: "fala_interrompida", por: "mensagem_nova" }, paradaPelaPessoaEm: PARADO + 60_000 } as Partial<Mensagem>);
    const h = renderMensagem(m, estadoCom(m));
    expect(h).toContain("Interrompido pela sua mensagem · ");
    expect(h).not.toContain("Parado por você");
    expect(h).toMatch(/class="message bot[^"]* texto-recolhido/);
    expect(h).not.toContain(">parcial<");
  });

  it("ADR-186 (revisão): retomada depois de responder: 'Pausado para te responder', inteira, sem recolher nem botão", () => {
    const m = fala({ payload: { kind: "fala_interrompida", por: "mensagem_nova", retomou: true } } as Partial<Mensagem>);
    const h = renderMensagem(m, estadoCom(m));
    expect(h).toContain("Pausado para te responder · ");
    expect(h).toContain("linha-pausada");
    expect(h).not.toContain("texto-recolhido");
    expect(h).not.toContain("alternar-texto");
  });

  it("parcial por outro motivo (queda, limite): fica o 'parcial', sem linha e sem recolher", () => {
    const m = fala({});
    const h = renderMensagem(m, estadoCom(m));
    expect(h).toContain(">parcial<");
    expect(h).not.toContain("linha-parada");
    expect(h).not.toContain("texto-recolhido");
  });

  it("resposta completa e longa segue inteira", () => {
    const m = fala({ parcial: false, texto: "x".repeat(5000) });
    expect(renderMensagem(m, estadoCom(m))).not.toContain("texto-recolhido");
  });

  it("CSS: recolhe só a .texto-recolhido, e a linha usa o cinza do chat", () => {
    const c = css("chat.css");
    expect(c).toMatch(/\.timeline \.message\.texto-recolhido \.bubble \{ max-height:/);
    expect(c).toMatch(/\.timeline \.linha-parada \{[^}]*color: var\(--chat-tinta-3\);/);
  });
});


describe("Não lidos: linha fixa abaixo de Trabalhos, fora do topo", () => {
  it("o topo tem só lupa e +; a linha vem logo depois de Trabalhos, com o número em azul", () => {
    const m = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(m).not.toContain('class="icone-topo nao-lidos-bt"');
    expect(m).toContain('<div class="linha-fixa linha-nao-lidos">');
    expect(m).toMatch(/\$\{linhaTrabalhos\}\s*\$\{linhaNaoLidos\}/);
    expect(css("casca.css")).toContain("& .linha-fixa-cont.linha-fixa-novas { color: var(--signal);");
  });
});

describe("ADR-185: abrir o texto parado redesenha o histórico memorizado", () => {
  it("a versão dos textos abertos sobe a cada clique e entra nas dependências do histórico", async () => {
    const { alternarTexto, versaoDosTextos, textoAberto } = await import("../../../web/lib/textos-abertos.ts");
    const antes = versaoDosTextos();
    expect(alternarTexto("x")).toBe(true);
    expect(textoAberto("x")).toBe(true);
    expect(versaoDosTextos()).toBe(antes + 1);
    expect(alternarTexto("x")).toBe(false);
    const m = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(m).toMatch(/lembrar\("timeline-historico", estado, \[[^\]]*versaoDosTextos\(\)\]/);
    // Validação de 2026-11-17: a tela da tarefa também (o texto parado nela não abria).
    expect(m).toMatch(/lembrar\("task-historico", estado, \[[^\]]*versaoDosTextos\(\)\]/);
  });
});

