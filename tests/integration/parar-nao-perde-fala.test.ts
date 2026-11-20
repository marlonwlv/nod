import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { confirmarNaSessao, gravarFalasDaSessao, marcarLidosNaSessao } from "../../src/use-cases/sessao-viva.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

/**
 * ADR-185 (2026-11-16): a fala escrita na sessão do turno vivo só é LIDA na fronteira seguinte; o Parar devolve à fila
 * a que o bot não leu e deixa na fila a que ainda esperava atrás do turno. Contra o Postgres (o SQL dos UPDATEs).
 */
describeIntegracao("ADR-185: o Parar não perde o que a pessoa disse", () => {
  async function cenario(trx: Trx) {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
    const vivo = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça 10 tópicos", entradaConfianca: "confiavel", modelo: "m" });
    const machineId = randomUUID();
    expect((await repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(vivo?.id);
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
    const falar = async (texto: string) => (await enviarMensagem(deps, { conversaId, texto, inventario: PRONTO })).data.turno.id;
    return { repos, deps, conversaId, vivo: vivo?.id ?? "", falar, machineId };
  }

  it("a não lida volta a 'pendente'; a lida fica absorvida; a que esperava na fila continua lá", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const naoLida = await c.falar("resume em 3");
      const lida = await c.falar("e em português");
      await confirmarNaSessao(c.deps, { turnoId: c.vivo, executor: "catcher", ids: [naoLida, lida], informaLeitura: true });
      await marcarLidosNaSessao(c.deps, { turnoId: c.vivo, executor: "catcher", ids: [lida] });
      const naFila = await c.falar("ah, e a fonte");

      const conversa = await lerConversa(c.deps, { conversaId: c.conversaId });
      expect(new Map((conversa.data.turnosNaSessao ?? []).map((t) => [t.id, t.lidoEm === null]))).toEqual(new Map([[naoLida, true], [lida, false]]));

      await parar(c.deps, { conversaId: c.conversaId });
      expect(await c.repos.turnos.buscar(naoLida)).toMatchObject({ estado: "pendente", motivoInterrupcao: null, absorvidoPor: null });
      expect(await c.repos.turnos.buscar(lida)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: c.vivo });
      expect((await c.repos.turnos.buscar(naFila))?.estado).toBe("pendente");
    });
  });

  it("sem informar leitura, a absorção nasce lida (como antes) e o Parar não a devolve", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const absorvida = await c.falar("resume em 3");
      await confirmarNaSessao(c.deps, { turnoId: c.vivo, executor: "catcher", ids: [absorvida] });
      expect((await c.repos.turnos.buscar(absorvida))?.lidoNaSessaoEm).not.toBeNull();
      await parar(c.deps, { conversaId: c.conversaId });
      expect((await c.repos.turnos.buscar(absorvida))?.estado).toBe("interrompido");
    });
  });

  it("ADR-186 (revisão): a fala pausada vira retomada quando a resposta seguinte traz a marca (jsonb no Postgres)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await gravarFalasDaSessao(c.deps, { turnoId: c.vivo, machineId: c.machineId, executor: "catcher", textos: ["1. Primeiro Reinado"], interrompidas: [0] });
      await gravarFalasDaSessao(c.deps, { turnoId: c.vivo, machineId: c.machineId, executor: "catcher", textos: ["[[continua]] Dois mais dois é 4."] });
      const falas = (await c.repos.mensagens.listarDaConversa(c.conversaId, 50)).filter((m) => m.turnoId === c.vivo);
      expect(falas.map((m) => [m.texto, m.payload])).toEqual([
        ["1. Primeiro Reinado", { kind: "fala_interrompida", por: "mensagem_nova", retomou: true }],
        ["Dois mais dois é 4.", null],
      ]);
    });
  });
});
