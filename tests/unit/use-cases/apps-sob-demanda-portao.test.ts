import { describe, expect, it } from "vitest";
import { FERRAMENTA_APPS_BUSCAR, FERRAMENTA_APPS_USAR } from "../../../src/contracts/catalogo-de-apps.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano, PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { chamarFerramenta } from "../../../src/use-cases/chamar-ferramenta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { depsFalsos } from "./deps-l5.ts";

/**
 * XUM-11 (catálogo de apps sob demanda): contrato do portão. apps_usar chama a capacidade sob demanda pelo MESMO caminho
 * da ferramenta direta (concessão lida agora, decisão de aprovação, "Sempre permitir", schema, trilha, conteúdo de fora)
 * e não é atalho de permissão: o que não é do bot continua indo por pedir_acesso, e nada além de app passa por ele.
 */
const AGORA = 1_758_000_000_000;
const nod = (nome: keyof typeof FERRAMENTAS_NOD): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] });
const SOMAR = { type: "object", description: "Soma dois números", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } as const;
const ENVIAR = { type: "object", description: "Envia uma mensagem", properties: { para: { type: "string" } }, required: ["para"] } as const;

async function cenario(opcoes: { sobProcuracaoDe?: string } = {}) {
  const { deps, banco, chamadas } = depsFalsos({ agora: AGORA });
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  await deps.repos.agentes.definirModoAprovacao(agente?.id ?? "", "manual");
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const conector = await deps.repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const conectorId = conector?.id ?? "";
  await deps.repos.conectores.registrarSonda(conectorId, {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "somar", descricao: "Soma dois números", schema: SOMAR, readOnlyHint: true },
      { nome: "enviar", descricao: "Envia uma mensagem", schema: ENVIAR, readOnlyHint: false },
      { nome: "apagar_tudo", descricao: "Apaga todas as mensagens", schema: { type: "object" }, readOnlyHint: false },
    ],
  });
  const consentimento = await deps.repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: { autor_tipo: "pessoa", autor_id: deps.escopo.pessoaId, sob_procuracao_de: null, conta_de_execucao: deps.escopo.pessoaId, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "consentimento", texto: "ok", confianca: "confiavel" });
  await deps.repos.concessoes.conceder({ agenteId: agente?.id ?? "", conectorId, capacidade: "somar", mensagemId: consentimento?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  await deps.repos.turnos.reivindicar({ machineId: "m1", agora: AGORA });
  const turnoId = turno?.id ?? "";
  const agenteId = agente?.id ?? "";
  const app = (nome: "somar" | "enviar", schema: typeof SOMAR | typeof ENVIAR, readOnlyHint: boolean): FerramentaPlano => ({ nome: `exemplo__${nome}`, nomeMcp: `mcp__nod__exemplo__${nome}`, origem: "conector", conectorId, readOnlyHint, tocaDadoPessoal: false, schema });
  const base = planoDeTeste({ turnoId, agenteId, conversaId: conversa?.id ?? "", expiraEm: AGORA + 60_000, catalogo: { ferramentas: [], servidores: [] } });
  // As duas capacidades ficam SOB DEMANDA: fora da lista do modelo, só pelo apps_usar.
  const plano: PlanoTurno = {
    ...base,
    ...(opcoes.sobProcuracaoDe ? { autoria: { ...base.autoria, sob_procuracao_de: opcoes.sobProcuracaoDe } } : {}),
    catalogo: { ferramentas: [nod("lembrar"), nod("pedir_aprovacao"), FERRAMENTA_APPS_BUSCAR, FERRAMENTA_APPS_USAR], servidores: [{ conectorId, nome: "exemplo", trust: "untrusted", transporte: "stdio" }], sobDemanda: [app("somar", SOMAR, true), app("enviar", ENVIAR, false)] },
  };
  const chamar = (nome: string, argumentos: unknown, p: PlanoTurno = plano) => chamarFerramenta(deps as Deps, { turnoId, agenteId, nome, argumentos, plano: p });
  const trilha = () => banco.trilha.map((l) => [l.kind, l.ferramenta, l.motivo] as const);
  const conceder = (capacidade: string) => deps.repos.concessoes.conceder({ agenteId, conectorId, capacidade, mensagemId: consentimento?.id ?? "" });
  return { deps, banco, chamadas, chamar, trilha, conceder, plano, agenteId, conectorId, consentimentoId: consentimento?.id ?? "", turnoAtual: () => banco.turnos.find((t) => t.id === turnoId) };
}

describe("XUM-11: apps_usar passa pelo mesmo portão da ferramenta direta", () => {
  it("a capacidade sob demanda concedida roda como a direta: conector chamado, conteúdo não confiável, trilha com o nome da capacidade", async () => {
    const c = await cenario();
    const r = await c.chamar("apps_usar", { ferramenta: "exemplo__somar", argumentos: { a: 2, b: 3 } });
    expect(r.data).toEqual({ ok: true, conteudo: "ok:somar", confianca: "nao_confiavel" });
    expect(c.chamadas).toEqual([{ conectorId: c.conectorId, tool: "somar", args: { a: 2, b: 3 } }]);
    // O histórico de uso (as diretas do próximo turno) lê esta linha: a capacidade, não "apps_usar".
    expect(c.trilha()).toEqual([["tool_call", "exemplo__somar", null]]);
    expect(c.banco.trilha[0]?.conectorId).toBe(c.conectorId);
  });

  it("aceita só a capacidade (sem o prefixo) quando um único app a tem", async () => {
    const c = await cenario();
    expect((await c.chamar("apps_usar", { ferramenta: "somar", argumentos: { a: 1, b: 1 } })).data).toMatchObject({ ok: true, conteudo: "ok:somar" });
  });

  it("não fura a concessão: a sob demanda sem concessão AGORA (revogada no meio do turno) é capacidade_desligada terminal, como a direta", async () => {
    const c = await cenario();
    const r = await c.chamar("apps_usar", { ferramenta: "exemplo__enviar", argumentos: { para: "x" } });
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada", terminal: true } });
    expect(c.chamadas).toHaveLength(0);
    expect(c.trilha()).toEqual([["negacao", "exemplo__enviar", "capacidade_desligada"]]);
  });

  it("não fura a aprovação: no manual a escrita sob demanda volta com 'peça aprovação'; com 'Sempre permitir' ativa ou no automático, roda", async () => {
    const c = await cenario();
    await c.conceder("enviar");
    expect((await c.chamar("apps_usar", { ferramenta: "exemplo__enviar", argumentos: { para: "x" } })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(c.chamadas).toHaveLength(0);
    // A regra da pessoa vale para a sob demanda (semprePermitirVivo olha também catalogo.sobDemanda).
    const regra = await c.deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", itemOrigemId: "i", mensagemId: c.consentimentoId, regraVersao: 1 });
    expect((await c.chamar("apps_usar", { ferramenta: "exemplo__enviar", argumentos: { para: "x" } })).data).toMatchObject({ ok: true });
    await c.deps.repos.permissoesPermanentes.desativar(regra?.id ?? "", "revogada_pela_pessoa", 0);
    expect((await c.chamar("apps_usar", { ferramenta: "exemplo__enviar", argumentos: { para: "x" } })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("apps_usar", { ferramenta: "exemplo__enviar", argumentos: { para: "x" } })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["enviar", "enviar"]);
  });

  it("capacidade que existe no app mas não é do bot volta com a instrução de pedir_acesso, sem rodar e SEM encerrar o turno", async () => {
    const c = await cenario();
    const r = await c.chamar("apps_usar", { ferramenta: "exemplo__apagar_tudo", argumentos: {} });
    expect(r.data).toMatchObject({ ok: true, isError: true, confianca: "confiavel" });
    const corpo = JSON.parse((r.data as { conteudo: string }).conteudo) as { erro: string; instrucao: string };
    expect(corpo.erro).toBe("sem_acesso");
    expect(corpo.instrucao).toContain("pedir_acesso");
    expect(corpo.instrucao).toContain("capacidades=[\"apagar_tudo\"]");
    expect(c.chamadas).toHaveLength(0);
    expect(c.trilha()).toEqual([["negacao", "exemplo__apagar_tudo", "capacidade_desligada"]]);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
  });

  it("só chama ferramenta de app: nome do nod, o próprio apps_usar ou nome inventado não despacham nada", async () => {
    const c = await cenario();
    for (const ferramenta of ["lembrar", "apps_usar", "pedir_aprovacao", "exemplo__inventada"]) {
      const r = await c.chamar("apps_usar", { ferramenta, argumentos: { tipo: "fato", texto: "x" } });
      expect(r.data).toMatchObject({ ok: true, isError: true });
      expect(JSON.parse((r.data as { conteudo: string }).conteudo)).toMatchObject({ erro: "nao_encontrada" });
    }
    expect(c.chamadas).toHaveLength(0);
    expect(c.banco.memorias ?? []).toHaveLength(0);
  });

  it("argumento fora do esquema volta explicado (erros e esquema), não roda e o turno segue", async () => {
    const c = await cenario();
    const r = await c.chamar("apps_usar", { ferramenta: "exemplo__somar", argumentos: { a: "dois" } });
    const corpo = JSON.parse((r.data as { conteudo: string }).conteudo) as { erro: string; erros: string[]; argumentos: unknown };
    expect(corpo.erro).toBe("argumentos_invalidos");
    expect(corpo.erros.length).toBeGreaterThan(0);
    expect(corpo.argumentos).toMatchObject({ required: ["a", "b"] });
    expect(c.chamadas).toHaveLength(0);
    expect(c.trilha()).toEqual([["negacao", "exemplo__somar", "args_invalidos"]]);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
  });

  it("plano recomposto (reinício do servidor no meio do turno): a direta que o proxy listou e virou sob demanda roda pelo mesmo portão, sem negação terminal", async () => {
    // Revisão do PR #413: a recomposição relê o uso de 30 dias (que já inclui as chamadas deste turno) e pode trocar uma
    // direta de lado. O proxy segue com a lista da emissão (listChanged: false); negar por fora_do_catalogo encerraria o turno.
    const c = await cenario();
    expect((await c.chamar("exemplo__somar", { a: 1, b: 2 })).data).toEqual({ ok: true, conteudo: "ok:somar", confianca: "nao_confiavel" });
    expect(c.trilha()).toEqual([["tool_call", "exemplo__somar", null]]);
    // O portão é o mesmo: a sob demanda sem concessão continua capacidade_desligada.
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["somar"]);
  });

  it("plano recomposto SEM apps_buscar/apps_usar (interruptor desligado no reinício): as duas seguem atendidas pelo mesmo portão, sem negação terminal", async () => {
    // Revisão do PR #413: NOD_APPS_SOB_DEMANDA=0 só vale depois do reinício, e o proxy dos turnos em curso ainda lista as
    // duas. Negar por fora_do_catalogo mataria justamente os turnos de quem desligou porque algo ia mal.
    const c = await cenario();
    const direta: FerramentaPlano = { nome: "exemplo__somar", nomeMcp: "mcp__nod__exemplo__somar", origem: "conector", conectorId: c.conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: SOMAR };
    const semCatalogo: PlanoTurno = { ...c.plano, catalogo: { ferramentas: [nod("lembrar"), direta], servidores: c.plano.catalogo.servidores } };
    expect((await c.chamar("apps_usar", { ferramenta: "exemplo__somar", argumentos: { a: 2, b: 2 } }, semCatalogo)).data).toEqual({ ok: true, conteudo: "ok:somar", confianca: "nao_confiavel" });
    const busca = await c.chamar("apps_buscar", { busca: "somar" }, semCatalogo);
    expect(JSON.parse((busca.data as { conteudo: string }).conteudo).resultados[0]).toMatchObject({ ferramenta: "exemplo__somar", na_lista: true });
    // A concessão continua lida agora: sem ela, a sob demanda que não está no plano não roda.
    expect(JSON.parse(((await c.chamar("apps_usar", { ferramenta: "exemplo__enviar", argumentos: { para: "x" } }, semCatalogo)).data as { conteudo: string }).conteudo)).toMatchObject({ erro: "sem_acesso" });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["somar"]);
  });

  it("a pedido de outra pessoa, apps_usar fora do plano também é negado (a origem apps não passa no portão do pedido)", async () => {
    const c = await cenario({ sobProcuracaoDe: "outra-pessoa" });
    const semCatalogo: PlanoTurno = { ...c.plano, catalogo: { ferramentas: [nod("lembrar")], servidores: [] } };
    expect((await c.chamar("apps_usar", { ferramenta: "exemplo__somar", argumentos: { a: 1, b: 2 } }, semCatalogo)).data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
    expect(c.chamadas).toHaveLength(0);
  });

  it("pelo nome direto, a sob demanda é só de conector: nenhuma outra origem entra pela lista sob demanda", async () => {
    const c = await cenario();
    const plano: PlanoTurno = { ...c.plano, catalogo: { ...c.plano.catalogo, ferramentas: [FERRAMENTA_APPS_USAR], sobDemanda: [nod("lembrar")] } };
    expect((await c.chamar("lembrar", { tipo: "fato", texto: "x" }, plano)).data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
  });

  it("apps_usar numa direta que roda NA MÁQUINA (gh do Mac, Mac) não devolve executarLocal: manda chamar direto, sem trilha nem marca", async () => {
    // Revisão do PR #413: o proxy só executa local pelo nome da própria ferramenta marcada "maquina"; pelo apps_usar ele
    // negaria terminal (fora_do_catalogo) depois de o servidor já ter gravado a chamada e marcado o turno.
    const c = await cenario();
    const direta: FerramentaPlano = { nome: "exemplo__somar", nomeMcp: "mcp__nod__exemplo__somar", origem: "conector", conectorId: c.conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: SOMAR, execucao: "maquina" };
    const plano: PlanoTurno = { ...c.plano, catalogo: { ...c.plano.catalogo, ferramentas: [...c.plano.catalogo.ferramentas, direta], sobDemanda: c.plano.catalogo.sobDemanda?.filter((f) => f.nome !== "exemplo__somar") } };
    const r = await c.chamar("apps_usar", { ferramenta: "exemplo__somar", argumentos: { a: 1, b: 2 } }, plano);
    expect(r.data).toMatchObject({ ok: true, isError: true });
    const corpo = JSON.parse((r.data as { conteudo: string }).conteudo) as { erro: string; instrucao: string };
    expect(corpo.erro).toBe("na_lista");
    expect(corpo.instrucao).toContain("mcp__nod__exemplo__somar");
    expect(c.trilha()).toEqual([]);
    expect(c.banco.contaminados.size).toBe(0);
  });

  it("a pedido de outra pessoa nem apps_buscar nem apps_usar rodam (o caso de uso confere de novo)", async () => {
    // Um cenário por chamada: a primeira negação é terminal e encerra o turno.
    const usar = await cenario({ sobProcuracaoDe: "outra-pessoa" });
    expect((await usar.chamar("apps_usar", { ferramenta: "exemplo__somar", argumentos: { a: 1, b: 2 } })).data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
    expect(usar.chamadas).toHaveLength(0);
    const buscar = await cenario({ sobProcuracaoDe: "outra-pessoa" });
    expect((await buscar.chamar("apps_buscar", { busca: "somar" })).data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
  });

  it("apps_buscar acha a sob demanda com o esquema e a não concedida com concedida: false (sem esquema), e deixa a linha na trilha", async () => {
    const c = await cenario();
    const r = await c.chamar("apps_buscar", { busca: "apagar mensagens" });
    const corpo = JSON.parse((r.data as { conteudo: string }).conteudo) as { resultados: { ferramenta: string; concedida?: boolean; argumentos?: unknown }[] };
    expect(corpo.resultados[0]).toEqual({ ferramenta: "exemplo__apagar_tudo", descricao: "Apaga todas as mensagens", concedida: false });
    const soma = JSON.parse(((await c.chamar("apps_buscar", { busca: "soma", app: "exemplo" })).data as { conteudo: string }).conteudo) as { resultados: { ferramenta: string; argumentos?: unknown }[] };
    expect(soma.resultados[0]).toMatchObject({ ferramenta: "exemplo__somar", argumentos: { required: ["a", "b"] } });
    expect(c.chamadas).toHaveLength(0);
    expect(c.trilha().every(([kind, ferramenta]) => kind === "tool_call" && ferramenta === "apps_buscar")).toBe(true);
  });
});
