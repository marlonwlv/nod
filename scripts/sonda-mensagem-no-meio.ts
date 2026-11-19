/**
 * Sonda da ADR-186 (2026-11-16): o que acontece com uma mensagem da pessoa que chega enquanto o bot ESCREVE uma resposta
 * longa (sem ferramenta aberta). Mede, contra o Codex de verdade (app-server):
 *  - A: `turn/steer` no meio do texto — o rumo muda no meio, ou só depois do item em curso?
 *  - B: `turn/interrupt` + `turn/start` com a correção na MESMA thread — a thread segue, em quanto tempo responde, e o
 *    modelo lembra o que já tinha escrito (a parcial entrou no histórico)?
 * O lado do Claude Code foi medido em 2026-11-16 com o CLI 2.1.326 (control_request interrupt; ADR-186).
 * Uso: node scripts/sonda-mensagem-no-meio.ts [--modelo gpt-5.6-luna] [--esforco low] [--codex /caminho/do/codex] [--seco]
 * A rodada sem --seco é paga e usa a conta do ChatGPT deste Mac.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { argsAppServer, FLAGS_OPCIONAIS_APP_SERVER } from "../src/adapters/executor/drivers/codex-ligacao.ts";
import { configMcpCodex } from "../src/adapters/executor/drivers/codex-comum.ts";
import { MODELO_LUNA_CODEX } from "../src/contracts/harness.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { montarAmbiente } from "../src/domain/ambiente-executor.ts";
import { molduraMensagemNoMeio } from "../src/domain/mensagem-no-meio.ts";
import {
  ESFORCO_LIGACAO_CODEX,
  type EsforcoCodex,
  type EventoAppServer,
  idDaThread,
  idDoTurno,
  interpretarLinhaAppServer,
  notificacaoInitialized,
  pedidoInitialize,
  pedidoThreadStart,
  pedidoTurnInterrupt,
  pedidoTurnStart,
  pedidoTurnSteer,
  respostaNegando,
} from "../src/domain/codex-app-server.ts";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const seco = process.argv.includes("--seco");
// A rodada paga é do Mac de quem homologa: no CI só o modo seco, e antes de qualquer efeito (nem a pasta temporária).
if (!seco && process.env.CI) {
  process.stderr.write("sonda-mensagem-no-meio: no CI só roda com --seco (a rodada sem --seco é paga e usa a conta do ChatGPT).\n");
  process.exit(2);
}
const modelo = arg("--modelo") ?? MODELO_LUNA_CODEX;
const esforco = (arg("--esforco") ?? ESFORCO_LIGACAO_CODEX) as EsforcoCodex;
const dir = mkdtempSync(join(tmpdir(), "sonda-mensagem-no-meio-"));
const FALSO = fileURLToPath(new URL("../tests/fixtures/codex-falso.mjs", import.meta.url));
// No modo seco o "codex" é o falso rodando no node desta sonda; senão, o do PATH (ou --codex).
const bin = seco ? [process.execPath, FALSO] : [arg("--codex") ?? "codex"];
const env = montarAmbiente("local", process.env);
const linhasSaida: string[] = [];
const brutas: { em: number; linha: string }[] = [];
const inicio = Date.now();
const escrever = (s: string) => {
  linhasSaida.push(s);
  process.stdout.write(`${s}\n`);
};
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rodarSync = (args: string[]) => spawnSync(bin[0]!, [...bin.slice(1), ...args], { env, cwd: dir, encoding: "utf8", timeout: 20_000 });

// O MCP falso, no papel do proxy do nod: expõe só `lembrar` e anota cada tools/call num arquivo ao lado.
const recebido = join(dir, "mcp-recebido.log");
const mcpFalso = join(dir, "mcp-falso.mjs");
writeFileSync(mcpFalso, `import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const tools = [{ name: "lembrar", description: "Guarda um lembrete curto para a pessoa.", inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } }];
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === "tools/call") appendFileSync(${JSON.stringify(recebido)}, JSON.stringify(m.params ?? null) + "\\n");
  if (m.id === undefined) return;
  if (m.method === "initialize") enviar({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "sonda" } } });
  else if (m.method === "ping") enviar({ jsonrpc: "2.0", id: m.id, result: {} });
  else if (m.method === "tools/list") enviar({ jsonrpc: "2.0", id: m.id, result: { tools } });
  else if (m.method === "tools/call") enviar({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "lembrete guardado" }] } });
  else enviar({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "sonda" } });
});
process.stdin.on("end", () => process.exit(0));
`);

// Só os campos que configMcpCodex lê.
const plano = { catalogo: { ferramentas: [{ nome: "lembrar", nomeMcp: "mcp__nod__lembrar" }] }, politicaExecucao: { prazoMs: 30_000 } } as unknown as PlanoTurno;
const configMcp = configMcpCodex(plano, { urlNod: "http://127.0.0.1:9", proxyPath: mcpFalso });

const versao = (rodarSync(["--version"]).stdout ?? "").trim() || "(sem --version)";
const help = rodarSync(["app-server", "--help"]);
const flagsNoHelp = FLAGS_OPCIONAIS_APP_SERVER.filter((f) => `${help.stdout ?? ""}${help.stderr ?? ""}`.includes(f));
escrever(`data: ${new Date().toISOString()}`);
escrever(`codex: ${versao}${seco ? " (seco: app-server falso)" : ""}`);
escrever(`modelo: ${modelo} · esforço: ${esforco} · flags opcionais: ${flagsNoHelp.join(" ") || "(nenhuma)"}`);
if (help.status !== 0) {
  escrever(`app-server --help: saiu ${String(help.status)} (${(help.stderr ?? "").trim().slice(0, 160)})`);
  escrever("veredito: reprovada (Codex sem app-server)");
  finalizar();
  process.exit(1);
}

const proc = spawn(bin[0]!, [...bin.slice(1), ...argsAppServer({ configMcp, flagsNoHelp })], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
const eventos: { em: number; e: EventoAppServer }[] = [];
let resto = "";
let stderr = "";
proc.stderr.on("data", (b: Buffer) => { stderr = (stderr + b.toString("utf8")).slice(-4000); });
proc.stdout.on("data", (b: Buffer) => {
  resto += b.toString("utf8");
  let n: number;
  while ((n = resto.indexOf("\n")) >= 0) {
    const l = resto.slice(0, n);
    resto = resto.slice(n + 1);
    brutas.push({ em: Date.now(), linha: l });
    const e = interpretarLinhaAppServer(l);
    eventos.push({ em: Date.now(), e });
    // Como o laço: todo pedido do servidor é negado na hora (sem resposta, o turno trava).
    if (e.tipo === "pedido_servidor") proc.stdin.write(respostaNegando(e.id, e.metodo));
  }
});
let proximoId = 1;
const mandar = (montar: (id: number) => string) => {
  const id = proximoId++;
  proc.stdin.write(montar(id));
  return id;
};
async function esperar(f: (e: EventoAppServer) => boolean, desde: number, ms = 60_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const a = eventos.find((x) => x.em >= desde && f(x.e));
    if (a) return a;
    await dormir(10);
  }
  return null;
}
const respostaDe = (id: number, desde: number, ms?: number) => esperar((e) => (e.tipo === "resposta" || e.tipo === "resposta_erro") && e.id === id, desde, ms);
const concluido = (turnId: string | null, desde: number, ms?: number) => esperar((e) => e.tipo === "turno_concluido" && (turnId === null || e.turnId === turnId), desde, ms);
const ms = (a: { em: number } | null, t0: number) => (a ? `${a.em - t0} ms` : "não veio");

async function turno(texto: string): Promise<{ t0: number; turnId: string | null }> {
  const t0 = Date.now();
  const id = mandar((i) => pedidoTurnStart(i, { threadId, texto, esforco }));
  const r = await respostaDe(id, t0);
  if (r?.e.tipo !== "resposta") throw new Error(`turn/start falhou: ${r?.e.tipo === "resposta_erro" ? `código ${String(r.e.codigo)}` : "sem resposta"}`);
  return { t0, turnId: idDoTurno(r.e.resultado) };
}
const falaDoTurno = (turnId: string | null, desde: number) => eventos.filter((x) => x.em >= desde && x.e.tipo === "delta" && (turnId === null || x.e.turnId === turnId)).map((x) => (x.e.tipo === "delta" ? x.e.texto : "")).join("");

let threadId = "";
const LONGO = "Escreva um texto de 1500 palavras, em 12 seções com título, sobre a história do chá no mundo.";
const CORRECAO = "Na verdade, só 3 frases.";
const PRIMEIRAS = "Quais eram as 5 primeiras palavras do texto longo que você começou a escrever antes de eu mudar o pedido? Responda só elas.";
const ateNChars = (turnId: string | null, desde: number, n: number) => esperar(() => falaDoTurno(turnId, desde).length >= n, desde, 90_000);

async function main(): Promise<void> {
  const t0 = Date.now();
  const init = await respostaDe(mandar((i) => pedidoInitialize(i, { nome: "nod-sonda", versao: "0" })), t0, 20_000);
  if (init?.e.tipo !== "resposta") throw new Error(`initialize: ${init ? "erro" : "sem resposta"}`);
  proc.stdin.write(notificacaoInitialized());

  // A: steer no meio do texto longo.
  let thread = await respostaDe(mandar((i) => pedidoThreadStart(i, { modelo, instrucoes: "Responda em português do Brasil.", cwd: dir })), Date.now(), 20_000);
  threadId = thread?.e.tipo === "resposta" ? (idDaThread(thread.e.resultado) ?? "") : "";
  if (!threadId) throw new Error("thread/start (A) sem thread");
  const a = await turno(LONGO);
  await ateNChars(a.turnId, a.t0, 400);
  const antesSteer = falaDoTurno(a.turnId, a.t0).length;
  const tS = Date.now();
  const rS = await respostaDe(mandar((i) => pedidoTurnSteer(i, { threadId, texto: molduraMensagemNoMeio(CORRECAO), turnoEsperado: a.turnId ?? "" })), tS, 15_000);
  const cA = await concluido(a.turnId, a.t0, 180_000);
  const falaA = falaDoTurno(a.turnId, a.t0);
  escrever(`A steer: ${rS?.e.tipo === "resposta" ? `aceito em ${rS.em - tS} ms` : "RECUSADO"} com ${antesSteer} chars escritos · o turno terminou com ${falaA.length} chars em ${ms(cA, tS)} depois do steer (status ${cA?.e.tipo === "turno_concluido" ? cA.e.status : "?"})`);
  escrever(`A fim da fala: "${falaA.slice(-200).replace(/\n/g, " ")}"`);

  // B: interrupt + turno novo com a correção, na mesma thread.
  thread = await respostaDe(mandar((i) => pedidoThreadStart(i, { modelo, instrucoes: "Responda em português do Brasil.", cwd: dir })), Date.now(), 20_000);
  threadId = thread?.e.tipo === "resposta" ? (idDaThread(thread.e.resultado) ?? "") : "";
  if (!threadId) throw new Error("thread/start (B) sem thread");
  const b = await turno(LONGO);
  await ateNChars(b.turnId, b.t0, 400);
  const parcial = falaDoTurno(b.turnId, b.t0);
  const tI = Date.now();
  const rI = await respostaDe(mandar((i) => pedidoTurnInterrupt(i, { threadId, turnId: b.turnId ?? "" })), tI, 15_000);
  const cB = await concluido(b.turnId, tI, 20_000);
  escrever(`B interrupt: resposta ${ms(rI, tI)} · turno ${cB?.e.tipo === "turno_concluido" ? cB.e.status : "não concluiu"} em ${ms(cB, tI)} · parcial ${parcial.length} chars: "${parcial.slice(0, 60).replace(/\n/g, " ")}"`);
  const c = await turno(molduraMensagemNoMeio(CORRECAO));
  const d1 = await esperar((e) => e.tipo === "delta" && e.turnId === c.turnId, c.t0, 60_000);
  const cC = await concluido(c.turnId, c.t0, 90_000);
  const falaC = falaDoTurno(c.turnId, c.t0);
  escrever(`B correção: 1º delta ${ms(d1, tI)} depois do interrupt · resposta completa em ${ms(cC, tI)} · ${falaC.length} chars: "${falaC.slice(0, 200).replace(/\n/g, " ")}"`);
  const p = await turno(PRIMEIRAS);
  const cP = await concluido(p.turnId, p.t0, 60_000);
  escrever(`B lembra a parcial? "${falaDoTurno(p.turnId, p.t0).replace(/\n/g, " ")}" (a parcial começava: "${parcial.slice(0, 50).replace(/\n/g, " ")}") ${cP ? "" : "(não concluiu)"}`);
}

function finalizar(): void {
  const saida = arg("--saida");
  if (saida) writeFileSync(saida, `${linhasSaida.join("\n")}\n`);
  const bruto = arg("--bruto");
  if (bruto) for (const b of brutas) appendFileSync(bruto, `${JSON.stringify({ ms: b.em - inicio, linha: b.linha })}\n`);
}

main()
  .catch((e: unknown) => escrever(`erro: ${e instanceof Error ? e.message : String(e)} · stderr: ${stderr.slice(-300)}`))
  .finally(() => { proc.kill(); finalizar(); setTimeout(() => process.exit(0), 300); });
