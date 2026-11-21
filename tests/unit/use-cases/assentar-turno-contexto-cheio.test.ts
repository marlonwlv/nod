import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExecucaoRaioX } from "../../../src/contracts/raio-x.ts";
import { JANELA_LONGA, JANELA_PADRAO } from "../../../src/domain/orcamento-contexto.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const execucao = (contexto: number, janela = JANELA_LONGA): ExecucaoRaioX => ({
  chamadas: [{ em: 1, contexto, entrada: 0, cacheLido: contexto, cacheNovo: 0, saida: 10, pensamento: 0, subagente: false, ferramentas: [] }],
  chamadasOmitidas: 0, compactacoes: [], janela, modelo: null, versaoCli: "2.1.309", custoSessaoUsd: null, ferramentasNoInit: 0, buscaDeFerramentas: false, duracaoMs: 1,
});

/**
 * Issue #168: o turno da fala da pessoa que faz o histórico da conversa cruzar o limite deixa UMA linha de sistema no
 * chat (assunto `contexto.cheio`) sugerindo /compactar ou /nova-sessao. Os turnos seguintes, ainda acima, não repetem.
 */
describe("assentarTurno: aviso de contexto cheio", () => {
  async function conversa(modelo = "claude-opus-5-5") {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const conversaId = criado.conversa.id;
    const turno = async (exec: ExecucaoRaioX, origem: "conversa" | "rotina" = "conversa") => {
      const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId: criado.agente.id, origem, entradaTexto: "oi", entradaConfianca: "confiavel", prazoEm: deps.agora() + 60_000, profundidade: 0, modelo });
      const machineId = randomUUID();
      await deps.repos.turnos.reivindicar({ machineId, agora: deps.agora() });
      await executar(deps, assentarTurno, { turnoId: t!.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: { ...RESULTADO, desfecho: "sucesso" as const, texto: "ok", execucao: exec } });
    };
    // O assunto (0091) não mora na Mensagem em memória: o aviso é a linha de sistema com o texto dele.
    const avisos = async () => (await deps.repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema" && m.texto.includes("tokens de contexto"));
    return { turno, avisos, nome: criado.agente.nome };
  }

  it("o turno que cruza o limite avisa uma vez; o seguinte, ainda acima, não repete", async () => {
    const c = await conversa();
    await c.turno(execucao(250_000));
    expect(await c.avisos()).toEqual([]);
    await c.turno(execucao(305_000));
    const [aviso, ...resto] = await c.avisos();
    expect(resto).toEqual([]);
    expect(aviso).toMatchObject({ kind: "sistema" });
    expect(aviso!.texto).toContain(`A conversa com ${c.nome} já ocupa 305 mil tokens`);
    await c.turno(execucao(320_000));
    expect(await c.avisos()).toHaveLength(1);
  });

  it("depois de o histórico voltar para baixo, a próxima subida avisa de novo", async () => {
    const c = await conversa();
    await c.turno(execucao(305_000));
    await c.turno(execucao(30_000));
    await c.turno(execucao(301_000));
    expect(await c.avisos()).toHaveLength(2);
  });

  it("turno de rotina não avisa: roda numa sessão própria, não na conversa da pessoa", async () => {
    const c = await conversa();
    await c.turno(execucao(305_000), "rotina");
    expect(await c.avisos()).toEqual([]);
  });

  it("numa janela de 200k o aviso vem antes de o Claude Code compactar sozinho", async () => {
    const c = await conversa("claude-haiku-4-5");
    await c.turno(execucao(120_000, JANELA_PADRAO));
    expect(await c.avisos()).toHaveLength(1);
  });

  it("turno sem Raio-X (Codex) não avisa", async () => {
    const c = await conversa();
    await c.turno({ ...execucao(0), chamadas: [] });
    expect(await c.avisos()).toEqual([]);
  });
});
