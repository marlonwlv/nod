import { expect, it } from "vitest";
import type { EstadoTrabalho } from "../../src/contracts/trabalho.ts";
import { medirTarefasDaPessoa } from "../../scripts/medir-tarefas.ts";
import { backfillTarefasLote } from "../../src/use-cases/backfill-tarefas.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-192, etapa 4 (definido em 2026-11-22): o backfill das Tarefas antigas. Os trabalhos nascem como antes da etapa 2
 * (sem Tarefa), em estados diferentes; o backfill roda DUAS vezes para provar idempotência, e com lote pequeno para provar
 * que o cursor retoma. Antigas `terminado` viram `entregue`, nunca `resolvida`.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  // `now()` é fixo na transação do teste: cada trabalho ganha um instante próprio, em ordem de criação.
  let seq = 0;
  /** Um trabalho como os de antes (sem Tarefa), com um turno, no estado pedido. */
  const antigo = async (titulo: string, estado: EstadoTrabalho, extra: { origem?: "pessoa" | "rede" | "rotina" | "colega" | "quadro"; forma?: "task" | "frente"; tarefaId?: string; trabalhoMaeId?: string } = {}) => {
    const { trabalho } = await criarTrabalho(deps, { agenteId: ada.agenteId, conversaId: ada.conversaId, titulo, origem: extra.origem ?? "pessoa", forma: extra.forma ?? "frente", ...(extra.tarefaId ? { tarefaId: extra.tarefaId } : {}), ...(extra.trabalhoMaeId ? { trabalhoMaeId: extra.trabalhoMaeId } : {}) });
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: titulo, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: trabalho.id });
    seq += 1;
    await trx`update trabalhos set criado_em = now() - interval '2 hours' + make_interval(secs => ${seq}) where id = ${trabalho.id}`;
    if (estado !== "na_fila") {
      await trx`update turnos set estado = ${estado === "terminado" ? "concluido" : "interrompido"}, motivo_interrupcao = ${estado === "terminado" ? null : estado === "parado" ? "parado_pela_pessoa" : "executor_indisponivel"} where id = ${turno!.id}`;
      await trx`update trabalhos set estado = ${estado}, iniciado_em = now() - interval '1 hour', terminado_em = ${["terminado", "parado", "falhou"].includes(estado) ? trx`now() - interval '10 minutes'` : null} where id = ${trabalho.id}`;
    }
    return { trabalhoId: trabalho.id, turnoId: turno!.id };
  };
  const rodar = async (aplicar = true, limite = 200) => {
    const total = { criadas: 0, ligados: 0, cards: 0, herdados: 0, turnosLigados: 0, lidos: 0, fora: {} as Record<string, number> };
    let cursor: { criadoEm: number; id: string } | null = null;
    do {
      const r = await backfillTarefasLote(deps, { depois: cursor, limite, aplicar });
      total.criadas += r.criadas; total.ligados += r.ligados; total.cards += r.cards; total.herdados += r.herdados; total.turnosLigados += r.turnosLigados; total.lidos += r.lidos;
      for (const [k, n] of Object.entries(r.fora)) total.fora[k] = (total.fora[k] ?? 0) + n;
      cursor = r.cursor;
    } while (cursor);
    return total;
  };
  const tarefaDe = (trabalhoId: string) => repos.tarefas.doTrabalho(trabalhoId);
  return { ada, deps, repos, antigo, rodar, tarefaDe };
}

describeIntegracao("backfill das Tarefas antigas (ADR-192, etapa 4)", () => {
  it("frente de pessoa/rede vira Tarefa + Thread; terminado → ENTREGUE (nunca resolvida); parado/falhou/aberto → em andamento; os turnos caem na Thread", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const feita = await m.antigo("Terminou com falta", "terminado");
      const parada = await m.antigo("Parada pela pessoa", "parado");
      const falhou = await m.antigo("Falhou", "falhou");
      const fila = await m.antigo("Nunca começou", "na_fila", { origem: "rede" });
      const r = await m.rodar();
      expect(r).toMatchObject({ criadas: 4, ligados: 4 });
      const t = (await m.tarefaDe(feita.trabalhoId))!;
      expect(t).toMatchObject({ estado: "entregue", entreguePorTipo: "agente", entreguePorId: m.ada.agenteId, resolvidaEm: null, origemChave: `trabalho:${feita.trabalhoId}` });
      expect((await m.tarefaDe(parada.trabalhoId))?.estado).toBe("em_andamento");
      expect((await m.tarefaDe(falhou.trabalhoId))?.estado).toBe("em_andamento");
      expect((await m.tarefaDe(fila.trabalhoId))?.estado).toBe("nao_iniciada");
      const thread = (await m.repos.tarefas.threadPrimaria(t.id))!;
      expect(thread).toMatchObject({ conversaId: m.ada.conversaId, tipo: "primaria" });
      expect((await trx<{ thread_id: string }[]>`select thread_id from turnos where id = ${feita.turnoId}`)[0]!.thread_id).toBe(thread.id);
      const trilha = await m.repos.tarefas.eventos(t.id);
      expect(trilha.map((e) => [e.tipo, e.autorTipo])).toEqual([["criada", "sistema"], ["thread_criada", "sistema"], ["entregue", "agente"]]);
      expect(trilha[0]!.dados).toMatchObject({ backfill: true, legado: "terminado" });
      await trx`set constraints nod_tarefa_tem_thread_primaria immediate`;
    });
  });

  it("rotina e pedido de colega não viram Tarefa; Card com trabalhos vira UMA Tarefa e a filha herda a da mãe", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const rotina = await m.antigo("Execução de rotina", "terminado", { origem: "rotina", forma: "task" });
      const colega = await m.antigo("Pedido do colega", "terminado", { origem: "colega", forma: "task" });
      const quadro = (await m.repos.quadros.criar({ agenteId: m.ada.agenteId, meta: null, prazo: null }))!;
      const card = (await m.repos.quadros.inserirTarefa({ quadroId: quadro.id, titulo: "Tela de login", descricao: "", status: "fazendo", agenteId: m.ada.agenteId }))!;
      const doCard = await m.antigo("Tela de login", "terminado", { origem: "quadro", forma: "task", tarefaId: card.id });
      const frenteDoCard = await m.antigo("Frente da tela de login", "rodando", { origem: "quadro", forma: "frente", tarefaId: card.id });
      const mae = await m.antigo("Mãe", "terminado");
      const filha = await m.antigo("Filha da mãe", "terminado", { trabalhoMaeId: mae.trabalhoId });
      const r = await m.rodar();
      expect(await m.tarefaDe(rotina.trabalhoId)).toBeNull();
      expect(await m.tarefaDe(colega.trabalhoId)).toBeNull();
      const tCard = (await m.tarefaDe(doCard.trabalhoId))!;
      expect(tCard).toMatchObject({ origemChave: `card:${card.id}`, estado: "em_andamento" });
      expect((await m.tarefaDe(frenteDoCard.trabalhoId))?.id).toBe(tCard.id);
      expect((await trx<{ tarefa_objetivo_id: string }[]>`select tarefa_objetivo_id from quadro_tarefas where id = ${card.id}`)[0]!.tarefa_objetivo_id).toBe(tCard.id);
      expect((await m.tarefaDe(filha.trabalhoId))?.id).toBe((await m.tarefaDe(mae.trabalhoId))?.id);
      expect(r).toMatchObject({ criadas: 2, cards: 1, herdados: 1, ligados: 4 });
    });
  });

  it("idempotente: a segunda passada não cria nem liga nada; a simulação não grava", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.antigo("A", "terminado");
      await m.antigo("B", "parado");
      const simulado = await m.rodar(false);
      expect(simulado).toMatchObject({ criadas: 2, ligados: 0 });
      expect(await m.repos.tarefas.listar({ agenteId: m.ada.agenteId, comArquivadas: true })).toEqual([]);
      const antes = await medirTarefasDaPessoa(trx, MARLON);
      const primeira = await m.rodar();
      const depois = await medirTarefasDaPessoa(trx, MARLON);
      const segunda = await m.rodar();
      expect(primeira).toMatchObject({ criadas: 2, ligados: 2 });
      expect(segunda).toMatchObject({ criadas: 0, ligados: 0, lidos: 0 });
      // Relatório antes/depois: duas Tarefas a mais, uma entregue e uma em andamento; nenhuma resolvida.
      const n = (x: typeof antes, e: string) => x.tarefas?.find((t) => t.estado === e)?.n ?? 0;
      expect(n(depois, "entregue") - n(antes, "entregue")).toBe(1);
      expect(n(depois, "em_andamento") - n(antes, "em_andamento")).toBe(1);
      expect(n(depois, "resolvida")).toBe(n(antes, "resolvida"));
      expect((depois.trabalhosLigados ?? 0) - (antes.trabalhosLigados ?? 0)).toBe(2);
    });
  });

  it("retomável: em lotes de 2 o cursor anda e processa tudo, sem pular nem repetir", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push((await m.antigo(`T${i}`, "terminado")).trabalhoId);
      const r = await m.rodar(true, 2);
      expect(r).toMatchObject({ criadas: 5, ligados: 5 });
      const tarefas = new Set<string>();
      for (const id of ids) tarefas.add((await m.tarefaDe(id))!.id);
      expect(tarefas.size).toBe(5);
    });
  });

  it("a Tarefa nova da etapa 2 (já ligada) fica de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { abrirTarefaDaPessoa } = await import("../../src/use-cases/coordenar-trabalhos.ts");
      const nova = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Já nasce com Tarefa" });
      const r = await m.rodar();
      expect(r.criadas).toBe(0);
      expect((await m.tarefaDe(nova.data.trabalho.id))?.id).toBe(nova.data.tarefaId);
    });
  });
});
