import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { pedidosQueEsperam, placeholderComPedido } from "../../../web/lib/pedidos-que-esperam.ts";
import { modoDoComposer } from "../../../web/lib/perguntas.ts";
import { pilulaDosPedidos } from "../../../web/lib/rolagem.ts";
import { naoFeito } from "../../../web/telas/cartao-encolhido.ts";
import { blocosDoHistorico, renderMensagem } from "../../../web/telas/conversa.ts";
import { aparenciaDoComposer } from "../../../web/telas/pergunta.ts";

/**
 * ADR-191 (definido em 2026-11-20, pedido do dono): o cartão que a pessoa deixou para trás ao seguir conversando vira a
 * linha cinza no lugar dele; a proposta aberta fica onde nasceu; a pílula "A Ada espera você" leva ao cartão fora da
 * janela; o campo diz "Responda à Ada ou fale de outra coisa"; e o cartão ganha respiro em volta.
 */
const C = "c1";
const AGORA = Date.parse("2026-11-20T11:20:00Z");
const MIN = 60_000;
const t0 = AGORA - 60 * MIN;
const pessoa = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
const bot = { ...pessoa, autor_tipo: "agente", autor_id: "a" } as const;

const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: bot, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, destino: "chat", ...extra,
} as Mensagem);
const daPessoa = (id: string, criadoEm: number): Mensagem => msg(id, criadoEm, { autoria: pessoa });
const fala = (id: string, criadoEm: number, turnoId: string): Mensagem => msg(id, criadoEm, { turnoId, origemTurno: "conversa", fimDoTurno: true });
const dispensado = (id: string, criadoEm: number, p: Partial<Extract<NonNullable<Mensagem["payload"]>, { kind: "pedido_dispensado" }>> = {}): Mensagem =>
  msg(id, criadoEm, { autoria: pessoa, kind: "sistema", texto: "A pessoa seguiu sem responder…", payload: { kind: "pedido_dispensado", decisaoId: `d-${id}`, tipo: "rotina", frase: "Rodar agora a rotina das 9h", motivo: "seguiu_conversando", turnoId: "t1", agenteId: "a", ...p } });

const item = (id: string, tipo: SuaVezDto["itens"][number]["decisao"]["tipo"], frase: string, extra: Partial<SuaVezDto["itens"][number]["decisao"]> = {}): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: C, turnoId: "t1", tipo, estado: "pendente", prazoDecisaoEm: "2026-11-21T11:00:00Z", prazoExecucaoEm: null, frase, desfecho: null, vistaEm: null, criadoEm: new Date(t0 + 2 * MIN).toISOString(), fioId: null, ...extra },
  estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: MIN, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], proposta: null, fio: null, rotinaParada: null, itensAprovacao: [],
});

const conexao = (id: string, criadoEm: number, turnoId?: string): Proposta => ({ tenantId: "t", id, conversaId: C, agenteId: "a", kind: "acesso", estado: "pendente", payload: { kind: "acesso", conectar: true, conector: "googledrive", capacidades: [], nivel: "leitura", naoPedido: [], ...(turnoId ? { turnoId } : {}) }, criadoEm } as Proposta);

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = [], extra: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...extra,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "c-violet", forma: "shape-circle", ownerId: "p" }] } as never,
    conectores: [{ slug: "gmail", nome: "Gmail", habilitado: true, ownerId: "p", catalogo: [] }] as never,
    marketplace: [{ slug: "googledrive", nome: "Google Drive" }] as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

const chaves = (c: ConversaEstado, e: Estado): string[] => blocosDoHistorico(c, e).map((b) => b.chave).filter((k) => !k.startsWith("sep:"));

describe("a linha cinza do pedido dispensado (item C)", () => {
  const { e } = cenario([]);

  it("card de conexão: 'Conectar o Google Drive · você seguiu sem conectar' e o Conectar de sempre", () => {
    const html = renderMensagem(dispensado("r", AGORA, { tipo: "acesso", conector: "googledrive", conectar: true, frase: "Conectar o googledrive" }), e);
    expect(html).toContain('class="msg-linha msg-dispensado"');
    expect(html).toContain('class="pedido-dispensado"');
    expect(html).toContain('>Conectar o Google Drive <span class="pd-sufixo">· você seguiu sem conectar</span>');
    expect(html).toContain('data-act="conectar-app"');
    expect(html).toContain('data-id="googledrive"');
    expect(html).toContain('class="app-logo app-googledrive"');
  });

  it("app já conectado: a mesma linha pede de novo ao bot em vez de abrir o login", () => {
    const html = renderMensagem(dispensado("r", AGORA, { tipo: "acesso", conector: "gmail", conectar: true, frase: "Conectar o Gmail" }), e);
    expect(html).toContain('data-act="pedir-de-novo"');
    expect(html).not.toContain('data-act="conectar-app"');
  });

  it("aprovação substituída (ADR-184): 'Pagar R$ 249,90 na loja · não pago' e 'Pedir de novo' com a frase pronta", () => {
    const m = msg("ap", AGORA, { autoria: pessoa, kind: "resultado_aprovacao", turnoId: "t1", texto: "O pedido ficou sem resposta…", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase: "Pagar R$ 249,90 na loja", itens: [{ idx: 0, desfecho: "retirado_pela_pessoa", texto: "pagamento" }], substituida: true } });
    const html = renderMensagem(m, e);
    expect(html).toContain('>Pagar R$ 249,90 na loja <span class="pd-sufixo">· não pago</span>');
    expect(html).toContain('data-act="pedir-de-novo"');
    expect(html).toContain('data-texto="Pode pedir de novo: pagar R$ 249,90 na loja"');
    expect(html).toContain("<svg");
  });

  it("o particípio vem do verbo; sem verbo conhecido, 'nada rodou'", () => {
    expect(naoFeito("Apagar a pasta x")).toBe("não apagado");
    expect(naoFeito("Enviar e-mail para a equipe")).toBe("não enviado");
    expect(naoFeito("rm -r /tmp/x")).toBe("nada rodou");
  });

  it("genérico: '<frase> · você seguiu sem responder', com o ponto cinza", () => {
    const html = renderMensagem(dispensado("r", AGORA), e);
    expect(html).toContain('>Rodar agora a rotina das 9h <span class="pd-sufixo">· você seguiu sem responder</span>');
    expect(html).toContain('class="pd-ponto"');
  });

  it("ajuda do computador: a linha fica no lugar da fala do bot, com 'Fazer agora' (a tela dele), e o recibo não sai duas vezes", () => {
    const balao = msg("aj", t0 + MIN, { turnoId: "t1", texto: "Abra meu computador para concluir este passo: entrar no Drive. Abra a tela e clique nela para assumir; quando terminar, toque em Parar. Não envie senha ou código aqui.", payload: { kind: "pedido_a_pessoa", decisaoId: "d-aj", ajudaDoComputador: true } });
    const recibo = dispensado("r", t0 + 5 * MIN, { tipo: "pergunta", decisaoId: "d-aj", frase: "entrar no Drive", ajuda: true });
    const { e: e2, c } = cenario([daPessoa("m1", t0), balao, daPessoa("m3", t0 + 4 * MIN), recibo]);
    const html = blocosDoHistorico(c, e2).map((b) => b.html).join("");
    expect(html.match(/class="pedido-dispensado"/gu)).toHaveLength(1);
    expect(html).toContain('>Entrar no Drive <span class="pd-sufixo">· você seguiu sem entrar</span>');
    expect(html).toContain('data-act="abrir-computador"');
    expect(html).not.toContain("Abra meu computador");
    // No lugar da fala: depois de m1 e antes da mensagem nova.
    expect(html.indexOf("pedido-dispensado")).toBeLessThan(html.indexOf("fala m3"));
    expect(html.indexOf("fala m1")).toBeLessThan(html.indexOf("pedido-dispensado"));
  });

  it("fica no lugar onde o cartão nasceu (a fala do turno que pediu), não depois da mensagem nova", () => {
    const { e: e2, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), dispensado("r", t0 + 5 * MIN + 1)]);
    expect(chaves(c, e2)).toEqual(["m1", "m2", "encolhido:r", "m3"]);
  });

  it("as linhas do mesmo turno ficam juntas num invólucro só (6 px entre elas no CSS)", () => {
    const { e: e2, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), dispensado("r1", t0 + 5 * MIN + 1), dispensado("r2", t0 + 5 * MIN + 2, { frase: "Conectar o Gmail" })]);
    const blocos = blocosDoHistorico(c, e2).filter((b) => !b.chave.startsWith("sep:"));
    expect(blocos.map((b) => b.chave)).toEqual(["m1", "m2", "encolhido:r1", "m3"]);
    const grupo = blocos[2]?.html ?? "";
    expect(grupo.startsWith('<div class="pedidos-dispensados">')).toBe(true);
    expect(grupo.match(/class="pedido-dispensado"/gu)).toHaveLength(2);
  });

  it("o cartão aberto de mesmo id não é desenhado de novo enquanto 'Sua vez' não relê", () => {
    const aberto = item("d-r", "rotina_execucao", "Rodar agora a rotina das 9h");
    const { e: e2, c } = cenario([fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), dispensado("r", t0 + 5 * MIN + 1)], [aberto]);
    expect(chaves(c, e2)).not.toContain("decisao:d-r");
  });
});

describe("a proposta aberta fica onde nasceu (item D)", () => {
  it("ancorada na fala do turno que a propôs, antes do que veio depois", () => {
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), fala("m4", t0 + 10 * MIN, "t2")], [], { propostas: [conexao("pr1", t0 + 2 * MIN, "t1")] });
    expect(chaves(c, e)).toEqual(["m1", "m2", "proposta:pr1", "m4"]);
  });

  it("sem turno, a última mensagem anterior a ela; sem nenhuma, a seção do fim, como antes", () => {
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + 10 * MIN, "t2")], [], { propostas: [conexao("pr1", t0 + MIN)] });
    expect(chaves(c, e)).toEqual(["m1", "proposta:pr1", "m2"]);
    const { e: e2, c: c2 } = cenario([daPessoa("m1", t0 + 5 * MIN)], [], { propostas: [conexao("pr1", t0)] });
    expect(chaves(c2, e2)).toEqual(["m1", "proposta:pr1"]);
  });

  it("leva a marca que a pílula procura: o id, o bot e o que ela pede", () => {
    const { e, c } = cenario([fala("m2", t0 + MIN, "t1")], [], { propostas: [conexao("pr1", t0 + 2 * MIN, "t1")] });
    const html = blocosDoHistorico(c, e).find((b) => b.chave === "proposta:pr1")?.html ?? "";
    expect(html).toContain('<div class="pedido-que-espera" data-pedido-espera="pr1" data-nome="Ada" data-frase="conectar o Google Drive">');
  });

  it("o pedido ancorado de 'Sua vez' também leva a marca (a aprovação incluída, ADR-184)", () => {
    const { e, c } = cenario([fala("m2", t0 + MIN, "t1")], [item("d9", "retomar_turno", "Turno interrompido: seu Mac parou de responder.")]);
    const html = blocosDoHistorico(c, e).find((b) => b.chave === "decisao:d9")?.html ?? "";
    expect(html).toContain('data-pedido-espera="d9"');
    expect(html).toContain('data-frase="turno interrompido: seu Mac parou de responder"');
  });
});

describe("a pílula 'o que espera você' (item E)", () => {
  it("um fora da janela: 'A Ada espera você: entrar no Drive' com 'Ver ↓', e leva ao cartão", () => {
    const html = pilulaDosPedidos({ decisaoId: "d1", nome: "Ada", frase: "entrar no Drive", total: 1, posicao: "abaixo" });
    expect(html).toContain("A Ada espera você: <b>entrar no Drive</b>");
    expect(html).toContain('<span class="pp-ver">Ver <svg');
    expect(html).toContain('data-act="ver-decisao"');
    expect(html).toContain('data-id="d1"');
  });

  it("dois ou mais: '2 pedidos esperam você · Ver'", () => {
    const html = pilulaDosPedidos({ decisaoId: "d1", nome: "Ada", total: 2, posicao: "acima" });
    expect(html).toContain("2 pedidos esperam você");
    expect(html).toContain("· </span>Ver");
  });

  it("some com um cartão à vista, sem cartão, ou sem frase fica só 'A Ada espera você'", () => {
    expect(pilulaDosPedidos({ decisaoId: "", nome: "", total: 1, posicao: "visivel" })).toBe("");
    expect(pilulaDosPedidos(null)).toBe("");
    expect(pilulaDosPedidos({ decisaoId: "d1", nome: "Ada", frase: "", total: 1, posicao: "abaixo" })).toContain("A Ada espera você</span>");
  });
});

describe("o campo com um pedido aberto (item F)", () => {
  const ajuda = item("d-aj", "pergunta", "Abra meu computador para concluir este passo: entrar no Drive. Abra a tela e clique nela para assumir; quando terminar, toque em Parar. Não envie senha ou código aqui.");
  const base = { conversaId: C, pessoaId: "p", nomeDoBot: () => "Ada", nomeDoApp: (s: string) => (s === "googledrive" ? "Google Drive" : s) };

  it("os pedidos do escopo, do mais antigo ao mais novo, com a frase curta", () => {
    const itens = [item("d1", "acesso", "Ada quer ler seu Gmail."), ajuda, item("d2", "pergunta", "qual planilha?"), item("d3", "falta_de_dado", "falta o e-mail"), item("d4", "acesso", "de uma tarefa", { tarefaId: "x" }), item("d5", "acesso", "da Ana", { decisorId: "ana" })];
    const lista = pedidosQueEsperam({ ...base, itens, propostas: [conexao("pr1", t0 + 30 * MIN)], ajudaDe: (i) => i.decisao.id === "d-aj" });
    expect(lista.map((p) => [p.id, p.frase])).toEqual([["d1", "Ada quer ler seu Gmail"], ["d-aj", "entrar no Drive"], ["pr1", "Conectar o Google Drive"]]);
  });

  it("'Responda à Ada ou fale de outra coisa' com o campo no modo comum; com pergunta de texto aberta, o de sempre", () => {
    const { e } = cenario([]);
    const padrao = { placeholder: "Mensagem para Ada", nota: "" };
    expect(aparenciaDoComposer(modoDoComposer(e, C), e, padrao, C, "Ada").placeholder).toBe(placeholderComPedido("Ada"));
    expect(placeholderComPedido("Ada")).toBe("Responda à Ada ou fale de outra coisa");
    expect(aparenciaDoComposer(modoDoComposer(e, C), e, padrao, C, null).placeholder).toBe("Mensagem para Ada");
    expect(aparenciaDoComposer({ tipo: "resposta", perguntas: [], alvo: ajuda as never, indice: 0 }, e, padrao, C, "Ada").placeholder).toBe("Mensagem para Ada");
  });
});

describe("o respiro em volta do cartão (item G)", () => {
  const css = readFileSync(new URL("../../../web/chat.css", import.meta.url), "utf8");

  // revisto em 2026-11-21 (teste do dono): o cartão segue a regra de um balão — 16 px de margem e 2 px de folga.
  it("o cartão aberto e a linha têm o mesmo espaço de um balão (16 px + 2 px de folga); os balões não mudam", () => {
    expect(css).toContain(".timeline .pedido-que-espera { margin: 16px 0 0; padding: 2px 0; }");
    expect(css).toContain(".timeline .pedido-que-espera > :is(.cp, .cp-linha, .cp-erro) { margin-top: 0; margin-bottom: 0; }");
    expect(css).toContain(".timeline .pedidos-dispensados { display: flex; flex-direction: column; gap: 6px; margin: 16px 0 0; padding: 2px 0; }");
    expect(css).toContain(".timeline .message[data-group-start] { margin-top: 16px; }");
    expect(css).toContain(".timeline .message { padding: 2px 0; margin: 0;");
    const casca = readFileSync(new URL("../../../web/casca.css", import.meta.url), "utf8");
    expect(casca).toContain(".timeline .decisoes-ancoradas { margin: 16px 0 0; padding: 2px 0; width: min(560px, 100%); }");
  });
});
