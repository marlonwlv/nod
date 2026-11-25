import { describe, expect, it } from "vitest";
import type { Computador } from "../../../src/contracts/computador.ts";
import { computadorTemLugar } from "../../../src/use-cases/computador-tem-lugar.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { emitirPlanoTurno } from "../../../src/use-cases/emitir-plano-turno.ts";
import { listarFrota } from "../../../src/use-cases/listar-frota.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * 2026-11-25 (pedido do Marlon, caso da Micherlaine em 24/11): o computador do bot fica desligado no Mac e no Windows e o
 * bot usa só o navegador (ADR-190). A dona só com um PC Windows tinha o computador "fora do ar" desde 19/11 (nenhuma
 * máquina dela roda o computador); o plano saía sem computador_* e com "Seu computador está fora do ar... não tente
 * contornar", e o bot recusou abrir o WhatsApp Web mesmo com as navegador_* no plano. Sem máquina Linux, o computador
 * não existe: nem ferramentas, nem o fora do ar no prompt, nem na frota.
 */
describe("2026-11-25: o computador só existe para quem tem máquina Linux", () => {
  const pronto = { estado: "pronto" as const, versao: "2.1.309", em: Date.now() };
  const foraDoAr = (agenteId: string): Computador => ({
    id: "c-1", agenteId, habilitado: true, controle: "bot", politica: "supervisionado", ajuda: null, ajudaDecisaoId: null, ocupadoAte: null,
    operacaoId: null, criadoEm: 0, falhasSeguidas: 5, falhaMotivo: "maquina_sem_contato", indisponivelDesde: Date.now() - 60_000,
  } as Computador);

  async function cenario(maquina: "linux" | "win32" | "darwin" | null) {
    const { deps, banco } = depsEmMemoria(MARLON);
    deps.services.computadores = { porPessoa: true, soNoLinux: true, executarAprovado: async () => undefined };
    deps.services.navegadores = { disponivel: () => true, executarAprovado: async () => undefined };
    if (maquina) {
      banco.maquinaTokens.push({ tenantId: MARLON.tenantId, ownerId: MARLON.pessoaId, id: "m-1", nome: "máquina", prefixo: "p", hash: Buffer.alloc(32), criadaEm: 0,
        ultimoUsoEm: null, expiraEm: null, revogadaEm: null, plataforma: maquina, papel: "motor" });
    }
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Mary" });
    await deps.repos.agentes.atualizarPerfil(bot.agente.id, { confirmado: true });
    // O computador da pessoa existe e está fora do ar (máquina sem contato), como o da Micherlaine.
    deps.repos.computadores.buscarVinculo = async () => foraDoAr(bot.agente.id);
    deps.repos.computadores.foraDoAr = async () => new Map([[bot.agente.id, { desde: Date.now() - 60_000, motivo: "maquina_sem_contato" as const }]]);
    const turno = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: Date.now() + 86_400_000, profundidade: 0,
      entradaTexto: "abra o WhatsApp Web pelo navegador", entradaConfianca: "confiavel", modelo: bot.agente.modelo, harness: bot.agente.harness, executor: "local" }))!;
    const { data: plano } = await executar(deps, emitirPlanoTurno, { turnoId: turno.id, machineId: "maquina-1", executor: "local", harnesses: { "claude-cli": pronto } });
    const { data: frota } = await executar(deps, listarFrota, {});
    return { deps, plano, bot: frota.agentes.find((a) => a.id === bot.agente.id)! };
  }

  for (const maquina of ["win32", "darwin", null] as const) {
    it(`só ${maquina ?? "sem máquina"}: sem computador_* e sem o fora do ar; o navegador continua`, async () => {
      const { deps, plano, bot } = await cenario(maquina);
      expect(await computadorTemLugar(deps)).toBe(false);
      expect(plano.catalogo.ferramentas.filter((f) => f.origem === "computador")).toEqual([]);
      expect(plano.catalogo.ferramentas.filter((f) => f.origem === "navegador").map((f) => f.nome)).toContain("navegador_abrir");
      expect(plano.promptSistema).not.toContain("Seu computador está fora do ar");
      expect(bot.computadorForaDoAr).toBeNull();
      expect(bot.semComputador).toBe(true);
    });
  }

  it("com máquina Linux: nada muda (o fora do ar segue no plano e na frota)", async () => {
    const { deps, plano, bot } = await cenario("linux");
    expect(await computadorTemLugar(deps)).toBe(true);
    expect(plano.promptSistema).toContain("Seu computador está fora do ar");
    expect(bot.computadorForaDoAr).toMatchObject({ motivo: "maquina_sem_contato" });
    expect(bot.semComputador).toBeUndefined();
  });

  it("fora do modo motor (docker, provedor), o computador não depende de máquina Linux", async () => {
    const { deps } = depsEmMemoria(MARLON);
    deps.services.computadores = { porPessoa: false, executarAprovado: async () => undefined };
    expect(await computadorTemLugar(deps)).toBe(true);
    deps.services.computadores = undefined;
    expect(await computadorTemLugar(deps)).toBe(false);
  });
});
