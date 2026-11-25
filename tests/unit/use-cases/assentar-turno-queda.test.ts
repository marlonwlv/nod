import { TETO_TENTATIVAS_DA_MENSAGEM } from "../../../src/domain/desvios-da-conversa.ts";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { LEASE_MS } from "../../../src/shared/constantes.ts";
import { assentarTurno, desfechoDaEntrega, REGRA_ENTREGA_TARDIA } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { interromperBastidoresComTeto, interromperPorMaquina } from "../../../src/use-cases/interromper-por-maquina.ts";
import { enfileirarRetomada } from "../../../src/use-cases/enfileirar-retomada.ts";
import { ENTRADA_DA_RETOMADA_DA_QUEDA } from "../../../src/domain/cota-da-ia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

const T0 = Date.parse("2026-09-24T03:10:00-03:00");
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const base = { sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const cortado: ResultadoTurno = { ...base, desfecho: "interrompido", texto: "Vou verificar seus e-mails" };
const pronto: ResultadoTurno = { ...base, desfecho: "sucesso", texto: "Resumo: 3 e-mails novos." };

/**
 * ADR-045: o Mac dormiu no meio do turno; ao acordar a renovação volta {ativo:false} (lease vencido), o
 * laço mata o CLI e ENTREGA antes de o varredor passar. Essa entrega termina igual ao varredor.
 */
async function cenario(tipo: "rotina" | "conversa" | "delegacao") {
  let agora = T0;
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" });
  let turnoId: string;
  let rotinaId: string | null = null;
  if (tipo === "rotina") {
    const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "*/30 * * * *", fusoIana: "UTC", instrucao: "e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: T0 });
    const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: T0, machineId: "m", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("sem turno");
    turnoId = r.data.turno.id;
    rotinaId = rotina!.id;
  } else {
    const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: tipo, prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "resume meus e-mails", entradaConfianca: "confiavel", modelo: "m", ...(tipo === "delegacao" ? { sobProcuracaoDe: MARLON.pessoaId } : {}) });
    turnoId = t!.id;
  }
  const maquina = randomUUID();
  await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
  const antes = banco.mensagens.length;
  const entregar = (resultado: ResultadoTurno, o: { adotada?: true } = {}) => executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, ...o });
  const passar = (ms: number) => {
    agora = T0 + ms;
  };
  return { deps, banco, bot, turnoId, rotinaId, antes, entregar, passar };
}

describe("assentarTurno: entrega depois de o Mac cair (ADR-045)", () => {
  // revisto em 2026-10-20 (NOD-309, PR 3): a rotina caída deixa de ser calada — volta à fila sozinha, com UMA linha
  // na conversa (a da máquina), sem card e sem fechar a execução no histórico (ela fecha quando a volta terminar).
  it("rotina: lease vencido e entrega cortada → volta à fila sozinha, UMA linha da máquina (nem a fala), sem decisão, UM aviso", async () => {
    const c = await cenario("rotina");
    c.passar(LEASE_MS + 20_000);
    const r = await c.entregar(cortado);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.kind)).toEqual(["sistema"]);
    expect(novas[0]?.texto).toContain("Esta execução da rotina fica na fila");
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.execucoes).toEqual([]);
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => [t.estado, t.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA)])).toEqual([["pendente", true]]);
    expect(c.banco.incidentes).toMatchObject([{ rotinas: 1, conversas: 0, comecouEm: T0, voltouEm: T0 + LEASE_MS + 20_000 }]);
    expect(r.events.filter((e) => e.kind === "turno_interrompido")).toHaveLength(1);
  });

  // revisto em 2026-11-22 (lote B, desvio 12): a conversa volta sozinha UMA vez — a retomada da queda fica na fila até a
  // máquina voltar, com a linha discreta; o "Retomar" só quando a volta também cai (no teto da mensagem).
  it("conversa: lease vencido e entrega cortada → fala parcial, UMA linha da máquina e a retomada na fila (sem Retomar)", async () => {
    const c = await cenario("conversa");
    c.passar(LEASE_MS + 20_000);
    const r = await c.entregar(cortado);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => [m.kind, m.parcial])).toEqual([["texto", true], ["sistema", false]]);
    expect(novas[1]?.payload).toMatchObject({ kind: "desvio", desvio: "computador_dormiu", forma: "linha" });
    expect(novas[1]?.texto).toContain("A resposta continua quando");
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => [t.estado, t.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA)])).toEqual([["pendente", true]]);
    expect(c.banco.incidentes).toMatchObject([{ rotinas: 0, conversas: 1 }]);
    expect(r.events.filter((e) => e.kind === "turno_interrompido")).toHaveLength(1);
  });

  it("conversa no teto da mensagem: a volta não se repete — UMA linha de sistema com o Mac e UM Retomar", async () => {
    const c = await cenario("conversa");
    c.banco.turnos.find((t) => t.id === c.turnoId)!.reenvios = TETO_TENTATIVAS_DA_MENSAGEM;
    c.passar(LEASE_MS + 20_000);
    await c.entregar(cortado);
    expect(c.banco.mensagens.slice(c.antes)[1]?.texto).toContain("seu Mac parou de responder");
    expect(c.banco.decisoes.map((d) => [d.tipo, d.turnoId])).toEqual([["retomar_turno", c.turnoId]]);
  });

  it("sucesso depois do lease vencido é trabalho terminado: concluído, com a fala, sem aviso", async () => {
    const c = await cenario("rotina");
    c.passar(LEASE_MS + 20_000);
    const r = await c.entregar(pronto);
    expect(r.data.turno).toMatchObject({ estado: "concluido" });
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.texto)).toEqual(["Resumo: 3 e-mails novos."]);
    expect(c.banco.incidentes).toEqual([]);
  });

  it("entrega TARDIA de rotina já derrubada pelo varredor: a fala cortada não entra; o sucesso tardio entra (o entregável não se perde)", async () => {
    const cortada = await cenario("rotina");
    cortada.passar(LEASE_MS + 20_000);
    const [vencido] = await cortada.deps.repos.turnos.vencidos(cortada.deps.agora());
    await interromperPorMaquina(cortada.deps, { turnos: [vencido!] });
    const tardia = await cortada.entregar(cortado);
    expect(tardia.data.tardia).toBe(true);
    // NOD-309 (PR 3): só a linha da máquina; a fala cortada não entra e a retomada segue na fila.
    expect(cortada.banco.mensagens.slice(cortada.antes).map((m) => [m.kind, m.texto.includes("fica na fila")])).toEqual([["sistema", true]]);
    expect(cortada.banco.turnos.filter((t) => t.retomaTurnoId === cortada.turnoId).map((t) => t.estado)).toEqual(["pendente"]);

    // NOD-264 (E8): o sucesso tardio conclui o turno e a fala entra inteira. NOD-309 (PR 3): a retomada da queda,
    // ainda na fila, é absorvida — o trabalho terminou e não roda de novo.
    const pronta = await cenario("rotina");
    pronta.passar(LEASE_MS + 20_000);
    const [outro] = await pronta.deps.repos.turnos.vencidos(pronta.deps.agora());
    await interromperPorMaquina(pronta.deps, { turnos: [outro!] });
    const r = await pronta.entregar(pronto);
    expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido", motivoInterrupcao: null } });
    expect(pronta.banco.mensagens.slice(pronta.antes).filter((m) => !m.texto.includes("fica na fila")).map((m) => [m.texto, m.parcial])).toEqual([["Resumo: 3 e-mails novos.", false]]);
    expect(pronta.banco.turnos.filter((t) => t.retomaTurnoId === pronta.turnoId).map((t) => [t.estado, t.motivoInterrupcao])).toEqual([["interrompido", "absorvido"]]);
  });

  describe("NOD-264 (E8): sucesso tardio depois da queda", () => {
    it("conversa com a volta automática na fila: concluído, fala inteira e a volta é absorvida (não responde duas vezes)", async () => {
      const c = await cenario("conversa");
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      expect(c.banco.decisoes).toEqual([]);
      const r = await c.entregar(pronto);
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido" } });
      expect(c.banco.mensagens.slice(c.antes).filter((m) => m.kind === "texto").map((m) => [m.texto, m.parcial])).toEqual([["Resumo: 3 e-mails novos.", false]]);
      expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => [t.estado, t.motivoInterrupcao])).toEqual([["interrompido", "absorvido"]]);
      expect(r.events.filter((e) => e.kind === "turno_encerrado")).toHaveLength(1);
    });

    it("conversa no teto (com o Retomar): concluído, fala inteira e o Retomar fecha por entrega_tardia_com_sucesso", async () => {
      const c = await cenario("conversa");
      c.banco.turnos.find((t) => t.id === c.turnoId)!.reenvios = TETO_TENTATIVAS_DA_MENSAGEM;
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      expect(c.banco.decisoes.map((d) => [d.tipo, d.estado])).toEqual([["retomar_turno", "pendente"]]);
      const r = await c.entregar(pronto);
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido" } });
      expect(c.banco.decisoes.map((d) => [d.tipo, d.estado, d.desfecho])).toEqual([["retomar_turno", "decidida", expect.objectContaining({ tipo: "decidida_por_regra", regra: REGRA_ENTREGA_TARDIA })]]);
      expect(r.events.filter((e) => e.kind === "decisao_decidida").map((e) => e.dados.regra)).toEqual([REGRA_ENTREGA_TARDIA]);
    });

    it("QA-228: o turno marcou me_chame_as e a entrega chegou depois da queda — a volta marcada nasce (não some com a retomada absorvida)", async () => {
      const c = await cenario("conversa");
      const acordarEm = T0 + 30 * 60_000;
      await c.deps.repos.turnos.marcarDespertar(c.turnoId, acordarEm, "a CI do PR #9", null);
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      const r = await c.entregar({ ...pronto, texto: "Volto às 03:40 para conferir a CI." });
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido" } });
      const voltas = c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId && t.estado === "pendente");
      expect(voltas.map((t) => [t.acordarEm, t.entradaTexto.includes("a CI do PR #9")])).toEqual([[acordarEm, true]]);
      expect(r.events.filter((e) => e.kind === "turno_criado").map((e) => e.dados.acordar_em)).toEqual([acordarEm]);
    });

    it("QA-228: o turno deixou esperar_comando e o comando terminou enquanto ele estava caído — a entrega tardia acorda o bot", async () => {
      const c = await cenario("conversa");
      const espera = await c.deps.repos.esperas.criar({ turnoId: c.turnoId, agenteId: c.bot.agente.id, conversaId: c.bot.conversa.id, trabalhoId: null, maquinaId: "m", pasta: null, comando: "gh pr checks 9 --watch", motivo: "a CI do PR #9" });
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      await c.deps.repos.esperas.finalizar(espera!.id, { estado: "terminou", codigo: 0, saida: "ok", agora: c.deps.agora() });
      const r = await c.entregar(pronto);
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido" } });
      const voltas = c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId && t.estado === "pendente");
      expect(voltas).toHaveLength(1);
      expect(voltas[0]!.entradaTexto).toContain("gh pr checks 9");
    });

    it("com retomada já na fila: fica como hoje — turno interrompido, fala parcial, retomada intacta", async () => {
      const c = await cenario("conversa");
      // No teto da mensagem (lote B): sem a volta automática, a retomada é a do Retomar, como antes.
      c.banco.turnos.find((t) => t.id === c.turnoId)!.reenvios = TETO_TENTATIVAS_DA_MENSAGEM;
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      const original = await c.deps.repos.turnos.buscar(c.turnoId);
      const retomada = await enfileirarRetomada(c.deps, { original: original!, prazoEm: c.deps.agora() + 86_400_000, entradaTexto: "continue", reenvios: 1 });
      expect(retomada.turno).not.toBeNull();
      const r = await c.entregar(pronto);
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" } });
      expect(c.banco.mensagens.slice(c.antes).filter((m) => m.kind === "texto").map((m) => m.parcial)).toEqual([true]);
      expect((await c.deps.repos.turnos.buscar(retomada.turno!.id))?.estado).toBe("pendente");
    });
  });
});

describe("ADR-131: o motor parou no meio do turno (atualização sozinha, restart, app fechado)", () => {
  const doMotor: ResultadoTurno = { ...cortado, causa: "reinicio_do_motor" };

  it("NOD-452: o corte já pedido vence até uma conclusão concorrente", () => {
    expect(desfechoDaEntrega({ pararSolicitadoEm: T0, leaseAte: T0 + LEASE_MS, motivoInterrupcao: "turno_travado" }, pronto, T0)).toEqual({
      estado: "interrompido",
      motivoInterrupcao: "turno_travado",
      motivoFalha: null,
    });
  });

  it("NOD-452: a telemetria do teto leva só origem, desfecho e duração", async () => {
    const c = await cenario("rotina");
    const turno = c.banco.turnos.find((t) => t.id === c.turnoId)!;
    const linhas: Record<string, unknown>[] = [];
    const saida = vi.spyOn(console, "log").mockImplementation((linha: string) => { linhas.push(JSON.parse(linha) as Record<string, unknown>); });
    try {
      await interromperBastidoresComTeto(c.deps, [turno]);
    } finally {
      saida.mockRestore();
    }
    const teto = linhas.find((linha) => linha.evento === "bastidor_teto_atingido");
    expect(teto).toMatchObject({ origem: "rotina", desfecho: "interrupcao_solicitada", duracao_ms: 0 });
    expect(teto).not.toHaveProperty("turno_id");
    expect(teto).not.toHaveProperty("texto");
    expect(teto).not.toHaveProperty("args");
  });

  it("NOD-452: a entrega do processo cortado libera a faixa com retomada pela política do fundo", async () => {
    const c = await cenario("rotina");
    const turno = c.banco.turnos.find((t) => t.id === c.turnoId)!;
    turno.pararSolicitadoEm = T0;
    turno.motivoInterrupcao = "turno_travado";
    const r = await c.entregar(pronto);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "turno_travado" });
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId)).toHaveLength(1);
    expect(c.banco.decisoes).toEqual([]);
  });

  it("NOD-452: pedido de colega cortado também ganha uma única retomada com backoff", async () => {
    const c = await cenario("delegacao");
    const turno = c.banco.turnos.find((t) => t.id === c.turnoId)!;
    await interromperBastidoresComTeto(c.deps, [turno]);
    c.passar(1);
    const r = await c.entregar(cortado);

    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "turno_travado" });
    const [retomada] = c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId);
    expect(retomada).toMatchObject({ estado: "pendente" });
    expect(retomada?.acordarEm).toBeGreaterThanOrEqual(T0 + 1 + 22_500);
    expect(retomada?.acordarEm).toBeLessThanOrEqual(T0 + 1 + 37_500);
  });

  it("NOD-452: o Parar pedido depois do teto vence e não deixa retomada", async () => {
    const c = await cenario("rotina");
    const turno = c.banco.turnos.find((t) => t.id === c.turnoId)!;
    turno.pararSolicitadoEm = T0;
    turno.motivoInterrupcao = "turno_travado";
    await c.deps.repos.turnos.pedirInterrupcao([c.turnoId], T0 + 1);
    expect(turno.motivoInterrupcao).toBeNull();
    await c.entregar(cortado);
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId)).toEqual([]);
  });

  it("NOD-452: o Parar vence mesmo quando o varredor guardou uma leitura anterior do teto", async () => {
    const c = await cenario("rotina");
    const vivo = c.banco.turnos.find((t) => t.id === c.turnoId)!;
    await interromperBastidoresComTeto(c.deps, [vivo]);
    const leituraAnterior = { ...vivo };

    await c.deps.repos.turnos.pedirInterrupcao([c.turnoId], T0 + 1);
    expect(vivo.motivoInterrupcao).toBeNull();
    c.passar(LEASE_MS + 1);
    await interromperPorMaquina(c.deps, { turnos: [leituraAnterior] });

    expect(vivo).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId)).toEqual([]);
  });

  it("desfechoDaEntrega: a causa reinicio_do_motor é queda, não trabalho incompleto; o Parar vence; o sucesso fica sucesso", () => {
    const livre = { pararSolicitadoEm: null, leaseAte: T0 + LEASE_MS };
    expect(desfechoDaEntrega(livre, doMotor, T0)).toEqual({ estado: "interrompido", motivoInterrupcao: "reinicio_do_motor", motivoFalha: null });
    expect(desfechoDaEntrega(livre, { ...doMotor, desfecho: "falha", motivoFalha: "erro_execucao" }, T0)).toMatchObject({ motivoInterrupcao: "reinicio_do_motor", motivoFalha: "erro_execucao" });
    expect(desfechoDaEntrega({ ...livre, pararSolicitadoEm: T0 }, doMotor, T0)).toMatchObject({ motivoInterrupcao: "parado_pela_pessoa" });
    expect(desfechoDaEntrega(livre, { ...pronto, causa: "reinicio_do_motor" }, T0)).toMatchObject({ estado: "concluido" });
    // Mesmo com o lease vencido ou adotada: quem disse por que parou foi o motor.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: T0 }, doMotor, T0 + 1)).toMatchObject({ motivoInterrupcao: "reinicio_do_motor" });
    expect(desfechoDaEntrega(livre, doMotor, T0, { adotada: true })).toMatchObject({ motivoInterrupcao: "reinicio_do_motor" });
    // Outra causa continua como antes.
    expect(desfechoDaEntrega(livre, { ...cortado, causa: "sinal:SIGKILL" }, T0)).toMatchObject({ motivoInterrupcao: "trabalho_incompleto" });
  });

  it("rotina: volta à fila sozinha e calada, sem aviso de queda e sem fechar a execução", async () => {
    const c = await cenario("rotina");
    c.passar(30_000);
    const r = await c.entregar(doMotor);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_do_motor" });
    expect(c.banco.execucoes).toEqual([]);
    expect(c.banco.mensagens).toHaveLength(c.antes);
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => t.estado)).toEqual(["pendente"]);
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.incidentes).toEqual([]);
  });

  // revisto em 2026-11-22 (lote B, desvio 11): o nod atualizou — a conversa volta sozinha, com a linha, sem Retomar.
  it("conversa: volta sozinha com a linha do nod que atualizou, sem Retomar e sem aviso de máquina sem contato", async () => {
    const c = await cenario("conversa");
    c.passar(30_000);
    const r = await c.entregar(doMotor);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_do_motor" });
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind === "desvio" ? m.payload.desvio : null)).toContain("nod_atualizou");
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => t.estado)).toEqual(["pendente"]);
    expect(c.banco.incidentes).toEqual([]);
  });
});

describe("NOD-245: entrega de um turno ADOTADO depois do reinício do servidor", () => {
  it("desfechoDaEntrega: adotada sem motivo e sem Parar é reinicio_servidor; o Parar e o motivo do cliente continuam valendo", () => {
    const livre = { pararSolicitadoEm: null, leaseAte: null };
    expect(desfechoDaEntrega(livre, cortado, T0, { adotada: true })).toEqual({ estado: "interrompido", motivoInterrupcao: "reinicio_servidor", motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: T0, leaseAte: null }, cortado, T0, { adotada: true })).toMatchObject({ motivoInterrupcao: "parado_pela_pessoa" });
    expect(desfechoDaEntrega(livre, { ...cortado, motivoInterrupcao: "sessao_rejeitada" }, T0, { adotada: true })).toMatchObject({ motivoInterrupcao: "sessao_rejeitada" });
    expect(desfechoDaEntrega(livre, pronto, T0, { adotada: true })).toMatchObject({ estado: "concluido" });
    // Sem adoção, nada muda: lease vencido continua sendo a máquina que caiu.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: T0 }, cortado, T0 + 1)).toMatchObject({ motivoInterrupcao: "maquina_sem_contato" });
    expect(desfechoDaEntrega(livre, cortado, T0)).toMatchObject({ motivoInterrupcao: "trabalho_incompleto" });
  });

  // revisto em 2026-11-22 (lote B, desvio 11): volta sozinha uma vez; o Retomar só no teto da mensagem.
  it("conversa: entrega adotada cortada → reinicio_servidor, volta sozinha com a linha, sem Retomar nem aviso de Mac", async () => {
    const c = await cenario("conversa");
    c.passar(30_000);
    const r = await c.entregar(cortado, { adotada: true });
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_servidor" });
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.mensagens.slice(c.antes).find((m) => m.payload?.kind === "desvio")?.texto).toContain("O nod atualizou no meio da resposta");
    expect(c.banco.incidentes).toEqual([]);
    expect(r.events.filter((e) => e.kind === "turno_interrompido")).toHaveLength(1);
  });

  it("NOD-252: entrega adotada com Parar pendente → parado_pela_pessoa, sem Retomar", async () => {
    const c = await cenario("conversa");
    await c.deps.repos.turnos.pedirInterrupcao([c.turnoId], T0 + 1_000);
    c.passar(30_000);
    const r = await c.entregar(cortado, { adotada: true });
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.incidentes).toEqual([]);
  });

  it("rotina: entrega adotada cortada → reinicio_servidor, volta à fila sozinha e calada (NOD-309, PR 3)", async () => {
    const c = await cenario("rotina");
    c.passar(30_000);
    const r = await c.entregar(cortado, { adotada: true });
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_servidor" });
    expect(c.banco.execucoes).toEqual([]);
    expect(c.banco.mensagens).toHaveLength(c.antes);
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => t.estado)).toEqual(["pendente"]);
    expect(c.banco.incidentes).toEqual([]);
  });
});
