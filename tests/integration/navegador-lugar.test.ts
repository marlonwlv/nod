import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { rotasNavegador } from "../../src/adapters/http/rotas/navegador.ts";
import type { RespostaLugarNavegador } from "../../src/contracts/navegador-do-bot.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_NAVEGADOR } from "../../src/domain/acoes/navegador.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { ajustarNavegador } from "../../src/use-cases/ajustar-navegador.ts";
import { removerMaquina } from "../../src/use-cases/interromper-por-maquina.ts";
import { aoConectarMaquina, avisarForaDoAr, decidirLugarDoNavegador, type MaquinaLigada } from "../../src/use-cases/navegador-lugar.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-190 (decisão 5, quadros M e N): onde o navegador do bot mora, no Postgres. É o teste de contrato de `navegador.lugar`
 * (src/domain/acoes/navegador.ts): a mesma mudança pela tela (POST /agentes/:id/navegador/lugar) e pelo chat
 * (`ajustar_navegador` do próprio bot, a pedido da pessoa) leva ao mesmo estado. E os lados do lugar que só o banco sabe:
 * a decisão (0/1/várias máquinas, fora do ar, travada, sem app, Mac desligado) e as linhas na conversa quando algo muda.
 */
const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-20T15:30:00Z");
let trxAtual: Tx | null = null;
const dentro: DentroDeTx = async (escopo, fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(depsSobre(trxAtual, escopo, { agora: () => AGORA }).deps);
};
let ligadas: MaquinaLigada[] = [];

async function maquina(trx: Tx, nome: string, plataforma: "linux" | "darwin" | "win32") {
  const { repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const c = (await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
  await repos.maquinaTokens.registrarPlataforma(c.id, plataforma);
  // A ordem de conexão é o criado_em: cada máquina nasce um instante depois da anterior.
  await trx`select pg_sleep(0.002)`;
  return c.id;
}

async function turnoDaConversa(trx: Tx, bot: { agenteId: string; conversaId: string }, o: { confianca?: "confiavel" | "nao_confiavel" } = {}) {
  const { repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  return (await repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "usa a vm-rio", entradaConfianca: o.confianca ?? "confiavel", modelo: "m" }))!;
}

describeIntegracao("navegador.lugar: tela × chat (ADR-190, N; ADR-135)", () => {
  let srv: ServidorDeTeste;
  beforeAll(async () => { srv = await servidorDeTeste(rotasNavegador({ disponivel: () => true } as never, { dentro, ligadas: () => ligadas })); });
  afterAll(() => srv.close());

  it("o registro aponta para este contrato, com o executor único e a ajustar_navegador", () => {
    expect(ACOES_NAVEGADOR.find((a) => a.id === "navegador.lugar")).toMatchObject({ casoDeUso: "navegador.lugar", chat: { estado: "vivo", via: { ferramenta: "ajustar_navegador" }, contrato: "tests/integration/navegador-lugar.test.ts" } });
  });

  it("a mesma mudança pela rota e pela ajustar_navegador leva ao mesmo estado, e a rota devolve os textos com o nome do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      ligadas = [];
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      await maquina(trx, "Mac da pessoa", "darwin");
      const vmSp = await maquina(trx, "vm-sp", "linux");
      const vmRio = await maquina(trx, "vm-rio", "linux");
      const sessao = await srv.entrar("marlon");
      const painel = async (id: string) => (await (await srv.chamar(sessao, "GET", `/agentes/${id}/navegador/lugar`)).json()) as RespostaLugarNavegador;
      const { repos } = depsSobre(trx, MARLON, { agora: () => AGORA });

      const antes = await painel(ada.agenteId);
      expect(antes).toMatchObject({ continuaSemMac: false, maquinaId: null, soNaMaquina: false, temApp: true, nomeDoAparelho: "seu Mac", agora: null, subtitulo: "A Ada espera o Mac ligar" });
      expect(antes.maquinas).toEqual([{ id: vmSp, nome: "vm-sp", ligada: false }, { id: vmRio, nome: "vm-rio", ligada: false }]);

      // Tela: "Na vm-rio" para a Ada. Chat: a Bia ouve "usa a vm-rio" e chama ajustar_navegador.
      const r = await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, { maquinaId: vmRio });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, continuaSemMac: true, maquinaId: vmRio, subtitulo: "A Ada continua na vm-rio", frasePergunta: { lugar: "na vm-rio", trocar: true } });
      const turno = await turnoDaConversa(trx, bia);
      const pelaConversa = await ajustarNavegador(depsSobre(trx, MARLON, { agora: () => AGORA }).deps, { ...contexto(bia.agenteId, bia.conversaId, turno.id), maquina: "VM-Rio" });
      expect(pelaConversa.data).toEqual({ ok: true, onde: "A Bia continua na vm-rio", instrucao: expect.any(String) });
      const estado = async (id: string) => { const p = await repos.navegadorPreferencias.buscar(id); return p && { continuaSemMac: p.continuaSemMac, maquinaId: p.maquinaId, noNod: p.noNod, soNaMaquina: p.soNaMaquina }; };
      expect(await estado(bia.agenteId)).toEqual(await estado(ada.agenteId));

      // "Volta para o nod" e "Só com o Mac ligado", dos dois lados.
      await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, { maquinaId: "nod" });
      await ajustarNavegador(depsSobre(trx, MARLON, { agora: () => AGORA }).deps, { ...contexto(bia.agenteId, bia.conversaId, turno.id), maquina: "nod" });
      expect(await estado(ada.agenteId)).toEqual({ continuaSemMac: true, maquinaId: null, noNod: true, soNaMaquina: false });
      expect(await estado(bia.agenteId)).toEqual(await estado(ada.agenteId));
      expect((await painel(ada.agenteId)).maquinaId).toBe("nod");
      await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, { continuaSemMac: false });
      await ajustarNavegador(depsSobre(trx, MARLON, { agora: () => AGORA }).deps, { ...contexto(bia.agenteId, bia.conversaId, turno.id), continuar_sem_mac: false });
      expect(await estado(bia.agenteId)).toEqual(await estado(ada.agenteId));
      expect(await estado(ada.agenteId)).toMatchObject({ continuaSemMac: false });
    });
    trxAtual = null;
  });

  it("recusas: corpo torto é 400, máquina que não é sempre ligada é 400; no chat, nome que não bate devolve as opções e conteúdo de fora não muda nada", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const mac = await maquina(trx, "Mac da pessoa", "darwin");
      await maquina(trx, "vm-sp", "linux");
      const sessao = await srv.entrar("marlon");
      for (const corpo of [{}, { maquinaId: "x" }, { continuaSemMac: "sim" }, { outra: true }]) {
        expect((await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, corpo)).status).toBe(400);
      }
      expect((await srv.chamar(sessao, "POST", `/agentes/${ada.agenteId}/navegador/lugar`, { maquinaId: mac })).status).toBe(400);
      const d = depsSobre(trx, MARLON, { agora: () => AGORA }).deps;
      const turno = await turnoDaConversa(trx, ada);
      expect((await ajustarNavegador(d, { ...contexto(ada.agenteId, ada.conversaId, turno.id), maquina: "vm-xx" })).data).toEqual({ ok: false, erro: "maquina_inexistente", opcoes: ["vm-sp", "nod"], instrucao: expect.any(String) });
      expect((await ajustarNavegador(d, { ...contexto(ada.agenteId, ada.conversaId, turno.id) })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      const deFora = await turnoDaConversa(trx, ada, { confianca: "nao_confiavel" });
      expect((await ajustarNavegador(d, { ...contexto(ada.agenteId, ada.conversaId, deFora.id), continuar_sem_mac: true })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });
      expect(await d.repos.navegadorPreferencias.buscar(ada.agenteId)).toBeNull();
      // QA-235: duas máquinas com o mesmo nome (o nome não é único). A recusa não diz "não está na conta": diz que há duas
      // e dá o id de cada uma, que o bot pode mandar no lugar do nome.
      const vmSp = (await d.repos.maquinaTokens.vivasComPlataforma()).find((v) => v.nome === "vm-sp")!.id;
      const outraSp = await maquina(trx, "vm-sp", "linux");
      const ambigua = (await ajustarNavegador(d, { ...contexto(ada.agenteId, ada.conversaId, turno.id), maquina: "vm-sp" })).data;
      expect(ambigua).toMatchObject({ ok: false, erro: "maquina_inexistente" });
      expect(JSON.stringify(ambigua)).not.toContain("não está na conta");
      expect(JSON.stringify(ambigua)).toContain(vmSp);
      expect(JSON.stringify(ambigua)).toContain(outraSp);
      expect((await ajustarNavegador(d, { ...contexto(ada.agenteId, ada.conversaId, turno.id), maquina: outraSp })).data).toMatchObject({ ok: true });
    });
    trxAtual = null;
  });
});

describeIntegracao("navegador: o lugar decidido (ADR-190, decisão 5)", () => {
  it("sem app, Mac desligado, app sem o navegador, 0/1/várias máquinas, fora do ar (desvio) e travada (espera)", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobre(trx, MARLON, { agora: () => AGORA }).deps;
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const decidir = (ligadasAgora: MaquinaLigada[], conectadas: MaquinaLigada[] = ligadasAgora) => decidirLugarDoNavegador(d, ada.agenteId, { ligadas: ligadasAgora, conectadas });

      // Sem app no computador (só web): sempre fora do Mac; sem máquina, no nod.
      expect(await decidir([])).toEqual({ tipo: "roda", lugar: { tipo: "nod" }, desvio: null });
      const mac = await maquina(trx, "Mac", "darwin");
      // Com o app e o interruptor desligado (padrão): Mac desligado espera; conectado sem puxar o navegador pede atualizar.
      expect(await decidir([])).toMatchObject({ tipo: "espera", motivo: "aparelho_desligado", causa: "Seu Mac está desligado" });
      expect(await decidir([], [{ maquinaId: mac, plataforma: "darwin" }])).toMatchObject({ tipo: "espera", motivo: "app_sem_navegador" });
      expect(await decidir([{ maquinaId: mac, plataforma: "darwin" }])).toEqual({ tipo: "roda", lugar: { tipo: "mac", nome: "seu Mac" }, desvio: null });

      // Continuar com o Mac desligado: 0 máquinas = nod; 1 = ela; várias = a primeira conectada (ou a escolhida).
      await d.repos.navegadorPreferencias.gravar(ada.agenteId, { continuaSemMac: true }, AGORA);
      expect(await decidir([])).toEqual({ tipo: "roda", lugar: { tipo: "nod" }, desvio: null });
      const vmSp = await maquina(trx, "vm-sp", "linux");
      expect(await decidir([{ maquinaId: vmSp, plataforma: "linux" }])).toEqual({ tipo: "roda", lugar: { tipo: "maquina", maquinaId: vmSp, nome: "vm-sp" }, desvio: null });
      const vmRio = await maquina(trx, "vm-rio", "linux");
      const ambas: MaquinaLigada[] = [{ maquinaId: vmSp, plataforma: "linux" }, { maquinaId: vmRio, plataforma: "linux" }];
      expect(await decidir(ambas)).toMatchObject({ lugar: { maquinaId: vmSp } });
      await d.repos.navegadorPreferencias.gravar(ada.agenteId, { maquinaId: vmRio }, AGORA);
      expect(await decidir(ambas)).toMatchObject({ lugar: { maquinaId: vmRio } });

      // A escolhida fora do ar: roda no nod desta vez (desvio com o id e o nome); travada "Só na vm-rio": espera.
      expect(await decidir([{ maquinaId: vmSp, plataforma: "linux" }])).toEqual({ tipo: "roda", lugar: { tipo: "nod" }, desvio: { maquinaId: vmRio, nome: "vm-rio" } });
      await d.repos.navegadorPreferencias.gravar(ada.agenteId, { soNaMaquina: true }, AGORA);
      expect(await decidir([{ maquinaId: vmSp, plataforma: "linux" }])).toMatchObject({ tipo: "espera", motivo: "maquina_fora_do_ar", causa: "A vm-rio está fora do ar" });
      // "Volta para o nod" ganha das máquinas ligadas.
      await d.repos.navegadorPreferencias.gravar(ada.agenteId, { noNod: true, maquinaId: null }, AGORA);
      expect(await decidir(ambas)).toEqual({ tipo: "roda", lugar: { tipo: "nod" }, desvio: null });
    });
  });
});

describeIntegracao("navegador: as linhas na conversa quando o lugar muda sozinho (N)", () => {
  it("a primeira máquina sempre ligada avisa quem continua sem Mac (com Desfazer); a segunda não; a que sai volta o bot para o nod", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobre(trx, MARLON, { agora: () => AGORA }).deps;
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      const caio = await agenteComConversa(trx, MARLON, { nome: "Caio" });
      await d.repos.navegadorPreferencias.gravar(ada.agenteId, { continuaSemMac: true }, AGORA);
      await d.repos.navegadorPreferencias.gravar(bia.agenteId, { continuaSemMac: false }, AGORA);
      await d.repos.navegadorPreferencias.gravar(caio.agenteId, { continuaSemMac: true, noNod: true }, AGORA);
      const linhas = async (conversaId: string) => (await d.repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.payload?.kind === "navegador_lugar");

      const vmSp = await maquina(trx, "vm-sp", "linux");
      expect(await aoConectarMaquina(d, vmSp)).toBe(1);
      expect(await linhas(ada.conversaId)).toMatchObject([{ kind: "sistema", texto: "Com o Mac desligado, agora continuo na vm-sp.", payload: { kind: "navegador_lugar", aviso: "passou_para_maquina", maquinaId: vmSp, nome: "vm-sp", acao: { rotulo: "Desfazer", mudar: { maquinaId: "nod" } } } }]);
      expect(await linhas(bia.conversaId)).toEqual([]);
      expect(await linhas(caio.conversaId)).toEqual([]);
      const vmRio = await maquina(trx, "vm-rio", "linux");
      expect(await aoConectarMaquina(d, vmRio)).toBe(0);

      // Fora do ar: a linha com "Só na vm-sp, mesmo que atrase" (hora no fuso das frases).
      await avisarForaDoAr(d, ada.agenteId, { id: vmSp, nome: "vm-sp" });
      expect((await linhas(ada.conversaId)).at(-1)).toMatchObject({ texto: "A vm-sp estava fora do ar às 12h30. Fiz no nod.", payload: { aviso: "fez_no_nod", acao: { rotulo: "Só na vm-sp, mesmo que atrase", mudar: { soNaMaquina: true } } } });

      // A Ada escolhe a vm-rio; a vm-rio sai da conta: ela volta para o nod e a conversa diz.
      await d.repos.navegadorPreferencias.gravar(ada.agenteId, { maquinaId: vmRio }, AGORA);
      expect((await removerMaquina(d, vmRio)).revogou).toBe(true);
      expect((await linhas(ada.conversaId)).at(-1)).toMatchObject({ texto: "A vm-rio saiu da sua conta. Continuo no nod.", payload: { aviso: "maquina_saiu", acao: null } });
      expect(await d.repos.navegadorPreferencias.buscar(ada.agenteId)).toMatchObject({ maquinaId: null, noNod: true, continuaSemMac: true });
    });
  });
});
