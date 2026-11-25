import { afterEach, beforeEach, expect, it } from "vitest";
import { atividadeDaTarefa } from "../../src/domain/atividade-da-tarefa.ts";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import { abrirTarefaDaPessoa, mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { devolverResumo } from "../../src/use-cases/frentes.ts";
import { pararTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-192, etapa 0 (definido em 2026-11-22): caracterização do ciclo da Tarefa de HOJE, antes de Tarefa e Thread existirem.
 * Estes testes fixam o comportamento legado que as etapas seguintes não podem quebrar sem querer (o adaptador de
 * `trabalhos` continua) e, lado a lado, o que a atividade derivada diria dos mesmos fatos — sem divergência no log da
 * sombra. O que já tem caracterização própria e não se repete aqui: a criação detalhada (tarefa-da-pessoa.test.ts), os
 * lotes (frentes-abrir.test.ts), a rotina (trabalhos-revisao-rotina.test.ts) e o quadro (quadro-trabalho.test.ts).
 *
 * O ponto do diagnóstico de 20/11 fica explícito: o bot entrega com `falta` e o trabalho vai a `terminado` — é a semântica
 * de execução que a Tarefa nova separa (`entregue` ≠ `resolvida`).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

let linhasDoLog: string[] = [];
beforeEach(() => {
  linhasDoLog = [];
  definirDestinoDoLog((l) => linhasDoLog.push(l));
});
afterEach(() => definirDestinoDoLog(null));
const divergencias = () => linhasDoLog.filter((l) => l.includes("atividade_sombra_divergente"));

async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const abrir = async (texto = "Levante os números do trimestre") => (await abrirTarefaDaPessoa(deps, { agenteId: ada.agenteId, texto })).data;
  const ctx = (turnoId: string) => ({ turnoId, agenteId: ada.agenteId, conversaId: ada.conversaId });
  /** O estado legado e a atividade que a projeção nova tira dos mesmos fatos. */
  const ler = async (trabalhoId: string) => {
    const t = await repos.trabalhos.buscar(trabalhoId);
    const fatos = await repos.trabalhos.fatos(trabalhoId);
    return { estado: t?.estado, atividade: fatos ? atividadeDaTarefa(fatos) : undefined };
  };
  return { ada, deps, repos, abrir, ctx, ler };
}

describeIntegracao("caracterização do ciclo da Tarefa antes do ADR-192 (etapa 0)", () => {
  it("criada: na fila, com o primeiro turno pendente; a atividade é 'trabalhando'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      expect(r.trabalho).toMatchObject({ origem: "pessoa", forma: "frente", estado: "na_fila" });
      expect(await m.ler(r.trabalho.id)).toEqual({ estado: "na_fila", atividade: "trabalhando" });
      expect(divergencias()).toEqual([]);
    });
  });

  it("o bot entrega com 'falta' e o turno conclui: o legado diz 'terminado' (o falso 'concluída'); a atividade é ausente", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      const ok = await devolverResumo(m.deps, { ...m.ctx(r.turnoId), feito: "Levantei metade dos números", falta: "esperar o fechamento do mês" });
      expect(ok.data).toMatchObject({ ok: true });
      await m.repos.turnos.assentar(r.turnoId, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, r.trabalho.id);
      // Comportamento legado fixado: `falta` não segura o estado. A etapa 2 em diante grava a Tarefa como `entregue`.
      expect(await m.ler(r.trabalho.id)).toEqual({ estado: "terminado", atividade: null });
      expect((await m.repos.trabalhos.buscar(r.trabalho.id))?.resumo).toMatchObject({ falta: "esperar o fechamento do mês" });
      expect(divergencias()).toEqual([]);
    });
  });

  it("pergunta à pessoa: 'precisa_de_voce' nos dois; responder (fechar a decisão) devolve o trabalho ao desfecho do turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      const d = await m.repos.decisoes.criar({ tipo: "pergunta", agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, turnoId: r.turnoId, prazoDecisaoEm: Date.now() + 600_000, frase: "Qual trimestre?" });
      await m.repos.turnos.assentar(r.turnoId, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, r.trabalho.id);
      expect(await m.ler(r.trabalho.id)).toEqual({ estado: "precisa_de_voce", atividade: "precisa_de_voce" });
      await m.repos.decisoes.dispensar(d!.id, { por: PESSOA_MARLON, agora: Date.now(), antes: "pendente" });
      await sincronizarTrabalho(m.deps, r.trabalho.id);
      expect(await m.ler(r.trabalho.id)).toEqual({ estado: "terminado", atividade: null });
      expect(divergencias()).toEqual([]);
    });
  });

  it("reabertura: a pessoa fala na tarefa terminada e ela volta a trabalhar na mesma faixa (mesmo trabalho, turno novo)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      await m.repos.turnos.assentar(r.turnoId, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, r.trabalho.id);
      expect((await m.ler(r.trabalho.id)).estado).toBe("terminado");
      const segunda = await mensagemParaTrabalho(m.deps, { trabalhoId: r.trabalho.id, texto: "inclua o trimestre anterior" });
      expect(segunda.data.trabalho.id).toBe(r.trabalho.id);
      expect(segunda.data.mensagemTurnoId).not.toBe(r.turnoId);
      const lido = await m.ler(r.trabalho.id);
      expect(lido.atividade).toBe("trabalhando");
      expect(["na_fila", "rodando"]).toContain(lido.estado);
      expect(divergencias()).toEqual([]);
    });
  });

  it("Parar: 'parado'; a atividade é 'interrompida'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      const p = await pararTrabalho(m.deps, { trabalhoId: r.trabalho.id });
      expect(p.data.trabalho.estado).toBe("parado");
      expect(await m.ler(r.trabalho.id)).toEqual({ estado: "parado", atividade: "interrompida" });
      expect(divergencias()).toEqual([]);
    });
  });

  it("interrompido sem retomada (executor indisponível): 'falhou'; a atividade é 'interrompida'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      await m.repos.turnos.interromper(r.turnoId, "executor_indisponivel");
      await sincronizarTrabalho(m.deps, r.trabalho.id);
      expect(await m.ler(r.trabalho.id)).toEqual({ estado: "falhou", atividade: "interrompida" });
      expect(divergencias()).toEqual([]);
    });
  });
});
