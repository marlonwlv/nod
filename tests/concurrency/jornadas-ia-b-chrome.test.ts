import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { maquinaFalsa, PRONTO, type MaquinaFalsa } from "../helpers/maquina-falsa-http.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { telaDaConversa, VARIACOES, type TelaDaConversa } from "../helpers/tela-da-conversa.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", 2026-11-22): cada caminho do momento B de ponta a ponta — o servidor
 * compartilhado de verdade, máquinas de mentira pela ponte HTTP devolvendo o erro real do fornecedor, e a conversa aberta
 * no app montado num Chrome headless. O teste confere a tela (a linha ou o cartão, o botão, a resposta que chega depois);
 * com NOD_AUDITORIA_DIR, grava os prints numerados de cada passo em claro, escuro e celular para a auditoria.
 */
const WEB = join(process.cwd(), "dist/web");
const DIR = process.env.NOD_AUDITORIA_DIR ?? null;
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
const descrever = chrome ? describeIntegracao : (n: string, f: () => void) => describeIntegracao(`${n} (sem Chrome ou sem a web montada: pulado)`, () => it.skip("sem Chrome", f));

descrever("Jornadas da IA · lote B: mandar uma mensagem", () => {
  let srv: ServidorCompleto;
  let tela: TelaDaConversa;
  const criados = { agentes: [] as string[], conversas: [] as string[] };

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_STATIC_DIR: WEB, NOD_LONGPOLL_MS: "150" } });
    await srv.json<EstadoOnboarding>("GET", "onboarding");
    await srv.json<EstadoOnboarding>("POST", "onboarding/concluir", {});
    tela = await telaDaConversa({ url: srv.url, cookie: srv.pessoa.cookie });
  }, 60_000);

  afterAll(async () => {
    await tela?.fechar();
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  }, 60_000);

  async function bot(nome: string): Promise<{ agenteId: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    return { agenteId: r.agente.id, conversaId: r.conversa.id };
  }

  async function enviar(conversaId: string, texto: string): Promise<string> {
    const r = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto });
    return r.ids.turno ?? "";
  }

  async function assentado(turnoId: string): Promise<Turno> {
    return srv.esperar(async () => {
      const { turno } = await srv.json<{ turno: Turno }>("GET", `turnos/${turnoId}`);
      return ["concluido", "interrompido", "falhou", "cancelado"].includes(turno.estado) ? turno : null;
    }, { nome: `turno ${turnoId} assentado`, timeoutMs: 15_000 });
  }

  /** Os prints de um passo do caminho, nas três variações; `pronto` é o que a tela tem de mostrar. */
  async function printar(caminho: string, passo: string, conversaId: string, pronto: string): Promise<string> {
    let texto = "";
    for (const v of VARIACOES) {
      texto = await tela.abrir({ conversaId, variacao: v, pronto });
      if (DIR) await tela.print(join(DIR, caminho, `${passo}-${v.nome}.png`));
    }
    return texto;
  }

  let mac: MaquinaFalsa;
  beforeAll(async () => {
    mac = await maquinaFalsa(srv, { nome: "MacBook de teste", plataforma: "darwin", harnesses: { "claude-cli": PRONTO("2.1.327") } });
  }, 30_000);

  it("caminho feliz: a pessoa escreve e o bot responde", async () => {
    const { conversaId } = await bot("Bot feliz");
    const turnoId = await enviar(conversaId, "Resume a call de hoje");
    const plano = await mac.puxarAte();
    expect(plano.turnoId).toBe(turnoId);
    expect(await mac.entregar(plano, { desfecho: "sucesso", texto: "Resumi a call: três decisões e dois próximos passos." })).toBe(200);
    expect((await assentado(turnoId)).estado).toBe("concluido");
    const texto = await printar("00-caminho-feliz", "01-resposta", conversaId, `document.body.innerText.includes("três decisões")`);
    expect(texto).toContain("três decisões");
  }, 120_000);

  it("desvio 1 · a sessão sumiu (antes): o aviso genérico de tente de novo", async () => {
    const { conversaId } = await bot("Bot da sessão");
    const turnoId = await enviar(conversaId, "Você não está mergeando os PRs que abre?");
    const plano = await mac.puxarAte();
    expect(await mac.entregar(plano, { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "error_during_execution | No conversation found with session ID: 6413c71a-b189-4a59-8388-a5738582fdd2", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false } })).toBe(200);
    await assentado(turnoId);
    await printar("antes/desvio-01-sessao-sumiu", "01-aviso", conversaId, `document.body.innerText.includes("Turno interrompido") || document.body.innerText.includes("parou")`);
  }, 120_000);
});
