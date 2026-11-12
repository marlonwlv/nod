import { describe, expect, it } from "vitest";
import type { AjustesAprovacao } from "../../../src/contracts/ajustes-aprovacao.ts";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import { DESCRICAO_AUTOMATICO_COM_REVISOR } from "../../../src/domain/modo-aprovacao.ts";
import { ROTULO_LISTA, ROTULO_NIVEL } from "../../../src/domain/ajustes-aprovacao.ts";
import { fraseDoErro, MODOS_DA_TELA, NIVEIS_DA_TELA, renderConfigAprovacoes, TELA_APROVACOES_INICIAL, TITULO_LISTA, modoMarcado } from "../../../web/telas/config-aprovacoes.ts";
import { agruparIguais, IGUAIS_UM_A_UM, renderPedidosIguais } from "../../../web/telas/pedidos-iguais.ts";
import { renderCartaoRevisor } from "../../../web/telas/cartao-revisor.ts";
import { linhaDaRegra } from "../../../web/telas/linha-do-modo.ts";

/** ADR-166: Configurações › Aprovações (tela 07) e os cartões da tela 06 do protótipo. */

const regra = (id: string, lista: "permitir" | "perguntar", texto: string, agenteId: string | null = null) => ({ id, agenteId, lista, texto, origem: "pessoa" as const, criadoEm: 1 });

const dados = (extra: Partial<AjustesAprovacao> = {}): AjustesAprovacao => ({
  agenteId: null,
  modoPedido: null,
  modoEfetivo: null,
  soLeitura: false,
  teto: null,
  admin: false,
  revisorLigado: true,
  regras: { padrao: [regra("p1", "perguntar", "Mandar e-mail para fora da exemplo.com"), regra("p2", "perguntar", "Qualquer pagamento"), regra("p3", "permitir", "Comentar em PRs do gamefik/nod")], doBot: [] },
  niveis: [{ agenteId: null, conector: "slack", ferramenta: "", tipo: "escrita", nivel: "sempre_pedir" }],
  apps: [{ slug: "slack", nome: "Slack" }],
  limites: { regrasPorLista: 20, caracteresPorRegra: 1000 },
  ...extra,
});
const bots = [{ id: "b1", nome: "Dante", modo: "automatico" as const }, { id: "b2", nome: "Ada", modo: "automatico" as const }];

describe("Configurações › Aprovações", () => {
  it("os três modos com título e frase, Automático recomendado e marcado quando todos os bots estão nele", () => {
    const html = renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados() }, bots);
    for (const m of MODOS_DA_TELA) expect(html).toContain(m.titulo);
    expect(html).toContain("Recomendado");
    expect(html).toMatch(/aria-checked="true" data-act="apv-modo" data-modo="automatico"/);
    expect(modoMarcado({ ...TELA_APROVACOES_INICIAL }, [...bots, { id: "b3", nome: "X", modo: "manual" }])).toBeNull();
  });

  it("as duas listas com a contagem N de 20 e o Adicionar regra; as regras valem só no automático", () => {
    const html = renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados() }, bots);
    expect(html).toContain("Sempre me pergunte");
    expect(html).toContain("Pode fazer sem perguntar");
    expect(html).toContain("2 de 20");
    expect(html).toContain("1 de 20");
    expect(html).toContain("Mandar e-mail para fora da exemplo.com");
    expect(html).toContain("As regras valem só no modo automático");
    expect(html.match(/data-act="apv-nova-regra"/g)).toHaveLength(2);
  });

  it("os títulos da web são os do domínio (a web não importa valores de src)", () => {
    expect(TITULO_LISTA.permitir.titulo).toBe(ROTULO_LISTA.permitir);
    expect(TITULO_LISTA.perguntar.titulo).toBe(ROTULO_LISTA.perguntar);
    for (const n of NIVEIS_DA_TELA) expect(n.rotulo).toBe(ROTULO_NIVEL[n.nivel].titulo);
    expect(MODOS_DA_TELA.find((m) => m.modo === "automatico")?.frase).not.toBe(DESCRICAO_AUTOMATICO_COM_REVISOR);
  });

  it("num bot: as regras do padrão aparecem como 'Todos os bots' (sem editar) e o só leitura aparece", () => {
    const html = renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, agenteId: "b1", dados: dados({ agenteId: "b1", modoPedido: "automatico", modoEfetivo: "automatico", regras: { padrao: [regra("p1", "perguntar", "Qualquer pagamento")], doBot: [regra("b1r", "permitir", "Rodar testes", "b1")] } }) }, bots);
    expect(html).toContain("Todos os bots");
    expect(html).toContain("Só leitura");
    expect(html).toContain('data-regra="b1r"');
    expect(html).not.toContain('data-act="apv-editar-regra" data-regra="p1"');
  });

  it("o teto do admin: o seletor só para o admin; o aviso diz o pedido × o efetivo", () => {
    expect(renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados() }, bots)).not.toContain("Teto do time");
    expect(renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados({ admin: true }) }, bots)).toContain("Teto do time");
    const limitado = renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, agenteId: "b1", dados: dados({ agenteId: "b1", teto: "manual", modoPedido: "total", modoEfetivo: "manual" }) }, bots);
    expect(limitado).toContain("Seu admin limitou os bots do time a Manual.");
    expect(limitado).toContain("Este bot pediu Total e roda em Manual.");
  });

  it("cada app com Ler e Mudar e os quatro níveis; o nível gravado vem marcado", () => {
    const html = renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados() }, bots);
    expect(html).toContain('data-conector="slack" data-tipo="escrita"');
    expect(html).toMatch(/data-tipo="escrita">[^]*?<option value="sempre_pedir" selected>/);
    for (const n of NIVEIS_DA_TELA) expect(html).toContain(n.rotulo);
  });

  it("regra em edição vira campo com Salvar e Cancelar; lista cheia desliga o Adicionar", () => {
    const ed = renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados(), editando: { lista: "permitir", id: null, texto: "Pode <b>x</b>" } }, bots);
    expect(ed).toContain('data-apv-campo="1"');
    expect(ed).toContain("Pode &lt;b&gt;x&lt;/b&gt;");
    const cheia = dados({ regras: { padrao: Array.from({ length: 20 }, (_, i) => regra(`r${i}`, "permitir", `R ${i}`)), doBot: [] } });
    expect(renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: cheia }, bots)).toMatch(/data-act="apv-nova-regra" data-lista="permitir" disabled/);
  });

  it("revisor desligado: a nota diz que as regras esperam ele ligar", () => {
    expect(renderConfigAprovacoes({ ...TELA_APROVACOES_INICIAL, dados: dados({ revisorLigado: false }) }, bots)).toContain("passam a valer quando ele ligar");
  });

  it("erro de servidor em frase, sem código cru", () => {
    expect(fraseDoErro({ codigo: "entrada_invalida" })).toContain("até 20 por lista");
    expect(fraseDoErro(new Error("x"))).toBe("Não deu para salvar. Tente de novo.");
  });
});

type Item = SuaVezDto["itens"][number];
type ItemAprov = Item["itensAprovacao"][number];
const itemAprov = (id: string, ferramenta: string, extra: Partial<ItemAprov> = {}): ItemAprov => ({
  tenantId: "t", id: `i-${id}`, decisaoId: id, idx: 0, textoOriginal: `Issue ${id}`, textoFinal: `Issue ${id}`, destino: { conector: "linear", ferramenta, argumentos: {} },
  selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: "sem_regra_permanente", ...extra,
} as ItemAprov);
const item = (id: string, ferramenta = "create_issue", aprov: Partial<ItemAprov> = {}): Item => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "b1", conversaId: "c1", turnoId: null, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-11-13T00:00:00Z", prazoExecucaoEm: null, frase: "Ada quer usar o Linear", desfecho: null, vistaEm: null, criadoEm: "2026-11-12T00:00:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: 60_000, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: [itemAprov(id, ferramenta, aprov)], proposta: null, fio: null, rotinaParada: null,
} as Item);

describe("pedidos iguais num cartão só (tela 06, Em lote)", () => {
  it("mesmo bot e mesma ação viram um grupo no lugar do primeiro; o resto fica solto", () => {
    const g = agruparIguais([item("a"), item("x", "list_issues"), item("b"), item("c")]);
    expect(g).toHaveLength(2);
    expect(Array.isArray(g[0]) && g[0].map((i) => i.decisao.id)).toEqual(["a", "b", "c"]);
  });

  it("um só, terminal, dado pessoal ou 'Ver um a um' não agrupam", () => {
    expect(agruparIguais([item("a")]).every((x) => !Array.isArray(x))).toBe(true);
    const sensivel = item("s", "create_issue", { origemSensivel: true });
    expect(agruparIguais([item("a"), sensivel]).every((x) => !Array.isArray(x))).toBe(true);
    IGUAIS_UM_A_UM.add("b1|linear|create_issue");
    expect(agruparIguais([item("a"), item("b")]).every((x) => !Array.isArray(x))).toBe(true);
    IGUAIS_UM_A_UM.clear();
  });

  it("o cartão: N pedidos iguais, uma caixa por pedido, Permitir os N, Negar todos com Esc, Ver um a um", () => {
    const html = renderPedidosIguais([item("a"), item("b"), item("c"), item("d")], "Criar issue no Linear", "Linear");
    expect(html).toContain("4 pedidos iguais");
    expect(html.match(/data-igual="/g)).toHaveLength(4);
    expect(html).toContain("Permitir os <span data-iguais-conta>4</span>");
    expect(html).toContain("Negar todos");
    expect(html).toContain("Esc");
    expect(html).toContain("Ver um a um");
  });
});

describe("cartão do revisor com regra sugerida e a linha da regra", () => {
  const base = { decisaoId: "d1", pergunta: "Mandar esta mensagem no Slack?", motivo: { rotulo: "Revisor:", texto: "destino não nomeado" }, detalhe: null, sempre: null };

  it("Salvar como regra marcado, o texto editável e Permitir e salvar regra", () => {
    const html = renderCartaoRevisor({ ...base, regra: { sugestao: "Pode mandar mensagens no #produto sem perguntar", agenteId: "b1" } }, "pendente");
    expect(html).toContain("Salvar como regra");
    expect(html).toContain('data-cr-regra-marca="d1" checked');
    expect(html).toContain('value="Pode mandar mensagens no #produto sem perguntar"');
    expect(html).toContain('data-act="decidir-aprovacao-com-regra"');
    expect(html).toContain("Permitir e salvar regra");
  });

  it("sem sugestão, o cartão de antes (Aprovar), com o Esc ao lado de Negar", () => {
    const html = renderCartaoRevisor(base, "pendente");
    expect(html).toContain('data-act="decidir-aprovacao"');
    expect(html).not.toContain("Salvar como regra");
    expect(html).toContain("kbd-esc");
  });

  it("Aprovado pela sua regra · Editar", () => {
    const html = linhaDaRegra({ id: "r1", texto: "Mandar mensagens no #produto do Slack", agenteId: null }, "b1");
    expect(html).toContain("Aprovado pela sua regra · Mandar mensagens no #produto do Slack");
    expect(html).toContain('data-act="apv-editar-da-linha" data-regra="r1"');
    expect(html).toContain(">Editar<");
  });

  it("Paper 02: com a frase da ação, \"Criou 4 issues no Linear · Aprovado pela sua regra · Editar\" e a regra no title", () => {
    const html = linhaDaRegra({ id: "r1", texto: "Criar e editar issues no Linear do time NOD", agenteId: null }, "b1", "Criou 4 issues no Linear");
    expect(html).toContain(">Criou 4 issues no Linear · Aprovado pela sua regra<");
    expect(html).toContain('title="Regra: Criar e editar issues no Linear do time NOD"');
    expect(html).toContain(">Editar<");
  });
});
