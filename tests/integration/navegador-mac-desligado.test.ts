import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { rotasNavegador } from "../../src/adapters/http/rotas/navegador.ts";
import type { PayloadNavegadorPergunta, RespostaLugarNavegador } from "../../src/contracts/navegador-do-bot.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_NAVEGADOR } from "../../src/domain/acoes/navegador.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { cartaoDaEspera, perguntarNaRotina, retomarAoLigarOMac } from "../../src/use-cases/navegador-mac-desligado.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-190 (quadros M2/J1, J2, M3/K1, J0): os cartões do Mac desligado no Postgres — a pergunta vem uma vez por bot (rotina
 * numa hora em que o Mac costuma estar desligado, ou rotina que usa o navegador com o Mac desligado), a resposta fica
 * marcada (0182) e o pedido feito pela conversa com o Mac desligado continua com "Fazer agora" ou quando o Mac liga.
 */
const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-20T15:30:00Z");
/** 2026-11-21 06:00 UTC = 3h em São Paulo. */
const AS_3H = Date.parse("2026-11-21T06:00:00Z");
let trxAtual: Tx | null = null;

const comNavegador = (trx: Tx): Deps => {
  const { deps } = depsSobre(trx, MARLON, { agora: () => AGORA });
  deps.services.navegadores = { disponivel: () => true } as never;
  return deps;
};
const dentro: DentroDeTx = async (escopo, fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(comNavegador(trxAtual));
};

async function maquina(trx: Tx, nome: string, plataforma: "linux" | "darwin") {
  const { repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const c = (await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
  await repos.maquinaTokens.registrarPlataforma(c.id, plataforma);
  return c.id;
}

const cartoes = async (d: Deps, conversaId: string) => (await d.repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.payload?.kind === "navegador_pergunta");

describeIntegracao("navegador: os cartões do Mac desligado (ADR-190, M2/J1, K1)", () => {
  let srv: ServidorDeTeste;
  beforeAll(async () => { srv = await servidorDeTeste(rotasNavegador({ disponivel: () => true } as never, { dentro, ligadas: () => [] })); });
  afterAll(() => srv.close());

  it("o registro tem a ação do cartão com o caminho parcial pela ajustar_navegador", () => {
    expect(ACOES_NAVEGADOR.find((a) => a.id === "navegador.mac_desligado")).toMatchObject({ cartaoNoChat: true, chat: { estado: "parcial", via: { ferramenta: "ajustar_navegador" } } });
  });

  it("a pergunta vem na rotina das 3h (uma vez), não de dia nem sem o app; respondida pela rota, a linha sabe", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const d = comNavegador(trx);
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      // Sem o app no computador: não há Mac para desligar.
      expect(await perguntarNaRotina(d, { id: "r0", agenteId: ada.agenteId, proximaExecucao: AS_3H, fusoIana: "America/Sao_Paulo" })).toBe(false);
      await maquina(trx, "Mac da pessoa", "darwin");
      // De dia (12h em São Paulo): o Mac costuma estar ligado.
      expect(await perguntarNaRotina(d, { id: "r1", agenteId: ada.agenteId, proximaExecucao: Date.parse("2026-11-21T15:00:00Z"), fusoIana: "America/Sao_Paulo" })).toBe(false);
      expect(await perguntarNaRotina(d, { id: "r2", agenteId: ada.agenteId, proximaExecucao: AS_3H, fusoIana: "America/Sao_Paulo" })).toBe(true);
      expect(await perguntarNaRotina(d, { id: "r3", agenteId: ada.agenteId, proximaExecucao: AS_3H, fusoIana: "America/Sao_Paulo" })).toBe(false);
      const [c] = await cartoes(d, ada.conversaId);
      expect(c).toMatchObject({ kind: "sistema", texto: "Às 3h seu Mac costuma estar desligado", payload: { kind: "navegador_pergunta", pergunta: "continuar_sem_mac", hora: "Às 3h", nomeDoAparelho: "seu Mac", rotinaId: "r2" } satisfies Partial<PayloadNavegadorPergunta> });
      expect(await cartoes(d, ada.conversaId)).toHaveLength(1);

      const sessao = await srv.entrar("marlon");
      const painel = async () => (await (await srv.chamar(sessao, "GET", `/agentes/${ada.agenteId}/navegador/lugar`)).json()) as RespostaLugarNavegador;
      expect(await painel()).toMatchObject({ respondeu: false, continuaSemMac: false, disponivel: true });
      const r = await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, { continuaSemMac: true });
      expect(await r.json()).toMatchObject({ ok: true, respondeu: true, continuaSemMac: true, subtitulo: "A Ada continua no nod" });
      // Desfazer (a mesma rota): a resposta segue registrada, agora "só com o Mac ligado".
      await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, { continuaSemMac: false });
      expect(await painel()).toMatchObject({ respondeu: true, continuaSemMac: false });
    });
  });

  it("rotina usando o navegador com o Mac desligado: a pergunta (se não respondeu); pedido pela conversa: o cartão K1", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const d = comNavegador(trx);
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await maquina(trx, "Mac da pessoa", "darwin");
      const instrucaoDaRotina = await cartaoDaEspera(d, { agenteId: ada.agenteId, turnoId: "00000000-0000-4000-8000-0000000000f1", modoTurno: "rotina" });
      expect(instrucaoDaRotina).toContain("não repita a pergunta");
      expect(await cartaoDaEspera(d, { agenteId: ada.agenteId, turnoId: "00000000-0000-4000-8000-0000000000f2", modoTurno: "rotina" })).toBeNull();
      const instrucao = await cartaoDaEspera(d, { agenteId: ada.agenteId, turnoId: "00000000-0000-4000-8000-0000000000f3", modoTurno: "conversa" });
      expect(instrucao).toContain("Fazer agora");
      expect((await cartoes(d, ada.conversaId)).map((m) => [m.texto, (m.payload as PayloadNavegadorPergunta).pergunta])).toEqual([
        ["Às 12h30 seu Mac costuma estar desligado", "continuar_sem_mac"],
        ["Seu Mac está desligado", "mac_desligado"],
      ]);
    });
  });

  it("K1: \"Quando o Mac ligar\" guarda o pedido e o Mac ligando o retoma uma vez; \"Fazer agora\" continua sem o Mac e retoma já", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const d = comNavegador(trx);
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await maquina(trx, "Mac da pessoa", "darwin");
      const pedido = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "vê o preço da TAP", entradaConfianca: "confiavel", modelo: "m" }))!;
      const sessao = await srv.entrar("marlon");
      const responder = (resposta: string, turnoId = pedido.id) => srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/mac-desligado`, { turnoId, resposta });

      expect((await responder("talvez")).status).toBe(400);
      expect((await responder("agora", "00000000-0000-4000-8000-0000000000f9")).status).toBe(404);
      const r = await responder("ao_ligar");
      expect(await r.json()).toMatchObject({ ok: true, turnoId: null, retomarTurnoId: pedido.id, continuaSemMac: false });
      const retomadas = async () => (await d.repos.turnos.listarDaConversa(ada.conversaId)).filter((t) => t.origem === "retomada");
      expect(await retomadas()).toHaveLength(0);
      const ev = await retomarAoLigarOMac(d);
      expect(ev.map((e) => e.kind)).toEqual(["turno_criado"]);
      expect(await retomadas()).toMatchObject([{ retomaTurnoId: pedido.id }]);
      expect(await retomarAoLigarOMac(d)).toEqual([]);

      const agora = await (await responder("agora")).json();
      expect(agora).toMatchObject({ ok: true, continuaSemMac: true, respondeu: true, retomarTurnoId: null });
      // A retomada já na fila recebe a nota nova (uma retomada por turno de origem).
      expect(await retomadas()).toHaveLength(1);
    });
  });
});
