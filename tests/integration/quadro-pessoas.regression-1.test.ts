import { beforeAll, expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { pessoaDeTeste } from "../helpers/pessoa-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

// Regression: ISSUE-001 — o comentário de quem NÃO participa pela rota nova (comentarTarefa) não tinha prova: nenhum teste
// cobria a recusa pela porta nem a conferência sob a trava (comentar-tarefa.ts, `ehMembro` depois do buscarTravado).
// Found by /qa on 2026-11-11 (QA do PR #16, ADA-302).
// Report: .gstack/qa-reports/qa-report-pr16-2026-11-11.md

const DONA = pessoaDeTeste("Dora Dona R1");
const ANA = pessoaDeTeste("Ana Membro R1");
const BIA = pessoaDeTeste("Bia Fora R1");

describeIntegracao("ADA-302: o comentário de quem não participa pela rota nova é recusado", () => {
  beforeAll(async () => {
    await DONA.criar();
    await ANA.criar();
    await BIA.criar();
  });

  const como = async (trx: Tx, e: Escopo): Promise<Deps> => {
    await vincularEscopo(trx, e);
    return depsSobreTrx(trx, e);
  };
  const lote = (d: Deps, anfitriaoId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops });
  const daTela = (d: Deps, quadroId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, quadro: quadroId, executor: "catcher", ops });
  const comentarios = async (trx: Tx) => {
    await vincularEscopo(trx, DONA.escopo);
    return (await trx`select texto from quadro_comentarios order by criado_em`).map((r) => r.texto as string);
  };

  async function montar(trx: Tx) {
    const sufixo = Math.random().toString(36).slice(2, 7);
    for (const p of [ANA, BIA]) await (await como(trx, p.escopo)).repos.preferencias.gravar({ experimentos: { quadro: true } });
    const dd = await como(trx, DONA.escopo);
    await dd.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const ada = await agenteComConversa(trx, DONA.escopo, { nome: `Ada ${sufixo}` });
    expect((await lote(dd, ada.agenteId, [{ tipo: "criar_quadro", meta: "Lançar login" }, { tipo: "criar_tarefa", titulo: "T1", agente: `Ada ${sufixo}` }])).data).toMatchObject({ ok: true });
    return { dd, ada, qid: (await dd.repos.quadros.doAgente(ada.agenteId))!.id };
  }

  it("quem nunca participou, quem saiu e quem sai entre a porta e a trava: nenhum grava comentário nem aciona bot", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      expect((await lote(m.dd, m.ada.agenteId, [{ tipo: "adicionar_pessoa", pessoa: ANA.nome }])).data).toMatchObject({ ok: true });
      // A participante comenta (o caminho feliz da rota nova).
      expect((await daTela(await como(trx, ANA.escopo), m.qid, [{ tipo: "comentar", tarefa: "T1", texto: "Da Ana" }])).data).toMatchObject({ ok: true });

      // Quem nunca participou: a porta não acha o quadro (o mesmo de um id que não existe).
      expect((await daTela(await como(trx, BIA.escopo), m.qid, [{ tipo: "comentar", tarefa: "T1", texto: "Da Bia" }])).data).toMatchObject({ ok: false });

      // A Ana sai: o comentário dela não entra mais.
      expect((await lote(await como(trx, DONA.escopo), m.ada.agenteId, [{ tipo: "tirar_pessoa", pessoa: ANA.nome }])).data).toMatchObject({ ok: true });
      expect((await daTela(await como(trx, ANA.escopo), m.qid, [{ tipo: "comentar", tarefa: "T1", texto: "Ana fora" }])).data).toMatchObject({ ok: false });

      // A corrida: a porta já abriu (escopo da dona, pedidoPor da Ana) e a Ana saiu antes da trava. A conferência sob a
      // trava recusa, como a do lote.
      const corrida = await executar(await como(trx, DONA.escopo), aplicarLoteQuadro, { autor: { tipo: "pessoa" }, quadro: m.qid, executor: "catcher", pedidoPor: ANA.id, ops: [{ tipo: "comentar", tarefa: "T1", texto: "Na corrida" }] });
      expect(corrida.data).toMatchObject({ ok: false, erro: "nao_encontrado" });

      expect(await comentarios(trx)).toEqual(["Da Ana"]);
    });
  });

  // Os chips do comentário (agora, no lugar, não aciona) são da dona; os de quem participa são ignorados e vale a rota
  // padrão. O teste dos chips em quadro-pessoas.test.ts usa "no_lugar" num turno ainda na fila (onde o chip não vale), e
  // não pegava o mutante que deixava quem participa usar os chips.
  it("quem participa não escolhe os chips: o \"não aciona\" dela é ignorado e o responsável começa", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      expect((await lote(m.dd, m.ada.agenteId, [{ tipo: "adicionar_pessoa", pessoa: ANA.nome }])).data).toMatchObject({ ok: true });
      const r = await daTela(await como(trx, ANA.escopo), m.qid, [{ tipo: "comentar", tarefa: "T1", texto: "Olha isso", acionar: { [m.ada.agenteId]: "nao" } }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true, comecaram: [expect.objectContaining({ agenteId: m.ada.agenteId })] });
      // A dona, sim: o "não aciona" dela tira o responsável.
      const d = await daTela(await como(trx, DONA.escopo), m.qid, [{ tipo: "criar_tarefa", titulo: "T2", agente: (await m.dd.repos.agentes.buscar(m.ada.agenteId))!.nome }]);
      expect(d.data).toMatchObject({ ok: true });
      const daDona = await daTela(await como(trx, DONA.escopo), m.qid, [{ tipo: "comentar", tarefa: "T2", texto: "Só anotando", acionar: { [m.ada.agenteId]: "nao" } }]);
      expect(daDona.data, JSON.stringify(daDona.data)).toMatchObject({ ok: true, comecaram: [] });
    });
  });
});
