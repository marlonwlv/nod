// ADR-197: o comportamento do bot de ponta a ponta, com um modelo de verdade. Este é um servidor MCP (stdio) que o Claude
// Code usa com o prompt REAL do nod (plano.ts): as seu_computador_* passam pelo portão REAL (src/adapters/fundo/
// seu-computador.ts: plano, esquema, liberação por app, o cartão) e pela fila REAL da máquina (canal + laço do navegador),
// até uma máquina simulada com o Editor de Texto aberto num documento. O cartão "Permitir desta vez" é respondido na hora
// (a pessoa libera) e a ferramenta volta com o recado da liberação, como o proxy faz. As outras ferramentas respondem
// "não use neste teste". No fim, o documento e as chamadas vão para <saida>/resultado.json.
//
// Uso (pelo rodar-ponta-a-ponta.sh): npx tsx ponta-a-ponta.ts <ferramentas.json> <saida>
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarSeuComputador } from "../../../src/adapters/fundo/seu-computador.ts";
import { iniciarNavegadorDaMaquina, type CanalNavegadorDaMaquina } from "../../../src/adapters/executor/navegador.ts";
import { criarCanalNavegador } from "../../../src/adapters/navegador/canal-maquina.ts";
import type { MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import type { PedidoSeuComputador, RespostaSeuComputador } from "../../../src/contracts/seu-computador.ts";

const [arqFerramentas, saida] = process.argv.slice(2) as [string, string];
const tools = JSON.parse(readFileSync(arqFerramentas, "utf8")) as { name: string }[];
const ESCOPO = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const BOT = "00000000-0000-4000-8000-00000000000a";
const MAQ = "00000000-0000-4000-8000-0000000000c1";
const TEXTEDIT = { id: "com.apple.TextEdit", nome: "Editor de Texto" };

// ---- a máquina simulada: o Editor de Texto com "Pauta da semana" aberto ----
let documento = "Pauta da semana\n- Revisar o orçamento\n";
let snapshot = 0;
const liberados: { agenteId: string; plataforma: string; appId: string; appNome: string; ate: number | null }[] = [];
const chamadas: { nome: string; args: unknown; tipo?: string }[] = [];
function maquina(p: PedidoSeuComputador): RespostaSeuComputador {
  const app = String(p.args.app ?? "").toLowerCase();
  if (p.acao === "apps") return { tipo: "apps", apps: [{ ...TEXTEDIT, aberto: true }, { id: "com.apple.Notes", nome: "Notas", aberto: true }, { id: "com.apple.Terminal", nome: "Terminal", aberto: false }] };
  if (/terminal/.test(app)) return { tipo: "bloqueado", app: { id: "com.apple.Terminal", nome: "Terminal" }, motivo: "Este app fica de fora do nod." };
  if (!/editor|textedit|texto/.test(app)) return { tipo: "nao_achei", parecidos: ["Editor de Texto", "Notas"] };
  if (!p.apps.some((a) => a.id === TEXTEDIT.id)) return { tipo: "precisa_liberar", app: TEXTEDIT };
  const s = `s${String(++snapshot).padStart(8, "0")}`;
  switch (p.acao) {
    case "abrir_app": return { tipo: "feito", texto: "Editor de Texto aberto em segundo plano (pid 4242).", app: TEXTEDIT };
    case "ver": return { tipo: "feito", app: TEXTEDIT, texto: `window_id=7 pid=4242 elements=3 snapshot_id=${s}\nelement_token for row [N] = ${s}:N\n\n- [0] AXWindow "Pauta.txt"\n  - [1] AXScrollArea\n    - [2] AXTextArea value=${JSON.stringify(documento)}` };
    case "digitar": {
      const el = String(p.args.elemento ?? "");
      if (el && !/^s\d{8}:2$/.test(el)) return { tipo: "falhou", texto: `element ${el} is not editable` };
      documento += String(p.args.texto ?? "");
      return { tipo: "feito", texto: `Inserted ${String(p.args.texto ?? "").length} char(s) into AXTextArea "Pauta.txt"`, app: TEXTEDIT, efeito: "confirmado" };
    }
    case "tecla": {
      if (String(p.args.tecla).toLowerCase() === "return" || String(p.args.tecla).toLowerCase() === "enter") documento += "\n";
      return { tipo: "feito", texto: `Pressed ${String(p.args.tecla)}`, app: TEXTEDIT, efeito: "confirmado" };
    }
    default: return { tipo: "feito", texto: "ok", app: TEXTEDIT, efeito: "sem_prova" };
  }
}

const canal = criarCanalNavegador({ agora: Date.now });
const daMaquina: CanalNavegadorDaMaquina = {
  puxar: async (recursos) => { canal.presenca(ESCOPO, MAQ, { plataforma: "darwin", nome: "MacBook", recursos: recursos ?? [] }); await new Promise((r) => setTimeout(r, 5)); return canal.puxar(ESCOPO, MAQ); },
  resultado: async (r) => canal.resultado(ESCOPO, MAQ, r),
  vivo: async () => null,
};
iniciarNavegadorDaMaquina({ canal: daMaquina, motor: async () => ({}) as MotorNavegador, dormir: async (ms) => { await new Promise((r) => setTimeout(r, Math.min(ms, 5))); }, seuComputador: { executar: async (_a, p) => maquina(p) } });

let ultimaAcao = "";
const deps = () => ({
  escopo: ESCOPO, agora: () => Date.now(),
  repos: {
    trilha: { registrar: async () => {} },
    turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: BOT, ownerId: ESCOPO.pessoaId, conversaId: "c1", pararSolicitadoEm: null, motivoInterrupcao: null }), pedirInterrupcao: async () => {} },
    agentes: { buscar: async () => ({ id: BOT, ownerId: ESCOPO.pessoaId, nome: "Ada", soLeitura: false }), execucaoBloqueada: async () => false },
    paradas: { ativa: async () => false },
    events: { gravarComOutbox: async () => {} },
    seuComputadorApps: {
      doBot: async () => liberados.map((l) => ({ id: l.appId, nome: l.appNome, ate: l.ate })),
      liberar: async (p: (typeof liberados)[number]) => { liberados.push(p); return true; },
    },
  },
});
const sc = criarSeuComputador({
  dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => fn(deps() as never), canal, cifrar: (s) => s, decifrar: (s) => s,
  pedirAprovacao: (async (_d: unknown, input: { resumo: string; itens: { texto: string; destino: { argumentos: Record<string, unknown> } }[] }) => {
    chamadas.push({ nome: "(cartão)", args: { titulo: input.itens[0]!.texto, texto: input.resumo } });
    ultimaAcao = String(input.itens[0]!.destino.argumentos.acao);
    return { data: { estado: "pendente", decisao_id: "decisao-1", instrucao: "encerre o turno" }, events: [] };
  }) as never,
});
const plano = {
  tenantId: ESCOPO.tenantId, turnoId: "turno-1", agenteId: BOT, conversaId: "c1", expiraEm: Number.MAX_SAFE_INTEGER,
  autoria: { conta_de_execucao: ESCOPO.pessoaId, sob_procuracao_de: null },
  catalogo: { ferramentas: tools.filter((t) => t.name.startsWith("seu_computador_")).map((t) => ({ nome: t.name, origem: "seu_computador" })) },
} as never;

function gravar(): void {
  writeFileSync(join(saida, "resultado.json"), JSON.stringify({ documento, liberados, chamadas }, null, 2));
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<{ content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }> {
  if (!nome.startsWith("seu_computador_")) {
    chamadas.push({ nome, args, tipo: "outra" });
    gravar();
    return { content: [{ type: "text", text: "Esta ferramenta não está disponível neste teste." }], isError: true };
  }
  let r = await sc.chamar(ESCOPO, plano, nome, args);
  if ("aguardar" in r) {
    // A pessoa clica "Permitir desta vez" no cartão; o proxy devolve o recado da decisão ao modelo.
    await sc.executarAprovado({ ...ESCOPO, agenteId: BOT, turnoId: "turno-1", acaoId: "acao-1", acao: ultimaAcao });
    const recado = sc.resultadoDaAcao(ESCOPO, "acao-1") ?? "liberado";
    chamadas.push({ nome, args, tipo: "cartão respondido: Permitir desta vez" });
    gravar();
    return { content: [{ type: "text", text: JSON.stringify({ estado: "decidida", itens: [{ desfecho: "executado", resultado: recado }] }) }] };
  }
  chamadas.push({ nome, args, tipo: "ok" in r ? (r.ok ? (r.isError ? "erro" : "feito") : "negada") : "?" });
  gravar();
  if ("ok" in r && r.ok) return { content: [{ type: "text", text: r.conteudo }], ...(r.isError ? { isError: true } : {}) };
  if ("ok" in r && !r.ok) return { content: [{ type: "text", text: JSON.stringify(r.negacao) }], isError: true };
  r = r as never;
  return { content: [{ type: "text", text: "?" }], isError: true };
}

let buf = "";
const resp = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d: string) => {
  buf += d;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    let m: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } };
    try { m = JSON.parse(l) as typeof m; } catch { continue; }
    if (m.method === "initialize") resp(m.id, { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "1" } });
    else if (m.method === "tools/list") resp(m.id, { tools });
    else if (m.method === "tools/call") void chamar(m.params?.name ?? "", m.params?.arguments ?? {}).then((r) => resp(m.id, r), (e: unknown) => { appendFileSync(join(saida, "erros.log"), `${String(e)}\n`); resp(m.id, { content: [{ type: "text", text: "erro interno" }], isError: true }); });
    else if (m.id !== undefined) resp(m.id, {});
  }
});
gravar();
