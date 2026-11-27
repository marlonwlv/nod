import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarSeuComputador } from "../../src/adapters/fundo/seu-computador.ts";
import { criarCanalNavegador } from "../../src/adapters/navegador/canal-maquina.ts";
import type { Tx } from "../../src/shared/types.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-197, QA da rc.15 no Windows (achado 1, bloqueante): Ajustes › Máquinas dizia "Seu PC · Conectado", e nenhum turno
 * recebia as seu_computador_*. O Raio-X de produção mostrou a causa: a Lia e o Testador QA eram bots ainda não
 * confirmados, e o turno deles sai em modo "criacao"; o plano só oferecia as ferramentas em "conversa". A avaliação do
 * PR #392 usou um bot confirmado e não pegou. Aqui: o portão e a fila reais, o PC anunciado como o motor do Windows
 * anuncia (`navegador/puxar` com `recursos: ["seu_computador"]`, conexão win32) e o bot recém-criado, sem confirmar.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-26T11:47:33Z");

async function montar(trx: Tx, o: { confirmado?: boolean; origem?: "conversa" | "rotina" } = {}) {
  const lia = await agenteComConversa(trx, MARLON, { nome: "Lia" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  if (o.confirmado !== undefined) await repos.agentes.atualizarPerfil(lia.agenteId, { confirmado: o.confirmado });
  const canal = criarCanalNavegador({ agora: () => AGORA });
  const portao = criarSeuComputador({ dentro: async (_e, fn) => fn(deps), canal, cifrar: (s) => s, decifrar: (s) => s, agora: () => AGORA });
  deps.services.seuComputador = portao;
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: lia.conversaId, agenteId: lia.agenteId, origem: o.origem ?? "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "Abre o Bloco de Notas aqui no meu PC e escreve: teste QA rc15 linha 1", entradaConfianca: "confiavel", modelo: "m" });
  return { deps, canal, portao, turno: turno! };
}

/** O que a rota `navegador/puxar` faz com o corpo que o motor do Windows manda (o filtro de `recursos` e a plataforma da conexão). */
function anunciarPcDoWindows(canal: ReturnType<typeof criarCanalNavegador>, maquinaId: string): void {
  const corpo: { recursos?: unknown } = { recursos: ["seu_computador"] };
  const recursos = Array.isArray(corpo.recursos) ? corpo.recursos.filter((x): x is string => x === "seu_computador") : [];
  canal.presenca(MARLON, maquinaId, { plataforma: "win32", nome: "app do nod", recursos });
}

const doPc = (p: { catalogo: { ferramentas: readonly { nome: string }[] } }) => p.catalogo.ferramentas.map((f) => f.nome).filter((n) => n.startsWith("seu_computador_"));

describeIntegracao("o PC com Windows no plano do turno (QA rc.15, achado 1)", () => {
  it("o bot ainda não confirmado (modo criacao) recebe as seu_computador_* e o prompt fala do PC, não do Mac", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const maquinaId = randomUUID();
      anunciarPcDoWindows(m.canal, maquinaId);
      expect(m.portao.disponivel(MARLON)).toEqual({ plataforma: "win32", nome: "app do nod" });
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: m.turno.id, machineId: maquinaId, executor: "catcher" })).data;
      expect(plano.modoTurno).toBe("criacao");
      expect(doPc(plano)).toEqual(expect.arrayContaining(["seu_computador_ver", "seu_computador_digitar", "seu_computador_abrir_app", "seu_computador_apps"]));
      expect(plano.promptSistema).toContain("o PC da pessoa (seu_computador_*)");
      expect(plano.promptSistema).not.toContain("o Mac da pessoa (seu_computador_*)");
    });
  });

  it("o bot confirmado também; sem o PC anunciado, ou na rotina, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const confirmado = await montar(trx, { confirmado: true });
      const maquinaId = randomUUID();
      expect(doPc((await emitirPlanoTurno(confirmado.deps, { turnoId: confirmado.turno.id, machineId: maquinaId, executor: "catcher" })).data)).toEqual([]);
      anunciarPcDoWindows(confirmado.canal, maquinaId);
      const novo = await montar(trx, { confirmado: true });
      anunciarPcDoWindows(novo.canal, maquinaId);
      const plano = (await emitirPlanoTurno(novo.deps, { turnoId: novo.turno.id, machineId: maquinaId, executor: "catcher" })).data;
      expect(plano.modoTurno).toBe("conversa");
      expect(doPc(plano)).toContain("seu_computador_ver");
      const rotina = await montar(trx, { origem: "rotina" });
      anunciarPcDoWindows(rotina.canal, maquinaId);
      expect(doPc((await emitirPlanoTurno(rotina.deps, { turnoId: rotina.turno.id, machineId: maquinaId, executor: "catcher" })).data)).toEqual([]);
    });
  });
});
