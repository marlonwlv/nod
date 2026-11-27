import { describe, expect, it } from "vitest";
import { APPS_BUSCAR, APPS_USAR, ESSENCIAIS_POR_APP, ORCAMENTO_CHARS_POR_APP, TETO_DIRETAS_POR_APP } from "../../../src/contracts/catalogo-de-apps.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import { decidirAprovacao } from "../../../src/domain/aprovacao-permanente.ts";
import { buscarCapacidades, charsDaDefinicao, decidirAppsUsar, escolherDiretas, lerAppsSobDemanda, termosDaBusca, type ItemDaBusca } from "../../../src/domain/catalogo-de-apps.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { composicaoDoPlano } from "../../../src/domain/raio-x.ts";
import { semPrefixoDoApp } from "../../../src/use-cases/pedir-aprovacao.ts";

/**
 * XUM-11 (catálogo de apps sob demanda, proposta do PR #411). Um Outlook "de produção" sintético: 251 capacidades com
 * esquemas de ~2 mil caracteres (o raio-x de 27/11 mediu 513.411 caracteres para 251), as do mapa de essenciais e da
 * rotina do caso real entre elas.
 */
const AGORA = Date.UTC(2026, 10, 27, 12);
const REAIS = ["OUTLOOK_LIST_MESSAGES", "OUTLOOK_GET_MESSAGE", "OUTLOOK_SEND_EMAIL", "OUTLOOK_REPLY_EMAIL", "OUTLOOK_MOVE_MESSAGE", "OUTLOOK_LIST_MAIL_FOLDERS", "OUTLOOK_BATCH_MOVE_MESSAGES", "OUTLOOK_CREATE_DRAFT", "OUTLOOK_UPDATE_EMAIL", "OUTLOOK_FORWARD_MESSAGE", "OUTLOOK_SEARCH_MESSAGES", "OUTLOOK_QUERY_EMAILS", "OUTLOOK_LIST_EVENTS", "OUTLOOK_CALENDAR_CREATE_EVENT", "OUTLOOK_CREATE_EMAIL_RULE", "OUTLOOK_UPDATE_MAILBOX_SETTINGS", "OUTLOOK_ACCEPT_EVENT"];
const DESCRICOES: Record<string, string> = { OUTLOOK_CREATE_EMAIL_RULE: "Create a new inbox rule that moves or flags messages matching conditions.", OUTLOOK_UPDATE_MAILBOX_SETTINGS: "Update mailbox settings such as automatic replies (out of office), language and time zone.", OUTLOOK_ACCEPT_EVENT: "Accept a calendar meeting invite." };
const esquemaGrande = (nome: string) => ({ type: "object", description: DESCRICOES[nome] ?? `Outlook action ${nome.toLowerCase().replace(/_/g, " ")}.`, properties: { user_id: { type: "string", description: "x".repeat(900) }, filtro: { type: "string", description: "y".repeat(900) } }, required: [] as string[] });

function outlook(id = "k-outlook", quantas = 251, slug = "outlook"): Conector {
  const nomes = [...REAIS, ...Array.from({ length: Math.max(0, quantas - REAIS.length) }, (_, i) => `OUTLOOK_EXTRA_${String(i).padStart(3, "0")}`)].slice(0, quantas);
  return { tenantId: "t", id, ownerId: "p", visibility: "privado", nome: "Outlook", slug, transporte: "http", comando: null, args: [], url: "https://x", env: {}, declaracao: "toca", habilitado: true, catalogo: nomes.map((n) => ({ nome: n, descricao: esquemaGrande(n).description, schema: esquemaGrande(n) as never, readOnlyHint: /_(LIST|GET|SEARCH|QUERY)_/.test(`_${n}_`) })), sondadoEm: 0, ultimaFalha: null, criadoEm: 0 } as unknown as Conector;
}

function entrada(conectores: Conector[], extra: Partial<EntradaPlano> = {}, concedidas?: (c: Conector) => string[]): EntradaPlano {
  const concessoes = conectores.flatMap((k) => (concedidas ? concedidas(k) : k.catalogo.map((c) => c.nome)).map((capacidade, j) => ({ tenantId: "t", id: `${k.id}-${j}`, ownerId: "p", agenteId: "a1", conectorId: k.id, capacidade, mensagemId: "m", criadoEm: 0 })));
  const turno = { executor: "local", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: AGORA + 60_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "acessa o WhatsApp Web", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "m", criadoEm: AGORA, mensagemOrigemId: "m0" };
  const agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Lia", titulo: "", descricao: "Organiza o Outlook", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, modoAprovacao: "automatico" };
  return { turno, agente, memorias: [], concessoes, conectores, modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "x", em: AGORA }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora: AGORA, navegador: true, harness: "codex-cli", ...extra } as unknown as EntradaPlano;
}
const LIGADO = { teto: TETO_DIRETAS_POR_APP, usadas: {}, rotina: [] };
const doOutlook = (nomes: readonly { nome: string }[]) => nomes.filter((f) => f.nome.startsWith("outlook__")).map((f) => f.nome.slice("outlook__".length));
const grupoOutlook = (p: ReturnType<typeof montarPlano>) => composicaoDoPlano({ ...p, machineId: "m", tokenDeTurno: "t" }, { modo: "conversa", comTexto: false }).ferramentas.find((g) => g.grupo === "outlook");

describe("XUM-11: montarPlano com o catálogo de apps sob demanda", () => {
  it("Outlook concedido inteiro e sem histórico: até 12 diretas (as essenciais) mais apps_buscar e apps_usar; esquemas do Outlook abaixo de 30 mil caracteres", () => {
    const antes = montarPlano(entrada([outlook()]));
    const depois = montarPlano(entrada([outlook()], { appsSobDemanda: LIGADO }));
    expect(doOutlook(antes.catalogo.ferramentas)).toHaveLength(251);
    expect(grupoOutlook(antes)!.chars).toBeGreaterThan(500_000);
    const diretas = doOutlook(depois.catalogo.ferramentas);
    expect(diretas.length).toBeLessThanOrEqual(TETO_DIRETAS_POR_APP);
    expect(diretas.every((d) => ESSENCIAIS_POR_APP.outlook!.includes(d))).toBe(true);
    expect(diretas.slice(0, 3)).toEqual(["OUTLOOK_LIST_MESSAGES", "OUTLOOK_GET_MESSAGE", "OUTLOOK_SEND_EMAIL"]);
    expect(depois.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining([APPS_BUSCAR, APPS_USAR]));
    expect(grupoOutlook(depois)!.chars).toBeLessThan(30_000);
    expect(grupoOutlook(depois)!.sobDemanda).toBe(251 - diretas.length);
    // Nada some: diretas + sob demanda = o que foi concedido.
    expect(diretas.length + (depois.catalogo.sobDemanda ?? []).length).toBe(251);
  });

  it("o prompt vira uma linha por app (contagens), sem as listas de nomes, em qualquer harness", () => {
    for (const harness of ["codex-cli", "claude-cli"] as const) {
      const antes = montarPlano(entrada([outlook()], { harness }));
      const depois = montarPlano(entrada([outlook()], { harness, appsSobDemanda: LIGADO }));
      expect(antes.promptSistema).toContain("OUTLOOK_EXTRA_100");
      expect(depois.promptSistema).not.toContain("OUTLOOK_EXTRA_100");
      expect(depois.promptSistema).not.toContain("concedidas_a_voce");
      expect(depois.promptSistema).toContain("\"slug\":\"outlook\",\"habilitado\":true,\"na_lista\":");
      expect(depois.promptSistema).toContain("ache com apps_buscar");
      // Os 251 nomes de concedidas_a_voce (~5 mil caracteres) saem; outras_do_app já vinha vazia (tudo concedido).
      expect(depois.promptSistema.length).toBeLessThan(antes.promptSistema.length - 4_000);
    }
  });

  it("com histórico: as usadas nos últimos 30 dias entram primeiro (das mais usadas)", () => {
    const p = montarPlano(entrada([outlook()], { appsSobDemanda: { ...LIGADO, usadas: { "k-outlook": ["OUTLOOK_CREATE_EMAIL_RULE", "OUTLOOK_EXTRA_007"] } } }));
    expect(doOutlook(p.catalogo.ferramentas)).toEqual(expect.arrayContaining(["OUTLOOK_CREATE_EMAIL_RULE", "OUTLOOK_EXTRA_007"]));
    // Sem o histórico, as duas ficariam sob demanda.
    expect(doOutlook(montarPlano(entrada([outlook()], { appsSobDemanda: LIGADO })).catalogo.ferramentas)).not.toContain("OUTLOOK_EXTRA_007");
  });

  it("na rotina: as capacidades dela vão diretas, mesmo acima do teto", () => {
    const rotina = Array.from({ length: 14 }, (_, i) => `OUTLOOK_EXTRA_${String(i).padStart(3, "0")}`);
    const p = montarPlano(entrada([outlook()], { appsSobDemanda: { ...LIGADO, rotina: [{ conector: "outlook", capacidades: ["OUTLOOK_LIST_MESSAGES", "OUTLOOK_LIST_MAIL_FOLDERS", "OUTLOOK_BATCH_MOVE_MESSAGES", ...rotina] }] } }));
    expect(doOutlook(p.catalogo.ferramentas)).toEqual(expect.arrayContaining(["OUTLOOK_LIST_MESSAGES", "OUTLOOK_LIST_MAIL_FOLDERS", "OUTLOOK_BATCH_MOVE_MESSAGES", ...rotina]));
  });

  it("desligado (sem appsSobDemanda): o plano e o prompt são os de antes, byte a byte", () => {
    const a = montarPlano(entrada([outlook()]));
    const b = montarPlano(entrada([outlook()], { appsSobDemanda: null }));
    expect(b.promptSistema).toBe(a.promptSistema);
    expect(b.catalogo).toEqual(a.catalogo);
    expect(a.catalogo.sobDemanda).toBeUndefined();
    expect(a.catalogo.ferramentas.some((f) => f.origem === "apps")).toBe(false);
  });

  it("app pequeno vai inteiro, sem apps_buscar nem apps_usar (a busca custaria mais que economiza)", () => {
    const p = montarPlano(entrada([outlook("k1", 15)], { appsSobDemanda: LIGADO }));
    expect(doOutlook(p.catalogo.ferramentas)).toHaveLength(15);
    expect(p.catalogo.sobDemanda).toBeUndefined();
    expect(p.catalogo.ferramentas.some((f) => f.origem === "apps")).toBe(false);
  });

  it("app inteiro mas com capacidades sem acesso: só apps_buscar entra (acha o nome exato para pedir_acesso), sem apps_usar", () => {
    const p = montarPlano(entrada([outlook("k1", 40)], { appsSobDemanda: LIGADO }, (c) => c.catalogo.slice(0, 10).map((x) => x.nome)));
    const nomes = p.catalogo.ferramentas.map((f) => f.nome);
    expect(nomes).toContain(APPS_BUSCAR);
    expect(nomes).not.toContain(APPS_USAR);
  });

  it("'Sempre permitir' vale para a capacidade sob demanda (o plano leva a regra)", () => {
    const p = montarPlano(entrada([outlook()], { appsSobDemanda: LIGADO, semprePermitir: ["outlook__OUTLOOK_EXTRA_050"] }));
    expect(p.catalogo.sobDemanda?.some((f) => f.nome === "outlook__OUTLOOK_EXTRA_050")).toBe(true);
    expect(p.semprePermitir).toEqual(["outlook__OUTLOOK_EXTRA_050"]);
  });

  it("a pedido de outra pessoa nenhuma ferramenta de app nem do catálogo entra", () => {
    const e = entrada([outlook()], { appsSobDemanda: LIGADO });
    const p = montarPlano({ ...e, turno: { ...e.turno, sobProcuracaoDe: "outra" } } as EntradaPlano);
    expect(p.catalogo.ferramentas.some((f) => f.origem === "conector" || f.origem === "apps")).toBe(false);
    expect(p.catalogo.sobDemanda).toBeUndefined();
  });

  it("duas contas do mesmo app: cada uma escolhe as próprias diretas (o mapa vale pelo app)", () => {
    const p = montarPlano(entrada([outlook("k1"), outlook("k2", 251, "outlook--pessoal")], { appsSobDemanda: LIGADO }));
    const pessoal = p.catalogo.ferramentas.filter((f) => f.nome.startsWith("outlook--pessoal__"));
    expect(pessoal.length).toBeGreaterThan(0);
    expect(pessoal.length).toBeLessThanOrEqual(TETO_DIRETAS_POR_APP);
  });

  it("a decisão de aprovação acha a capacidade sob demanda no plano (leitura do app sai sem pergunta, como a direta)", () => {
    const p = montarPlano(entrada([outlook()], { appsSobDemanda: LIGADO }));
    const d = decidirAprovacao({ plano: p, destino: { conector: "outlook", ferramenta: "OUTLOOK_GET_MESSAGE_EXTRA" as string, argumentos: {} }, origemSensivel: false, modo: "manual", contaminado: false, nivel: null as never });
    expect(d).toMatchObject({ automatico: false, motivo: "fora_do_catalogo" });
    const leitura = p.catalogo.sobDemanda!.find((f) => f.readOnlyHint)!;
    const ok = decidirAprovacao({ plano: p, destino: { conector: "outlook", ferramenta: leitura.nome.slice("outlook__".length), argumentos: {} }, origemSensivel: false, modo: "manual", contaminado: false, nivel: null as never });
    expect(ok).toMatchObject({ automatico: true });
  });
});

describe("XUM-11: escolha das diretas", () => {
  const caps = outlook().catalogo.map((c) => ({ nome: `outlook__${c.nome}`, nomeMcp: `mcp__nod__outlook__${c.nome}` as const, origem: "conector" as const, conectorId: "k", readOnlyHint: c.readOnlyHint, tocaDadoPessoal: true, schema: c.schema }));
  it("respeita o orçamento de caracteres: a que não cabe é pulada e a seguinte, menor, ainda entra", () => {
    const grandes = caps.map((c) => (c.nome.endsWith("_GET_MESSAGE") ? { ...c, schema: { ...c.schema, description: "z".repeat(ORCAMENTO_CHARS_POR_APP) } } : c));
    const d = escolherDiretas({ app: "outlook", caps: grandes, rotina: [], usadas: [], teto: 12 });
    expect(d.has("OUTLOOK_GET_MESSAGE")).toBe(false);
    expect(d.has("OUTLOOK_SEND_EMAIL")).toBe(true);
    const total = [...d].reduce((s, n) => s + charsDaDefinicao(grandes.find((c) => c.nome === `outlook__${n}`)!), 0);
    expect(total).toBeLessThanOrEqual(ORCAMENTO_CHARS_POR_APP);
  });
  it("sem mapa: as de leitura mais genéricas pelo nome", () => {
    const d = escolherDiretas({ app: "app_sem_mapa", caps, rotina: [], usadas: [], teto: 12 });
    expect(d.size).toBeGreaterThan(0);
    expect([...d].every((n) => /_(LIST|GET|SEARCH|QUERY)_/.test(`_${n}_`))).toBe(true);
  });
});

describe("XUM-11: busca (apps_buscar)", () => {
  const itens: ItemDaBusca[] = outlook().catalogo.map((c) => ({ ferramenta: `outlook__${c.nome}`, descricao: c.descricao, schema: c.schema, concedida: true, direta: false }));
  it.each([
    ["criar uma regra para mover e-mails de um remetente para uma pasta", "outlook__OUTLOOK_CREATE_EMAIL_RULE"],
    ["create inbox rule", "outlook__OUTLOOK_CREATE_EMAIL_RULE"],
    ["resposta automática de férias", "outlook__OUTLOOK_UPDATE_MAILBOX_SETTINGS"],
    ["aceitar convite de reunião", "outlook__OUTLOOK_ACCEPT_EVENT"],
  ])("'%s' acha %s entre os 3 primeiros", (busca, esperado) => {
    const r = buscarCapacidades({ busca, itens });
    expect(r.resultados.slice(0, 3).map((x) => x.ferramenta)).toContain(esperado);
  });
  it("o filtro de app vale pelo slug e pelo app da conta; concedida vem antes de não concedida no empate", () => {
    const misturados: ItemDaBusca[] = [{ ferramenta: "gmail__GMAIL_SEND_EMAIL", descricao: "Send an email", schema: null, concedida: false, direta: false }, { ferramenta: "outlook--pessoal__OUTLOOK_SEND_EMAIL", descricao: "Send an email", schema: null, concedida: true, direta: false }];
    expect(buscarCapacidades({ busca: "enviar email", itens: misturados }).resultados[0]!.ferramenta).toBe("outlook--pessoal__OUTLOOK_SEND_EMAIL");
    expect(buscarCapacidades({ busca: "enviar email", app: "outlook", itens: misturados }).resultados.map((x) => x.ferramenta)).toEqual(["outlook--pessoal__OUTLOOK_SEND_EMAIL"]);
  });
  it("'não lidos' vira unread, e busca só com palavras vazias não acha nada", () => {
    expect(termosDaBusca("e-mails não lidos").flat()).toContain("unread");
    expect(buscarCapacidades({ busca: "de para com", itens }).resultados).toEqual([]);
  });
});

describe("XUM-11: apps_usar decide antes do portão", () => {
  const p = montarPlano(entrada([outlook()], { appsSobDemanda: LIGADO }));
  it("acha pelo nome inteiro e pela capacidade; ambígua entre duas contas pede o nome inteiro", () => {
    expect(decidirAppsUsar({ plano: p, conectores: [], pedida: "outlook__OUTLOOK_EXTRA_010", argumentos: {} })).toMatchObject({ chamar: { nome: "outlook__OUTLOOK_EXTRA_010" } });
    expect(decidirAppsUsar({ plano: p, conectores: [], pedida: "OUTLOOK_EXTRA_010", argumentos: {} })).toMatchObject({ chamar: { nome: "outlook__OUTLOOK_EXTRA_010" } });
    const duas = montarPlano(entrada([outlook("k1"), outlook("k2", 251, "outlook--pessoal")], { appsSobDemanda: LIGADO }));
    expect(decidirAppsUsar({ plano: duas, conectores: [], pedida: "OUTLOOK_EXTRA_010", argumentos: {} })).toMatchObject({ resposta: { erro: "ambigua" }, recusa: null });
  });

  it("o prefixo pedido vale: a conta nomeada sem a capacidade não cai na outra conta, nem em outro app (revisão do PR #413)", () => {
    const trabalho = outlook("k1");
    const pessoal = outlook("k2", 251, "outlook--pessoal");
    // A conta "outlook" só tem as reais; a pessoal, tudo. Pedir pela "outlook" a que só a pessoal tem é sem_acesso na "outlook".
    const duas = montarPlano(entrada([trabalho, pessoal], { appsSobDemanda: LIGADO }, (k) => (k.id === "k1" ? REAIS : k.catalogo.map((c) => c.nome))));
    expect(decidirAppsUsar({ plano: duas, conectores: [trabalho, pessoal], pedida: "outlook__OUTLOOK_EXTRA_010", argumentos: {} })).toMatchObject({ resposta: { erro: "sem_acesso", ferramenta: "outlook__OUTLOOK_EXTRA_010" }, recusa: { conectorId: "k1" } });
    // Outro app com a mesma capacidade nunca é o alvo (MCP próprio com nomes genéricos como send_message).
    expect(decidirAppsUsar({ plano: duas, conectores: [trabalho, pessoal], pedida: "slack__OUTLOOK_EXTRA_010", argumentos: {} })).toMatchObject({ resposta: { erro: "nao_encontrada" } });
    // O nome do app sem a conta, quando não há conector com esse slug, ainda acha a única conta do app que a tem.
    const soPessoal = montarPlano(entrada([pessoal], { appsSobDemanda: LIGADO }));
    expect(decidirAppsUsar({ plano: soPessoal, conectores: [pessoal], pedida: "outlook__OUTLOOK_EXTRA_010", argumentos: {} })).toMatchObject({ chamar: { nome: "outlook--pessoal__OUTLOOK_EXTRA_010" } });
  });
});

describe("XUM-11: interruptor e nome no pedir_aprovacao", () => {
  it("ligado por padrão; NOD_APPS_SOB_DEMANDA=0 desliga; teto inválido cai no padrão", () => {
    expect(lerAppsSobDemanda({})).toEqual({ teto: 12 });
    expect(lerAppsSobDemanda({ NOD_APPS_SOB_DEMANDA: "0" })).toBeNull();
    expect(lerAppsSobDemanda({ NOD_APPS_DIRETAS_TETO: "8" })).toEqual({ teto: 8 });
    expect(lerAppsSobDemanda({ NOD_APPS_DIRETAS_TETO: "abc" })).toEqual({ teto: 12 });
  });
  it("o destino com o nome inteiro (como apps_buscar mostra) vira a capacidade", () => {
    expect(semPrefixoDoApp("outlook", "outlook__OUTLOOK_CREATE_EMAIL_RULE")).toBe("OUTLOOK_CREATE_EMAIL_RULE");
    expect(semPrefixoDoApp("outlook", "OUTLOOK_CREATE_EMAIL_RULE")).toBe("OUTLOOK_CREATE_EMAIL_RULE");
    expect(semPrefixoDoApp("gmail", "outlook__X")).toBe("outlook__X");
  });
});

describe("XUM-11: o validador de argumentos não cai com esquema torto vindo do app", () => {
  it("enum e required que não são lista são ignorados (antes: TypeError e a chamada caía)", async () => {
    const { errosDoSchema } = await import("../../../src/domain/schema-args.ts");
    const torto = { type: "object", properties: { modo: { type: "string", enum: "$undefined" }, sub: { type: "object", required: false, properties: { x: { type: "string", required: true } } } } } as never;
    expect(() => errosDoSchema(torto, { modo: "a", sub: { x: "b" } })).not.toThrow();
    expect(errosDoSchema(torto, { modo: "a", sub: {} })).toEqual([]);
  });
});
