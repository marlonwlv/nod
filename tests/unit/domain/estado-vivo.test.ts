import { describe, expect, it } from "vitest";
import { aplicarFrame, aplicarSinal, classificarFalha, fimDoTurno, fimNoFrame, novaProjecao, sinalDoEvento } from "../../../src/domain/estado-vivo.ts";

const BOT = "a0000000-0000-4000-8000-000000000001";
const OUTRO = "a0000000-0000-4000-8000-000000000002";
const T1 = "t0000000-0000-4000-8000-000000000001";
const T2 = "t0000000-0000-4000-8000-000000000002";
const CONV = "c0000000-0000-4000-8000-000000000001";

const despachado = (turnoId: string, agenteId = BOT) => ({ kind: "turno_despachado", turnoId, conversaId: CONV, agente_id: agenteId });

describe("estado vivo: projeção por bot", () => {
  it("turno_criado (fila) só indexa; despachado liga o rodando sem atividade", () => {
    const p = novaProjecao();
    expect(aplicarFrame(p, "turno.iniciado", { kind: "turno_criado", turnoId: T1, conversaId: CONV, agente_id: BOT }, 1)).toEqual([]);
    expect(p.bots.has(BOT)).toBe(false);
    expect(aplicarFrame(p, "turno.iniciado", despachado(T1), 2)).toEqual([BOT]);
    expect(p.bots.get(BOT)!.estado).toMatchObject({ rodando: true, compondo: false, atividade: null, turnoId: T1, conversaId: CONV, em: 2 });
  });

  it("ferramenta, thinking e compondo trocam a atividade; o fim do bloco apaga o compondo", () => {
    const p = novaProjecao();
    aplicarFrame(p, "turno.iniciado", despachado(T1), 1);
    aplicarFrame(p, "turno.atividade", { turnoId: T1, agenteId: BOT, conversaId: CONV, nome: "Bash", rotulo: "Rodando um comando" }, 2);
    expect(p.bots.get(BOT)!.estado.atividade).toEqual({ tipo: "ferramenta", ferramenta: "Bash", detalhe: "Rodando um comando" });
    const ref = { agenteId: BOT, turnoId: T1, conversaId: CONV };
    aplicarSinal(p, ref, "pensando", 3);
    expect(p.bots.get(BOT)!.estado.atividade).toEqual({ tipo: "thinking", ferramenta: null, detalhe: null });
    aplicarSinal(p, ref, "compondo", 4);
    expect(p.bots.get(BOT)!.estado.compondo).toBe(true);
    expect(aplicarSinal(p, ref, "texto", 5)).toEqual([]); // igual: não publica de novo
    aplicarSinal(p, ref, "fim_bloco", 6);
    expect(p.bots.get(BOT)!.estado.compondo).toBe(false);
  });

  it("fim do turno grava o desfecho e desliga; frame atrasado do mesmo turno não religa", () => {
    const p = novaProjecao();
    aplicarFrame(p, "turno.iniciado", despachado(T1), 1);
    aplicarFrame(p, "turno.subagentes", { turnoId: T1, agenteId: BOT, subagentes: [{ estado: "trabalhando" }, { estado: "parado" }] }, 2);
    expect(p.bots.get(BOT)!.estado.subagentes_rodando).toBe(1);
    expect(aplicarFrame(p, "turno.encerrado", { turnoId: T1, estado: "concluido" }, 3)).toEqual([BOT]);
    expect(p.bots.get(BOT)!.estado).toMatchObject({ rodando: false, compondo: false, atividade: null, subagentes_rodando: 0, ultimo_desfecho: { resultado: "success", em: 3 } });
    expect(aplicarFrame(p, "turno.subagentes", { turnoId: T1, agenteId: BOT, subagentes: [] }, 4)).toEqual([]);
    expect(aplicarSinal(p, { agenteId: BOT, turnoId: T1, conversaId: CONV }, "compondo", 5)).toEqual([]);
    expect(p.bots.get(BOT)!.estado.rodando).toBe(false);
  });

  it("dois turnos vivos do mesmo bot: só desliga quando o último acaba", () => {
    const p = novaProjecao();
    aplicarFrame(p, "turno.iniciado", despachado(T1), 1);
    aplicarFrame(p, "turno.iniciado", despachado(T2), 2);
    aplicarFrame(p, "turno.interrompido", { turnoId: T1, motivo: "parado_pela_pessoa" }, 3);
    expect(p.bots.get(BOT)!.estado).toMatchObject({ rodando: true, ultimo_desfecho: { resultado: "cancelled" } });
    aplicarFrame(p, "turno.interrompido", { turnoId: T2, motivo: "sem_progresso" }, 4);
    expect(p.bots.get(BOT)!.estado).toMatchObject({ rodando: false, ultimo_desfecho: { resultado: "error", falha: "timeout" } });
  });

  it("turno que nunca rodou (absorvido, cancelado na fila) não mexe no desfecho", () => {
    const p = novaProjecao();
    aplicarFrame(p, "turno.iniciado", { kind: "turno_criado", turnoId: T1, conversaId: CONV, agente_id: BOT }, 1);
    expect(aplicarFrame(p, "turno.interrompido", { turnoId: T1, motivo: "absorvido" }, 2)).toEqual([]);
    expect(aplicarFrame(p, "turno.interrompido", { turnoId: T2, motivo: "parado_pela_pessoa", estava: "pendente", agente_id: BOT }, 3)).toEqual([]);
  });

  it("frame do plano sem turno.iniciado visto (processo reiniciou) liga o bot", () => {
    const p = novaProjecao();
    expect(aplicarFrame(p, "turno.atividade", { turnoId: T1, agenteId: BOT, conversaId: CONV, nome: "Read", rotulo: "Lendo arquivos" }, 1)).toEqual([BOT]);
    expect(p.bots.get(BOT)!.estado.rodando).toBe(true);
  });

  it("decisões: aguardando é a mais antiga aberta; vence_em do prazo; fecha na decidida", () => {
    const p = novaProjecao();
    aplicarFrame(p, "turno.iniciado", despachado(T1), 1);
    aplicarFrame(p, "decisao.nova", { decisao_id: "d1", tipo: "aprovacao", turnoId: T1 }, 10);
    aplicarFrame(p, "decisao.nova", { decisao_id: "d2", tipo: "credencial", conversaId: CONV, prazo_decisao_em: 999 }, 20);
    expect(p.bots.get(BOT)!.estado.aguardando).toEqual({ motivo: "aprovacao", desde: 10 });
    aplicarFrame(p, "decisao.decidida", { decisao_id: "d1" }, 30);
    expect(p.bots.get(BOT)!.estado).toMatchObject({ aguardando: { motivo: "segredo", desde: 20 }, vence_em: 999 });
    aplicarFrame(p, "decisao.vencida", { decisaoId: "d2" }, 40);
    expect(p.bots.get(BOT)!.estado).toMatchObject({ aguardando: null, vence_em: null });
  });

  it("decisão de bot desconhecido (sem turno nem conversa indexados) é ignorada", () => {
    const p = novaProjecao();
    expect(aplicarFrame(p, "decisao.nova", { decisao_id: "d1", tipo: "pergunta", conversaId: CONV }, 1)).toEqual([]);
    expect(aplicarFrame(p, "decisao.nova", { decisao_id: "d2", tipo: "pergunta", agente_id: OUTRO }, 2)).toEqual([OUTRO]);
    expect(p.bots.get(OUTRO)!.estado.aguardando?.motivo).toBe("pergunta");
  });
});

describe("estado vivo: fim do turno", () => {
  it("classifica a falha em código", () => {
    expect(classificarFalha({ motivo_falha: "limite_do_plano" })).toBe("limite_uso");
    expect(classificarFalha({ ia_no_limite: "claude" })).toBe("limite_uso");
    expect(classificarFalha({ espera_no_fundo: "erro_transitorio" })).toBe("taxa");
    expect(classificarFalha({ motivo: "reinicio_do_motor" })).toBe("computador_atualizando");
    expect(classificarFalha({ motivo: "sem_progresso" })).toBe("timeout");
    expect(classificarFalha({ motivo: "executor_indisponivel", motivo_falha: "nao_autenticado" })).toBe("bloqueio");
    expect(classificarFalha({ motivo: "trabalho_incompleto" })).toBe("outra");
  });

  it("desfecho por tipo de frame", () => {
    expect(fimDoTurno("turno.encerrado", { estado: "concluido" })).toEqual({ resultado: "success" });
    expect(fimDoTurno("turno.interrompido", { motivo: "parado_pela_pessoa" })).toEqual({ resultado: "cancelled" });
    expect(fimDoTurno("turno.interrompido", { motivo: "absorvido" })).toBeNull();
    expect(fimNoFrame("turno.interrompido", { motivo: "maquina_sem_contato" }, 50, "e1")).toEqual({ desfecho: "error", settled_at: 50, id_envio: "e1", falha: "computador_atualizando" });
  });

  it("sinal só do evento fase", () => {
    expect(sinalDoEvento({ tipo: "fase", fase: "pensando" })).toBe("pensando");
    expect(sinalDoEvento({ tipo: "delta", texto: "oi" })).toBeNull();
  });
});
