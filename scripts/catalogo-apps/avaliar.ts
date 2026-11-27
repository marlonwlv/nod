// XUM-11: eval de escolha de ferramenta ANTES (catálogo inteiro) x DEPOIS (sob demanda) com um modelo de verdade.
// Monta o plano real (montarPlano) dos bots típicos (bots.ts), roda cada pedido de pedidos.json no Claude Code ou no Codex
// do jeito que os drivers do nod rodam (claude: --tools ToolSearch e as MCP adiadas; codex: exec com enabled_tools e o
// isolamento), contra um MCP falso (mcp-falso.ts) que responde apps_buscar/apps_usar com o domínio do servidor.
// Mede: ferramenta certa, argumento certo, passos, erros, tokens de entrada e latência. Grava resultados.jsonl.
//
// Uso: npx tsx scripts/catalogo-apps/avaliar.ts --harness claude|codex --modelo sonnet --rodadas 3 --paralelo 4 --saida <dir> [--pedidos id1,id2] [--condicoes antes,depois]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { montarPlano } from "../../src/domain/plano-turno.ts";
import { OVERRIDES_ISOLAMENTO_CODEX } from "../../src/adapters/executor/drivers/codex-comum.ts";

/** O campo de aprovação do MCP do nod no Codex (o mesmo de codex-comum.ts, que não o exporta). */
const CAMPO_APROVACAO = "default_tools_approval_mode";
import { CENARIOS, entradaDoCenario } from "./bots.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../..");
const TSX = join(RAIZ, "node_modules/.bin/tsx");

const arg = (n: string, padrao: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1]! : padrao; };
const harness = arg("harness", "claude") as "claude" | "codex";
const modelo = arg("modelo", harness === "claude" ? "sonnet" : "gpt-5.6-sol");
const rodadas = Number(arg("rodadas", "1"));
const paralelo = Number(arg("paralelo", "3"));
const saida = resolve(arg("saida", join(RAIZ, "..", "eval")));
const filtro = arg("pedidos", "");
const condicoes = arg("condicoes", "antes,depois").split(",") as ("antes" | "depois")[];

type Pedido = { id: string; cenario: string; tipo: "comum" | "raro" | "sem_ferramenta" | "lugar"; texto: string; espera: string[]; argContem?: string };
const pedidos = (JSON.parse(readFileSync(join(AQUI, "pedidos.json"), "utf8")) as Pedido[]).filter((p) => !filtro || filtro.split(",").includes(p.id));
mkdirSync(saida, { recursive: true });

/** Prepara o plano de cada (condição, cenário) uma vez: prompt, plano.json e a config do MCP falso. */
function preparar(condicao: "antes" | "depois", cenarioId: string): { dir: string; prompt: string; nomes: string[]; esquemaChars: number } {
  const dir = join(saida, "planos", `${harness}-${condicao}-${cenarioId}`);
  mkdirSync(dir, { recursive: true });
  const c = CENARIOS.find((x) => x.id === cenarioId)!;
  const plano = montarPlano(entradaDoCenario(c, { harness: harness === "claude" ? "claude-cli" : "codex-cli", extra: { appsSobDemanda: condicao === "antes" ? null : { teto: 12, usadas: {}, rotina: [] } } }));
  writeFileSync(join(dir, "plano.json"), JSON.stringify(plano));
  writeFileSync(join(dir, "prompt.txt"), plano.promptSistema);
  const esquemaChars = plano.catalogo.ferramentas.reduce((s, f) => s + JSON.stringify({ name: f.nome, description: f.schema.description ?? "", inputSchema: f.schema }).length, 0);
  return { dir, prompt: plano.promptSistema, nomes: plano.catalogo.ferramentas.map((f) => f.nome), esquemaChars };
}

type Execucao = { codigo: number | null; stdout: string; stderr: string; ms: number };
function executar(bin: string, args: string[], opcoes: { cwd: string; entrada?: string; timeoutMs: number }): Promise<Execucao> {
  return new Promise((ok) => {
    const t0 = Date.now();
    const p = spawn(bin, args, { cwd: opcoes.cwd, env: { ...process.env, CLAUDECODE: "", CLAUDE_CODE_ENTRYPOINT: "" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    const t = setTimeout(() => p.kill("SIGKILL"), opcoes.timeoutMs);
    p.on("close", (codigo) => { clearTimeout(t); ok({ codigo, stdout, stderr, ms: Date.now() - t0 }); });
    p.stdin.on("error", () => undefined);
    p.on("error", (e) => { clearTimeout(t); ok({ codigo: -1, stdout, stderr: `${stderr}${String(e)}`, ms: Date.now() - t0 }); });
    p.stdin.end(opcoes.entrada ?? "");
  });
}

type Uso = { entrada: number; saida: number; ferramentaBusca: number };

/** As coisas que o pedido cita (ids, pastas, canais), que o mundo fictício do MCP falso faz existir. */
const entidadesDo = (p: Pedido): string => JSON.stringify([...new Set([...(p.texto.match(/\b(?:AAMk[\w-]+|C0\d+|evt-\d+|fld-\d+|cal-[\w-]+|proj-\d+|team-[\w-]+|[0-9a-f]{8})\b/g) ?? []), ...(p.texto.match(/#[\w-]+/g) ?? []).flatMap((c) => [c, c.slice(1)]), ...(p.argContem ? [p.argContem] : [])])]);
async function rodarClaude(prep: ReturnType<typeof preparar>, pedido: Pedido, log: string, trabalho: string): Promise<{ ms: number; uso: Uso; resposta: string; falha: string | null }> {
  const mcp = join(trabalho, "mcp.json");
  writeFileSync(mcp, JSON.stringify({ mcpServers: { nod: { command: TSX, args: [join(AQUI, "mcp-falso.ts"), join(prep.dir, "plano.json"), log, entidadesDo(pedido)] } } }));
  // Entrada em stream-json, como o driver do nod (claude-cli.ts): a mensagem da pessoa vai pelo stdin.
  const mensagem = `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: pedido.texto }] } })}\n`;
  const r = await executar("claude", ["-p", "--input-format", "stream-json", "--model", modelo, "--system-prompt", prep.prompt, "--mcp-config", mcp, "--strict-mcp-config", "--tools", "ToolSearch", "--allowedTools", [...prep.nomes.map((n) => `mcp__nod__${n}`), "ToolSearch"].join(","), "--permission-mode", "default", "--max-turns", "10", "--output-format", "stream-json", "--verbose"], { cwd: trabalho, entrada: mensagem, timeoutMs: 300_000 });
  const uso: Uso = { entrada: 0, saida: 0, ferramentaBusca: 0 };
  let resposta = ""; let falha: string | null = r.codigo === 0 ? null : `saida ${r.codigo}`;
  for (const l of r.stdout.split("\n")) {
    if (!l.trim()) continue;
    try {
      const ev = JSON.parse(l);
      if (ev.type === "assistant") for (const b of ev.message?.content ?? []) if (b.type === "tool_use" && b.name === "ToolSearch") uso.ferramentaBusca++;
      if (ev.type === "result") {
        const u = ev.usage ?? {};
        uso.entrada = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        uso.saida = u.output_tokens ?? 0;
        resposta = String(ev.result ?? "");
        if (ev.is_error) falha = String(ev.subtype ?? "erro");
      }
    } catch { /* linha que não é JSON */ }
  }
  return { ms: r.ms, uso, resposta, falha };
}

async function rodarCodex(prep: ReturnType<typeof preparar>, pedido: Pedido, log: string, trabalho: string): Promise<{ ms: number; uso: Uso; resposta: string; falha: string | null }> {
  const q = JSON.stringify;
  const servidor = `{ command = ${q(TSX)}, args = [${[join(AQUI, "mcp-falso.ts"), join(prep.dir, "plano.json"), log, entidadesDo(pedido)].map((s) => q(s)).join(", ")}], required = true, ${CAMPO_APROVACAO} = "approve", enabled_tools = [${prep.nomes.map((n) => q(n)).join(", ")}], tool_timeout_sec = 120 }`;
  const args = ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--model", modelo,
    "-c", `developer_instructions=${q(prep.prompt)}`, "-c", `mcp_servers={ nod = ${servidor} }`, "-c", 'approval_policy="never"', ...OVERRIDES_ISOLAMENTO_CODEX.flatMap((o) => ["-c", o]), "-"];
  const r = await executar("codex", args, { cwd: trabalho, entrada: pedido.texto, timeoutMs: 300_000 });
  const uso: Uso = { entrada: 0, saida: 0, ferramentaBusca: 0 };
  let resposta = ""; let falha: string | null = r.codigo === 0 ? null : `saida ${r.codigo}: ${r.stderr.slice(-300)}`;
  for (const l of r.stdout.split("\n")) {
    if (!l.trim()) continue;
    try {
      const ev = JSON.parse(l);
      if (ev.type === "turn.completed") { uso.entrada += ev.usage?.input_tokens ?? 0; uso.saida += ev.usage?.output_tokens ?? 0; }
      if (ev.type === "item.completed" && ev.item?.type === "agent_message") resposta = String(ev.item.text ?? "");
      if (ev.type === "turn.failed" || ev.type === "error") falha = JSON.stringify(ev).slice(0, 300);
    } catch { /* idem */ }
  }
  return { ms: r.ms, uso, resposta, falha };
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Chamada = { nome: string; args?: unknown; alvo?: string; erro?: string };

/** O placar de uma execução. */
function avaliar(pedido: Pedido, chamadas: Chamada[], buscaFerramenta: number) {
  const capDe = (c: Chamada) => (c.alvo ?? c.nome).replace(/^[a-z0-9_-]+__/, "");
  const ehApp = (c: Chamada) => c.nome === "apps_usar" || c.nome === "pedir_aprovacao" || /__/.test(c.nome);
  const agiu = (c: Chamada) => ehApp(c) || /^(navegador|computador|seu_computador)_/.test(c.nome);
  let acerto = false; let argOk: boolean | null = null; let passos = chamadas.length + buscaFerramenta;
  if (pedido.tipo === "sem_ferramenta") acerto = !chamadas.some(agiu);
  else if (pedido.tipo === "lugar") acerto = chamadas.find(agiu)?.nome === pedido.espera[0];
  else {
    const i = chamadas.findIndex((c) => !c.erro && pedido.espera.includes(capDe(c)));
    acerto = i >= 0;
    if (acerto) {
      passos = i + 1 + buscaFerramenta;
      if (pedido.argContem) argOk = sem(JSON.stringify(chamadas[i]!.args ?? {})).includes(sem(pedido.argContem));
    } else if (pedido.argContem) argOk = false;
  }
  const errados = chamadas.filter((c) => ehApp(c) && !c.erro && !pedido.espera.includes(capDe(c)) && !/(^|_)(LIST|GET|SEARCH|FETCH|FIND|QUERY)(_|$)/.test(capDe(c))).length;
  return { acerto, argOk, passos, erros: chamadas.filter((c) => c.erro).length, escritaErrada: errados, buscas: chamadas.filter((c) => c.nome === "apps_buscar").length };
}

const resultados = join(saida, "resultados.jsonl");
const preparados = new Map<string, ReturnType<typeof preparar>>();
const fila: { condicao: "antes" | "depois"; pedido: Pedido; rodada: number }[] = [];
for (let rodada = 1; rodada <= rodadas; rodada++) for (const pedido of pedidos) for (const condicao of condicoes) fila.push({ condicao, pedido, rodada });

let feitos = 0;
async function trabalhador(): Promise<void> {
  for (;;) {
    const j = fila.shift();
    if (!j) return;
    const chave = `${j.condicao}-${j.pedido.cenario}`;
    if (!preparados.has(chave)) preparados.set(chave, preparar(j.condicao, j.pedido.cenario));
    const prep = preparados.get(chave)!;
    const trabalho = join(saida, "execucoes", `${harness}-${modelo}-${j.condicao}-${j.pedido.id}-r${j.rodada}`);
    mkdirSync(trabalho, { recursive: true });
    const log = join(trabalho, "chamadas.jsonl");
    writeFileSync(log, "");
    const r = await (harness === "claude" ? rodarClaude : rodarCodex)(prep, j.pedido, log, trabalho);
    // Cada item de pedir_aprovacao com destino de app conta como uma chamada àquela capacidade.
    const chamadas = (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Chamada & { itens?: Chamada[] }) : [])
      .flatMap((c) => c.itens?.length ? c.itens.map((i) => ({ nome: "pedir_aprovacao", alvo: i.alvo, args: i.args, ...(i.erro ? { erro: i.erro } : {}) })) : [c]);
    const placar = avaliar(j.pedido, chamadas, r.uso.ferramentaBusca);
    const linha = { harness, modelo, condicao: j.condicao, pedido: j.pedido.id, tipo: j.pedido.tipo, cenario: j.pedido.cenario, rodada: j.rodada, ...placar, ms: r.ms, tokensEntrada: r.uso.entrada, tokensSaida: r.uso.saida, ferramentasNoPlano: prep.nomes.length, esquemaChars: prep.esquemaChars, chamadas: chamadas.map((c) => c.alvo && c.alvo !== c.nome ? `${c.nome}->${c.alvo}` : `${c.nome}${c.erro ? `!${c.erro}` : ""}`), falha: r.falha, resposta: r.resposta.slice(0, 300) };
    appendFileSync(resultados, `${JSON.stringify(linha)}\n`);
    feitos++;
    process.stdout.write(`[${feitos}] ${harness}/${modelo} ${j.condicao} ${j.pedido.id} r${j.rodada}: ${placar.acerto ? "ok" : "ERRO"} ${linha.chamadas.join(" ")} (${Math.round(r.ms / 1000)}s, ${r.uso.entrada} tok)${r.falha ? ` falha=${r.falha}` : ""}\n`);
  }
}
await Promise.all(Array.from({ length: paralelo }, trabalhador));
process.stdout.write(`fim: ${feitos} execuções em ${resultados}\n`);
