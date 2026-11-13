import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { FERRAMENTAS_QUADRO } from "../../../src/contracts/ferramentas-quadro.ts";
import { assuntoDeQuadro, SCHEMA_DO_KIT, TIPOS_DA_TAREFA } from "../../../src/domain/kit-quadro.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "resolve pedidos", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "como ficou a reunião?", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, quadro: true };

const gerirQuadro = (entrada: EntradaPlano) => montarPlano(entrada).catalogo.ferramentas.find((f) => f.nome === "gerir_quadro")!;
const itens = (schema: typeof SCHEMA_DO_KIT.tarefa) => schema.properties!.acoes.items!;
const tipos = (schema: typeof SCHEMA_DO_KIT.tarefa) => itens(schema).properties!.tipo.enum;

describe("kits do gerir_quadro por contexto", () => {
  it("no turno de tarefa expõe só as saídas da etapa e não lista gestão do quadro", () => {
    const plano = montarPlano({ ...base, modo: "delegacao", trabalho: { titulo: "Corrigir login", origem: "quadro", trabalhoMaeId: null } });
    const ferramenta = plano.catalogo.ferramentas.find((f) => f.nome === "gerir_quadro")!;
    expect(tipos(ferramenta.schema)).toEqual(TIPOS_DA_TAREFA);
    expect(tipos(ferramenta.schema)).not.toEqual(expect.arrayContaining(["criar_coluna", "definir_passagem", "adicionar_pessoa", "importar_linear"]));
    expect(Object.keys(itens(ferramenta.schema).properties!)).toEqual(["tipo", "tarefa", "status", "pr_url", "pergunta", "motivo", "texto", "responder_a"]);
    expect(plano.promptSistema).toContain("Trabalho de tarefa do quadro termina sempre numa de 4 saídas");
    expect(plano.promptSistema).not.toContain("cada coluna pode ter um responsável (a passagem, o handoff)");
  });

  it("no chat comum mantém todas as operações, mas o catálogo e o prompt ficam menores", () => {
    const ferramenta = gerirQuadro(base);
    expect(tipos(ferramenta.schema)).toEqual(tipos(FERRAMENTAS_QUADRO.gerir_quadro));
    expect(JSON.stringify(ferramenta.schema).length).toBeLessThan(JSON.stringify(FERRAMENTAS_QUADRO.gerir_quadro).length);
    expect(ferramenta.schema.description).not.toContain("substituir_colunas");
    expect(montarPlano(base).promptSistema).not.toContain("cada coluna pode ter um responsável (a passagem, o handoff)");
  });

  it("quando a fala é sobre o quadro entrega o contrato e o manual completos", () => {
    const entrada = { ...base, turno: { ...turno, entradaTexto: "crie uma coluna no quadro e defina a passagem" } };
    const plano = montarPlano(entrada);
    expect(gerirQuadro(entrada).schema).toBe(FERRAMENTAS_QUADRO.gerir_quadro);
    expect(plano.promptSistema).toContain("cada coluna pode ter um responsável (a passagem, o handoff)");
  });

  it("detecta termos de gestão, códigos e variações com acento sem palavras comuns", () => {
    for (const texto of ["mova o card", "quem é o responsável da tarefa?", "importe NOD-491", "configure o handoff", "crie uma coluna"]) expect(assuntoDeQuadro(texto), texto).toBe(true);
    for (const texto of ["faça o relatório", "ficou feito?", "mover o arquivo", "a etapa do funil comercial"]) expect(assuntoDeQuadro(texto), texto).toBe(false);
  });
});
