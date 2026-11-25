import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { Navegadores } from "../../../src/adapters/fundo/navegadores.ts";
import { MOTIVOS_DO_NAVEGADOR, rotasNavegador, rotasTarefasEnsinadas } from "../../../src/adapters/http/rotas/navegador.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";

/**
 * As rotas da dona do bot (ADR-190): o corpo conferido antes de ir ao portão, o 409 com a causa da tabela fixa e o GET com
 * a vista e o `disponivel`. O portão é de mentira (o de verdade é provado em tests/unit/adapters/navegadores.test.ts).
 */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const BOT = "00000000-0000-4000-8000-0000000000b1";
const vista = { agenteId: BOT, estado: "desligado", lugar: { tipo: "nod" } };

function montar(falha: unknown = null) {
  const chamadas: unknown[][] = [];
  const registrar = (nome: string) => async (...args: unknown[]) => { chamadas.push([nome, ...args.slice(1)]); if (falha) throw falha; return nome === "ensinar" ? { vista, tarefa: { id: "t1" } } : vista; };
  const navegadores = {
    conferirDona: async () => undefined, vistaDe: () => vista, disponivel: () => false,
    operar: registrar("operar"), irPara: registrar("irPara"), trocarAba: registrar("trocarAba"), ensinar: registrar("ensinar"),
  } as never as Navegadores;
  const rotas = rotasNavegador(navegadores);
  const chamar = async (metodo: string, caminho: string, corpo: unknown = {}) => {
    const rota = rotas.find((r) => r.metodo === metodo && r.padrao.test(caminho))!;
    const params = { id: BOT };
    let resposta: { status: number; body: unknown } | null = null;
    const req = new IncomingMessage(new Socket());
    try {
      await rota.handler({ req, res: new ServerResponse(req), escopo: ESCOPO, params, corpo: async () => corpo, json: (status: number, body: unknown) => { resposta = { status, body }; } } as never);
    } catch (e) { return { status: 0, body: e instanceof ErroDeDominio ? e.codigo : String(e) }; }
    return resposta!;
  };
  return { chamar, chamadas, rotas };
}

describe("rotas do navegador do bot", () => {
  it("cada rota que muda declara a ação do registro", () => {
    expect(montar().rotas.filter((r) => r.metodo === "POST").map((r) => r.acao)).toEqual(["navegador.operar", "navegador.ir_para", "navegador.trocar_aba", "navegador.login", "navegador.trazer_do_chrome", "navegador.codigo", "navegador.guardar_login", "navegador.ensinar"]);
  });

  it("GET devolve a vista e se o navegador roda aqui; POST confere o corpo antes do portão", async () => {
    const { chamar, chamadas } = montar();
    expect(await chamar("GET", `/agentes/${BOT}/navegador`)).toEqual({ status: 200, body: { vista, disponivel: false } });
    expect(await chamar("POST", `/agentes/${BOT}/navegador`, { operacao: "explodir" })).toEqual({ status: 0, body: "entrada_invalida" });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/endereco`, { url: 42 })).toEqual({ status: 0, body: "entrada_invalida" });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/aba`, {})).toEqual({ status: 0, body: "entrada_invalida" });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/ensinar`, { operacao: "salvar", nome: "x".repeat(121) })).toEqual({ status: 0, body: "entrada_invalida" });
    expect(chamadas).toEqual([]);
    expect(await chamar("POST", `/agentes/${BOT}/navegador`, { operacao: "assumir" })).toEqual({ status: 200, body: { ok: true, vista } });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/ensinar`, { operacao: "salvar", nome: "Fatura" })).toEqual({ status: 200, body: { ok: true, vista, tarefa: { id: "t1" } } });
    expect(chamadas).toEqual([["operar", BOT, "assumir"], ["ensinar", BOT, "salvar", "Fatura"]]);
  });

  it("409 com a causa da tabela; causa fora dela vira indisponivel; outro erro sobe", async () => {
    expect(await montar(new ErroDeDominio("estado_invalido", { cause: "assuma_primeiro" })).chamar("POST", `/agentes/${BOT}/navegador/endereco`, { url: "https://x.com" }))
      .toEqual({ status: 409, body: { codigo: "estado_invalido", mensagem: MOTIVOS_DO_NAVEGADOR.assuma_primeiro, motivo: "assuma_primeiro" } });
    expect(await montar(new ErroDeDominio("estado_invalido", { cause: "segredo interno" })).chamar("POST", `/agentes/${BOT}/navegador`, { operacao: "ligar" }))
      .toMatchObject({ status: 409, body: { motivo: "indisponivel" } });
    expect(await montar(new ErroDeDominio("nao_encontrado")).chamar("POST", `/agentes/${BOT}/navegador/aba`, { aba: "t1" })).toEqual({ status: 0, body: "nao_encontrado" });
  });
});

describe("Habilidades: as tarefas ensinadas (T3)", () => {
  const TAREFA = "00000000-0000-4000-8000-0000000000c1";
  function montarTarefas() {
    const apagadas: string[][] = [];
    const repos = { navegadorTarefas: {
      doAgente: async (id: string) => [{ id: TAREFA, nome: "Baixar a fatura", passos: ["Abriu itau.com.br"], criadaEm: 1, agente: id }],
      apagar: async (id: string, t: string) => { apagadas.push([id, t]); return t === TAREFA; },
    } };
    const rotas = rotasTarefasEnsinadas({ dentro: async (_e, fn) => fn({ repos } as never) });
    const chamar = async (metodo: string, caminho: string) => {
      const rota = rotas.find((r) => r.metodo === metodo && r.padrao.test(caminho))!;
      const params = (rota.padrao.exec(caminho)?.groups ?? {}) as Record<string, string>;
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      try {
        await rota.handler({ req, res: new ServerResponse(req), escopo: ESCOPO, params, corpo: async () => ({}), json: (status: number, body: unknown) => { resposta = { status, body }; } } as never);
      } catch (e) { return { status: 0, body: e instanceof ErroDeDominio ? e.codigo : String(e) }; }
      return resposta!;
    };
    return { rotas, chamar, apagadas };
  }

  it("GET lista sem ação; DELETE declara navegador.apagar_tarefa, confere o id e diz 404 quando não apagou", async () => {
    const { rotas, chamar, apagadas } = montarTarefas();
    expect(rotas.map((r) => [r.metodo, r.acao])).toEqual([["GET", undefined], ["DELETE", "navegador.apagar_tarefa"]]);
    expect(await chamar("GET", `/agentes/${BOT}/navegador/habilidades`)).toMatchObject({ status: 200, body: { tarefas: [{ id: TAREFA, nome: "Baixar a fatura" }] } });
    expect(await chamar("DELETE", `/agentes/${BOT}/navegador/habilidades/nao-e-uuid`)).toEqual({ status: 0, body: "nao_encontrado" });
    expect(apagadas).toEqual([]);
    expect(await chamar("DELETE", `/agentes/${BOT}/navegador/habilidades/${TAREFA}`)).toEqual({ status: 200, body: { ok: true } });
    expect(await chamar("DELETE", `/agentes/${BOT}/navegador/habilidades/00000000-0000-4000-8000-0000000000c2`)).toEqual({ status: 0, body: "nao_encontrado" });
    expect(apagadas).toEqual([[BOT, TAREFA], [BOT, "00000000-0000-4000-8000-0000000000c2"]]);
  });
});
