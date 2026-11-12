import { describe, expect, it } from "vitest";
import type { NivelDeFerramenta, RegraRevisor } from "../../../src/contracts/ajustes-aprovacao.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import {
  barradoDeAntemao,
  CARACTERES_POR_REGRA,
  conferirNovaRegra,
  limparTextoDaRegra,
  modoEfetivo,
  nivelDaFerramenta,
  REGRAS_POR_LISTA,
  regraSugeridaDaFrase,
  regrasQueValem,
  soLeituraEfetivo,
  tetoMaisFechado,
} from "../../../src/domain/ajustes-aprovacao.ts";
import { decidirAprovacao, decidirLote, REGRA_APROVACAO_PERMANENTE, type EntradaAprovacao } from "../../../src/domain/aprovacao-permanente.ts";
import { decidirPeloModo, gatilhoDeRevisao } from "../../../src/domain/modo-aprovacao.ts";
import { lerVeredito, pedidoDoRevisor, PROMPT_REVISOR, ESQUEMA_VEREDITO, type EntradaRevisor } from "../../../src/domain/revisor.ts";

/** ADR-166: Ajustes > Aprovações — regras em texto do revisor, níveis por ferramenta, só leitura e teto do admin. */

const regra = (id: string, lista: RegraRevisor["lista"], texto: string, agenteId: string | null = null, criadoEm = 1): RegraRevisor => ({ id, agenteId, lista, texto, origem: "pessoa", criadoEm });

describe("regras em texto do revisor: limites da tela (20 por lista, 1000 caracteres)", () => {
  it("limpa invisíveis e espaços, recusa vazio e acima de 1000", () => {
    expect(limparTextoDaRegra("  Pode​  comentar\nem PRs  ")).toBe("Pode comentar em PRs");
    expect(limparTextoDaRegra("   ")).toBeNull();
    expect(limparTextoDaRegra("a".repeat(CARACTERES_POR_REGRA))).toHaveLength(CARACTERES_POR_REGRA);
    expect(limparTextoDaRegra("a".repeat(CARACTERES_POR_REGRA + 1))).toBeNull();
    expect(limparTextoDaRegra(42)).toBeNull();
  });

  it("a 21ª regra da mesma lista não entra; a repetida (sem caixa, acento nem ponto final) também não", () => {
    const cheias = Array.from({ length: REGRAS_POR_LISTA }, (_, i) => ({ id: `r${i}`, texto: `Regra ${i}` }));
    expect(conferirNovaRegra(cheias, "Mais uma")).toEqual({ ok: false, erro: "lista_cheia" });
    expect(conferirNovaRegra([{ id: "a", texto: "Mandar mensagens no #produto" }], "mandar MENSAGENS no #produto.")).toEqual({ ok: false, erro: "repetida" });
    expect(conferirNovaRegra([{ id: "a", texto: "Pedir revisão" }], "Péd́ir revisão")).toEqual({ ok: false, erro: "repetida" });
    expect(conferirNovaRegra([], "")).toEqual({ ok: false, erro: "texto_invalido" });
  });

  it("editar não conta a própria regra como repetida nem como a 21ª", () => {
    const cheias = Array.from({ length: REGRAS_POR_LISTA }, (_, i) => ({ id: `r${i}`, texto: `Regra ${i}` }));
    expect(conferirNovaRegra(cheias, "Regra 3 nova", "r3")).toEqual({ ok: true, texto: "Regra 3 nova" });
    expect(conferirNovaRegra(cheias, "Regra 3", "r3")).toEqual({ ok: true, texto: "Regra 3" });
  });

  it("valem as do padrão e as do bot, na ordem de criação, sem repetir a mesma frase; as de outro bot não", () => {
    const todas = [
      regra("p1", "permitir", "Comentar em PRs", null, 1),
      regra("b1", "permitir", "Rodar testes nas worktrees", "bot-a", 2),
      regra("b2", "permitir", "comentar em prs.", "bot-a", 3),
      regra("o1", "perguntar", "Apagar qualquer coisa", "bot-b", 4),
      regra("p2", "perguntar", "Qualquer pagamento", null, 5),
    ];
    const v = regrasQueValem(todas, "bot-a");
    expect(v.permitir.map((r) => r.id)).toEqual(["p1", "b1"]);
    expect(v.perguntar.map((r) => r.id)).toEqual(["p2"]);
  });
});

describe("nível por ferramenta: do mais específico ao padrão, e o revisor decide sem linha", () => {
  const n = (agenteId: string | null, ferramenta: string, tipo: NivelDeFerramenta["tipo"], nivel: NivelDeFerramenta["nivel"]): NivelDeFerramenta => ({ agenteId, conector: "slack", ferramenta, tipo, nivel });
  const niveis = [n(null, "", "escrita", "sempre_pedir"), n(null, "send_message", "escrita", "sempre_permitir"), n("bot-a", "", "escrita", "bloqueado"), n("bot-a", "send_message", "escrita", "revisor")];

  it("bot + ferramenta > bot + app > padrão + ferramenta > padrão + app > revisor", () => {
    expect(nivelDaFerramenta(niveis, "bot-a", "slack", "send_message", "escrita")).toBe("revisor");
    expect(nivelDaFerramenta(niveis, "bot-a", "slack", "delete", "escrita")).toBe("bloqueado");
    expect(nivelDaFerramenta(niveis, "bot-b", "slack", "send_message", "escrita")).toBe("sempre_permitir");
    expect(nivelDaFerramenta(niveis, "bot-b", "slack", "delete", "escrita")).toBe("sempre_pedir");
    expect(nivelDaFerramenta(niveis, "bot-b", "slack", "search", "leitura")).toBe("revisor");
    expect(nivelDaFerramenta(niveis, "bot-b", "gmail", "send", "escrita")).toBe("revisor");
  });

  it("bloqueado nega sempre; o só leitura nega só a escrita", () => {
    expect(barradoDeAntemao("bloqueado", false, true)).toBe("bloqueado");
    expect(barradoDeAntemao("revisor", true, false)).toBe("so_leitura");
    expect(barradoDeAntemao("sempre_permitir", true, true)).toBeNull();
    expect(barradoDeAntemao("sempre_permitir", false, false)).toBeNull();
  });
});

describe("teto do admin: o modo pedido × o efetivo", () => {
  it("corta o que passa do teto e mantém o que está abaixo", () => {
    expect(modoEfetivo("total", "automatico")).toBe("automatico");
    expect(modoEfetivo("total", "manual")).toBe("manual");
    expect(modoEfetivo("automatico", "manual")).toBe("manual");
    expect(modoEfetivo("manual", "automatico")).toBe("manual");
    expect(modoEfetivo("total", null)).toBe("total");
    expect(modoEfetivo("automatico", "so_leitura")).toBe("manual");
  });

  it("o teto só leitura liga o só leitura de todo bot; entre vários tetos vale o mais fechado", () => {
    expect(soLeituraEfetivo(false, "so_leitura")).toBe(true);
    expect(soLeituraEfetivo(false, "manual")).toBe(false);
    expect(soLeituraEfetivo(true, null)).toBe(true);
    expect(tetoMaisFechado(["automatico", "manual"])).toBe("manual");
    expect(tetoMaisFechado(["automatico", "so_leitura", "manual"])).toBe("so_leitura");
    expect(tetoMaisFechado([])).toBeNull();
  });
});

describe("a regra pronta que o cartão sugere, da frase da ação", () => {
  it("vira 'Pode … sem perguntar'", () => {
    expect(regraSugeridaDaFrase("Mandar mensagem no #produto?")).toBe("Pode mandar mensagem no #produto sem perguntar");
    expect(regraSugeridaDaFrase(null)).toBeNull();
    expect(regraSugeridaDaFrase("ok?")).toBeNull();
  });
});

describe("Sempre me pergunte: o envio limpo vai ao revisor (gatilho regra_da_pessoa)", () => {
  it("sem regras, o envio num turno limpo roda; com regras de perguntar, vai ao revisor", () => {
    expect(gatilhoDeRevisao({ arriscada: false, credencial: false, envioParaFora: true, contaminado: false })).toBeNull();
    expect(gatilhoDeRevisao({ arriscada: false, credencial: false, envioParaFora: true, contaminado: false, regrasDePerguntar: true })).toBe("regra_da_pessoa");
    expect(gatilhoDeRevisao({ arriscada: true, credencial: false, envioParaFora: true, contaminado: false, regrasDePerguntar: true })).toBe("arriscado");
    expect(gatilhoDeRevisao({ arriscada: false, credencial: true, envioParaFora: true, contaminado: false, regrasDePerguntar: true })).toBe("credencial");
  });

  it("só com o revisor ligado: desligado, as regras não mudam nada (a decisão de antes)", () => {
    const s = { arriscada: false, credencial: false, envioParaFora: true, contaminado: false, regrasDePerguntar: true };
    expect(decidirPeloModo("automatico", s, false)).toMatchObject({ automatico: true });
    expect(decidirPeloModo("automatico", s, true)).toEqual({ revisar: true, gatilho: "regra_da_pessoa" });
    expect(decidirPeloModo("manual", s, true)).toBeNull();
    expect(decidirPeloModo("total", s, true)).toMatchObject({ automatico: true });
  });
});

const schema = { type: "object" as const, properties: {}, required: [], additionalProperties: false };
const ferramenta = (nome: string, extra: Partial<FerramentaPlano> = {}): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: "c1", readOnlyHint: false, tocaDadoPessoal: false, schema, ...extra });
const plano = (extra: Partial<NonNullable<EntradaAprovacao["plano"]>> = {}): NonNullable<EntradaAprovacao["plano"]> => ({
  catalogo: { ferramentas: [ferramenta("slack__send_message"), ferramenta("slack__search", { readOnlyHint: true })], servidores: [] },
  politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 10_000 },
  confiancaEntrada: "confiavel",
  semprePermitir: [],
  ...extra,
});
const enviar = { conector: "slack", ferramenta: "send_message", argumentos: {} };
const buscar = { conector: "slack", ferramenta: "search", argumentos: {} };

describe("decidirAprovacao com o nível da pessoa", () => {
  it("sem nível, a decisão de antes (byte a byte)", () => {
    expect(decidirAprovacao({ plano: plano(), destino: enviar, origemSensivel: false, modo: "manual" })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
    expect(decidirAprovacao({ plano: plano(), destino: buscar, origemSensivel: false })).toMatchObject({ automatico: true });
  });

  it("Sempre pedir pede até na leitura e no total", () => {
    expect(decidirAprovacao({ plano: plano(), destino: buscar, origemSensivel: false, nivel: "sempre_pedir" })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
    expect(decidirAprovacao({ plano: plano(), destino: enviar, origemSensivel: false, modo: "total", nivel: "sempre_pedir" })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
  });

  it("Sempre permitir vale como o clique do cartão: no manual num turno limpo; depois de conteúdo de fora, o modo decide", () => {
    expect(decidirAprovacao({ plano: plano(), destino: enviar, origemSensivel: false, modo: "manual", nivel: "sempre_permitir" })).toMatchObject({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE });
    expect(decidirAprovacao({ plano: plano({ confiancaEntrada: "nao_confiavel" }), destino: enviar, origemSensivel: false, modo: "manual", nivel: "sempre_permitir" })).toEqual({ automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" });
  });

  it("Bloqueado nunca roda, em nenhum modo (quem chama nega antes; aqui é a rede)", () => {
    for (const modo of ["manual", "automatico", "total"] as const) {
      expect(decidirAprovacao({ plano: plano(), destino: enviar, origemSensivel: false, modo, nivel: "bloqueado" })).toMatchObject({ automatico: false });
      expect(decidirAprovacao({ plano: plano(), destino: buscar, origemSensivel: false, modo, nivel: "bloqueado" })).toMatchObject({ automatico: false });
    }
  });

  it("o lote com regras de perguntar vai ao revisor como regra_da_pessoa", () => {
    const e = { plano: plano(), destino: enviar, origemSensivel: false, modo: "automatico" as const, revisor: true, envioParaFora: true, contaminadoParaRevisor: false, regrasDePerguntar: true };
    expect(decidirLote([e, e]).revisar).toBe("regra_da_pessoa");
  });
});

describe("o revisor recebe as regras e cita a que usou", () => {
  const base: EntradaRevisor = {
    acao: { tipo: "app", app: "slack", ferramenta: "send_message", argumentos: { channel: "#produto", text: "PR #488 pronto" } },
    gatilho: "regra_da_pessoa",
    risco: "muda algo fora do nod",
    origem: "conversa",
    contaminado: false,
    mensagensDaPessoa: ["avisa o time"],
    bot: { nome: "Dante", titulo: "Dev", descricao: "" },
    jaPediuNoTurno: 0,
    marca: "MarcaDeTeste_0123456789AB",
    regras: { permitir: ["Mandar mensagens no #produto do Slack"], perguntar: ["Mandar e-mail para fora da empresa"] },
  };

  it("as regras vão na parte CONFIÁVEL, antes do dado, numeradas A1… e P1…", () => {
    const p = pedidoDoRevisor(base);
    if (p.tipo !== "pedido") throw new Error("esperava pedido");
    const [confiavel = ""] = p.entrada.split("NÃO CONFIÁVEL\n");
    expect(confiavel).toContain("A1. Mandar e-mail para fora da empresa");
    expect(confiavel).toContain("P1. Mandar mensagens no #produto do Slack");
    expect(PROMPT_REVISOR).toContain("Sempre me pergunte");
  });

  it("sem regras, o pedido é o de antes", () => {
    const sem = pedidoDoRevisor({ ...base, regras: undefined });
    const vazias = pedidoDoRevisor({ ...base, regras: { permitir: [], perguntar: [] } });
    expect(sem).toEqual(vazias);
  });

  it("o veredito novo traz a regra citada e a sugestão; o de antes (duas chaves) continua valendo", () => {
    expect(lerVeredito('{"decisao":"libera","motivo":"A regra P1 deixa","regra":"P1","sugestao":""}')).toEqual({ decisao: "libera", motivo: "A regra P1 deixa", regra: { lista: "permitir", indice: 0 }, sugestao: null });
    expect(lerVeredito('{"decisao":"pede","motivo":"Destino não nomeado","regra":"","sugestao":"Pode mandar mensagens no #produto"}')).toEqual({ decisao: "pede", motivo: "Destino não nomeado", regra: null, sugestao: "Pode mandar mensagens no #produto" });
    expect(lerVeredito('{"decisao":"pede","motivo":"Bate com A2","regra":"a2","sugestao":""}')?.regra).toEqual({ lista: "perguntar", indice: 1 });
    expect(lerVeredito('{"decisao":"libera","motivo":"ok"}')).toEqual({ decisao: "libera", motivo: "ok" });
    expect(lerVeredito('{"decisao":"libera","motivo":"ok","regra":"P1"}')).toBeNull();
    expect(lerVeredito('{"decisao":"libera","motivo":"ok","regra":3,"sugestao":""}')).toBeNull();
    expect(ESQUEMA_VEREDITO.required).toEqual(["decisao", "motivo", "regra", "sugestao"]);
  });

  it("a sugestão só vale no pede", () => {
    expect(lerVeredito('{"decisao":"libera","motivo":"ok","regra":"","sugestao":"Pode tudo"}')?.sugestao).toBeNull();
  });
});
