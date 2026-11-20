import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { abrirTarefaDaPessoa, mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { confirmarNaSessao } from "../../src/use-cases/sessao-viva.ts";
import { detalharTrabalho, encerrarTrabalho, pararTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-187 §6 + ADR-185 (lote B, passo 4, 2026-11-18; Paper 4s e 4l): o Parar da tarefa para o trabalho, não o que a
 * pessoa disse. O recado que esperava na fila e o que entrou na sessão sem o bot ler ficam guardados e são a primeira coisa
 * que a tarefa lê quando ela continua; "Encerrar a tarefa" dá a parada por terminada. Contra o Postgres (os UPDATEs).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function tarefaRodando(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const r = await abrirTarefaDaPessoa(deps, { agenteId: ada.agenteId, texto: "Rode os testes de integração do PR" });
  expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(r.data.turnoId);
  return { deps, repos, trabalhoId: r.data.trabalho.id, vivo: r.data.turnoId };
}

describeIntegracao("o Parar da tarefa guarda o recado (ADR-187 §6, ADR-185)", () => {
  it("o recado na fila e o absorvido sem leitura ficam guardados; continuar os devolve antes da fala nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await tarefaRodando(trx);
      const absorvido = (await mensagemParaTrabalho(c.deps, { trabalhoId: c.trabalhoId, texto: "usa o banco de staging, não o local" })).data.mensagemTurnoId;
      await confirmarNaSessao(c.deps, { turnoId: c.vivo, executor: "catcher", ids: [absorvido], informaLeitura: true });
      const naFila = (await mensagemParaTrabalho(c.deps, { trabalhoId: c.trabalhoId, texto: "e confira o rollback" })).data.mensagemTurnoId;

      const parada = await pararTrabalho(c.deps, { trabalhoId: c.trabalhoId });
      expect(parada.data).toMatchObject({ recadosGuardados: 2, trabalho: { estado: "parado" } });
      expect(await c.repos.turnos.buscar(naFila)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      // Encerra o turno vivo como a renovação faria (o Parar só pediu a interrupção).
      await c.repos.turnos.interromper(c.vivo, "parado_pela_pessoa");
      const detalhe = (await detalharTrabalho(c.deps, { trabalhoId: c.trabalhoId })).data;
      expect(detalhe.falasNaFila?.map((f) => f.situacao)).toEqual(["guardada", "guardada"]);

      const continuar = await mensagemParaTrabalho(c.deps, { trabalhoId: c.trabalhoId, texto: "Continue de onde parou." });
      const voltaram = [await c.repos.turnos.buscar(absorvido), await c.repos.turnos.buscar(naFila)];
      expect(voltaram.map((t) => t?.estado)).toEqual(["pendente", "pendente"]);
      const nova = (await c.repos.turnos.buscar(continuar.data.mensagemTurnoId))!;
      expect(voltaram.every((t) => t!.criadoEm <= nova.criadoEm)).toBe(true);
      expect(continuar.data.trabalho.estado).not.toBe("parado");
      expect(continuar.events?.filter((e) => e.kind === "turno_criado").length).toBe(3);
    });
  });

  it("encerrar dá a parada por terminada e o guardado não volta mais; rodando, recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await tarefaRodando(trx);
      await expect(encerrarTrabalho(c.deps, { trabalhoId: c.trabalhoId })).rejects.toMatchObject({ codigo: "estado_invalido" });
      const naFila = (await mensagemParaTrabalho(c.deps, { trabalhoId: c.trabalhoId, texto: "e confira o rollback" })).data.mensagemTurnoId;
      await pararTrabalho(c.deps, { trabalhoId: c.trabalhoId });
      await c.repos.turnos.interromper(c.vivo, "parado_pela_pessoa");
      const r = await encerrarTrabalho(c.deps, { trabalhoId: c.trabalhoId });
      expect(r.data.trabalho.estado).toBe("terminado");
      expect(r.events?.map((e) => e.kind)).toEqual(["trabalho_mudou"]);
      expect((await encerrarTrabalho(c.deps, { trabalhoId: c.trabalhoId })).events).toEqual([]);
      await mensagemParaTrabalho(c.deps, { trabalhoId: c.trabalhoId, texto: "mais uma coisa" });
      expect((await c.repos.turnos.buscar(naFila))?.estado).toBe("interrompido");
    });
  });

  it("o detalhe traz os passos dos turnos da tarefa e, na tarefa da pessoa, nenhum pedido do dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await tarefaRodando(trx);
      await c.repos.turnoPassos.gravar(c.vivo, [
        { tipo: "ferramenta", classe: "comando", ferramenta: "Bash", rotulo: "Rodou um comando", resumo: "npm test", acaoId: "t1", falhou: false },
        { tipo: "ferramenta", classe: "arquivo", ferramenta: "Write", rotulo: "Escreveu um arquivo", resumo: "relatorio.md", acaoId: "t2", falhou: false },
      ]);
      const d = (await detalharTrabalho(c.deps, { trabalhoId: c.trabalhoId })).data;
      expect(d.passos?.map((p) => [p.rotulo, p.resumo, p.turnoId])).toEqual([["Rodou um comando", "npm test", c.vivo], ["Escreveu um arquivo", "relatorio.md", c.vivo]]);
      expect(d.pedidoDoBot).toBeNull();
    });
  });
});
