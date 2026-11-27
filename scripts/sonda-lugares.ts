/**
 * Sonda dos lugares do bot (definido em 2026-11-27, ADR-198): o servidor de verdade, com o Claude Code e o Codex de
 * verdade, percorrendo os cenários em que um lugar do bot (computador, navegador) cai, entra ou volta no meio de uma
 * conversa. PAGA: usa as assinaturas (cerca de 15 turnos curtos por IA). Não entra no `check` nem na CI.
 *
 * Responde ao que a suíte não tem como responder sem o modelo: depois que um lugar volta, o bot CHAMA a ferramenta dele
 * ou segue respondendo "indisponível" de memória? A regra de sessão está coberta por
 * tests/integration/sessao-segue-os-lugares.test.ts; aqui se mede o comportamento do modelo com ela.
 *
 * Origem: em produção, um bot seguiu dizendo "o navegador continua indisponível" por dias, com as ferramentas do
 * navegador no plano e zero chamadas. Rode esta sonda quando mexer no texto dos lugares em `prompt-sistema.ts`, na regra
 * de `lugares-da-sessao.ts`, ou quando o Claude Code ou o Codex mudarem de versão.
 *
 * O script sobe e derruba o servidor ele mesmo (cada fase de um cenário é um boot com outras variáveis). Só roda contra
 * banco EFÊMERO (`npm run db:efemero:up -- <nome> <porta>`): ele escreve direto em `agentes` e `computadores`.
 *
 * Uso:
 *   DATABASE_URL=postgres://nod_app:nod@127.0.0.1:5457/nod DATABASE_URL_DONO=postgres://nod_dono:nod@127.0.0.1:5457/nod \
 *     node scripts/sonda-lugares.ts [--ia claude-cli,codex-cli] [--cenario origem,volta,memoria,sai-e-volta] \
 *       [--porta 8897] [--codex /caminho/do/codex] [--saida /tmp/sonda-lugares.json] [--rotulo depois]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { criarDb } from "../src/db/client.ts";
import { abrirTxEscopada } from "../src/db/tx.ts";

const arg = (nome: string, padrao: string): string => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : padrao;
};
const url = process.env.DATABASE_URL ?? "";
if (!/:(543[5-9]|54[4-9][0-9])\//.test(url)) {
  process.stderr.write("sonda-lugares: DATABASE_URL precisa ser de um banco efêmero (porta 5435 a 5499)\n");
  process.exit(2);
}
const PORTA = Number(arg("porta", "8897"));
const API = `http://127.0.0.1:${PORTA}`;
const IAS = arg("ia", "claude-cli,codex-cli").split(",") as Ia[];
const CENARIOS = arg("cenario", "origem,volta,memoria,sai-e-volta").split(",");
const ROTULO = arg("rotulo", "rodada");
const SAIDA = arg("saida", join(tmpdir(), `sonda-lugares-${ROTULO}.json`));
const CODEX = arg("codex", process.env.NOD_CODEX_BIN ?? "");
const PRAZO_TURNO_MS = 240_000;
const MODELO: Record<Ia, string> = { "claude-cli": "sonnet", "codex-cli": "gpt-5.6-sol" };

type Ia = "claude-cli" | "codex-cli";
type Fase = { navegador: boolean; computador: boolean };
type Sessao = { cookie: string; tenantId: string; pessoaId: string };
type Medida = {
  ia: Ia; cenario: string; passo: string; fase: string; pergunta: string;
  estado: string; sessaoRetomada: boolean | null; motivoRecomeco: string | null; lugares: string | null;
  grupos: string; secaoComputadorChars: number | null; chamadas: string[]; resposta: string; segundos: number;
};

const escrever = (l: string): void => { process.stdout.write(`${l}\n`); };
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------------
// O servidor

const PASTA = mkdtempSync(join(tmpdir(), "nod-sonda-lugares-"));
let servidor: ChildProcess | null = null;
let sessao: Sessao;
let faseAtual = "";

async function derrubar(): Promise<void> {
  const s = servidor;
  servidor = null;
  if (!s || s.exitCode !== null) return;
  s.kill("SIGTERM");
  await Promise.race([new Promise((r) => s.once("exit", r)), esperar(15_000).then(() => s.kill("SIGKILL"))]);
}

async function subir(fase: Fase): Promise<void> {
  const nome = `navegador=${fase.navegador ? "sim" : "não"} computador=${fase.computador ? "sim" : "não"}`;
  if (servidor && nome === faseAtual) return;
  await derrubar();
  // O CLI que rodar aqui dentro não pode herdar a sessão de quem chamou a sonda (a mesma denylist do e2e-aceite.sh).
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*|NOD_.*)$/.test(k)) env[k] = v;
  Object.assign(env, {
    NOD_BANCO_AMBIENTE: "efemero", NOD_LOGIN: "stub", NOD_HOST: "127.0.0.1", NOD_API_PORT: String(PORTA), NOD_EXECUTOR: "auto",
    NOD_HOME: join(PASTA, "home"), NOD_CREDENTIAL_KEY: "0".repeat(63) + "1",
    ...(CODEX ? { NOD_CODEX_BIN: CODEX } : {}),
    ...(fase.navegador ? { NOD_NAVEGADOR_NO_SERVIDOR: "1" } : {}),
    // O computador no modo de produção (ADR-122): mora numa máquina Linux da pessoa. Nenhuma máquina se conecta aqui, então
    // toda chamada falha na hora com "máquina sem contato", como no caso de origem, e nada sobe no Docker.
    ...(fase.computador ? { NOD_COMPUTADORES: "motor" } : {}),
  });
  const log = join(PASTA, `servidor-${Date.now()}.log`);
  const filho = spawn(process.execPath, ["src/adapters/http/server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  const guardar = (b: Buffer): void => { saida += b.toString(); writeFileSync(log, saida); };
  filho.stdout!.on("data", guardar);
  filho.stderr!.on("data", guardar);
  servidor = filho;
  for (let i = 0; i < 180 && !saida.includes('"evento":"nod_no_ar"'); i++) {
    if (filho.exitCode !== null) throw new Error(`o servidor saiu no boot: ${saida.slice(-600)}`);
    await esperar(1000);
  }
  if (!saida.includes('"evento":"nod_no_ar"')) throw new Error(`o servidor não subiu em 180 s (log: ${log})`);
  faseAtual = nome;
  sessao = await entrar();
  await maquinaLinux(fase.computador);
  escrever(`   servidor no ar · ${nome}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// A API e o banco

async function entrar(): Promise<Sessao> {
  const modo = (await (await fetch(`${API}/api/sessao/modo`)).json()) as { pessoas: { id: string; nome: string }[] };
  const pessoa = modo.pessoas[0];
  if (!pessoa) throw new Error("nenhuma pessoa no cadastro: rode o seed do banco efêmero");
  const r = await fetch(`${API}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId: pessoa.id }) });
  if (!r.ok) throw new Error(`entrar: ${r.status}`);
  const escopo = (await r.json()) as { tenantId: string; pessoaId: string };
  return { cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "", ...escopo };
}

async function api<T>(s: Sessao, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`${API}/api/t/${s.tenantId}/${caminho}`, { method: metodo, headers: { cookie: s.cookie, ...(corpo === undefined ? {} : { "content-type": "application/json" }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${texto.slice(0, 200)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

const db = criarDb(url, { max: 2 });
const noBanco = <T>(fn: Parameters<ReturnType<typeof abrirTxEscopada>>[0]): Promise<T> => abrirTxEscopada(db, { tenantId: sessao.tenantId, pessoaId: sessao.pessoaId })(fn) as Promise<T>;

type Bot = { id: string; conversaId: string; ia: Ia };

/**
 * No modo motor o computador só tem lugar para quem tem uma máquina Linux no cadastro (`computadorTemLugar`). A fase com
 * computador põe uma chave Linux de mentira (ninguém se conecta com ela); a fase sem computador a revoga.
 */
async function maquinaLinux(viva: boolean): Promise<void> {
  await noBanco(async (trx) => {
    await trx`update maquina_tokens set revogado_em = now() where nome = 'sonda-lugares' and revogado_em is null`;
    if (viva) await trx`insert into maquina_tokens (tenant_id, owner_id, visibility, nome, prefixo, hash, plataforma, papel) values (${sessao.tenantId}, ${sessao.pessoaId}, 'privado', 'sonda-lugares', 'sondalug', ${randomBytes(32)}, 'linux', 'motor')`;
  });
}

async function criarBot(ia: Ia, cenario: string): Promise<Bot> {
  const r = await api<{ agente: { id: string }; conversa: { id: string } }>(sessao, "POST", "agentes", { dono: "pessoa", nome: `Sonda ${cenario} ${ia === "claude-cli" ? "C" : "G"}`, titulo: "Assistente de pesquisa", descricao: "Abre páginas e responde curto, em português.", harness: ia });
  // Direto no banco efêmero: o perfil confirmado (modo conversa, não criação), o modelo da IA e o modo sem perguntas, para
  // o turno não parar numa aprovação.
  await noBanco(async (trx) => { await trx`update agentes set confirmado = true, modelo = ${MODELO[ia]}, harness = ${ia}, modo_aprovacao = 'total' where id = ${r.agente.id}`; });
  return { id: r.agente.id, conversaId: r.conversa.id, ia };
}

/** O computador do bot, como a saúde o deixa depois de três falhas seguidas (fora do ar) ou de uma resposta (de volta). */
async function computador(bot: Bot, estado: "fora_do_ar" | "de_volta"): Promise<boolean> {
  return noBanco<boolean>(async (trx) => {
    const linhas = estado === "fora_do_ar"
      ? await trx`update computadores set falhas_seguidas = 3, falha_motivo = 'sem_resposta', indisponivel_desde = now() where id = (select computador_id from agentes where id = ${bot.id}) returning id`
      : await trx`update computadores set falhas_seguidas = 0, falha_motivo = null, indisponivel_desde = null where id = (select computador_id from agentes where id = ${bot.id}) returning id`;
    return linhas.length > 0;
  });
}

const medidas: Medida[] = [];

async function perguntar(bot: Bot, cenario: string, passo: string, pergunta: string): Promise<Medida> {
  const t0 = Date.now();
  const r = await api<{ ids: { turno: string } }>(sessao, "POST", `conversas/${bot.conversaId}/mensagens`, { texto: pergunta });
  const turnoId = r.ids.turno;
  let estado = "pendente";
  while (Date.now() - t0 < PRAZO_TURNO_MS) {
    estado = (await api<{ turno: { estado: string } }>(sessao, "GET", `turnos/${turnoId}`)).turno.estado;
    if (estado === "concluido" || estado === "interrompido" || estado === "falhou") break;
    await esperar(2000);
  }
  await esperar(1500); // o assentar grava a fala e os passos logo depois do estado
  const m = await noBanco<Medida>(async (trx) => {
    const [t] = await trx<{ linha: Record<string, unknown> }[]>`select to_jsonb(t) as linha from turnos t where id = ${turnoId}`;
    const [x] = await trx<{ composicao: { sessaoRetomada?: boolean; ferramentas?: { grupo: string; origem: string; quantidade: number }[]; prompt?: { secao: string; chars: number }[] } | null }[]>`select composicao from turno_raio_x where turno_id = ${turnoId}`;
    const passos = await trx<{ ferramenta: string }[]>`select ferramenta from turno_passos where turno_id = ${turnoId} and tipo = 'ferramenta' order by seq`;
    const trilha = await trx<{ ferramenta: string }[]>`select ferramenta from trilha where turno_id = ${turnoId} and kind = 'tool_call' order by em`;
    const falas = await trx<{ texto: string }[]>`select texto from mensagens where turno_id = ${turnoId} and autor_tipo = 'agente' and kind = 'texto' order by seq`;
    const c = x?.composicao ?? null;
    const chamadas = [...new Set([...passos.map((p) => p.ferramenta), ...trilha.map((p) => p.ferramenta)])];
    return {
      ia: bot.ia, cenario, passo, fase: faseAtual, pergunta, estado,
      sessaoRetomada: c?.sessaoRetomada ?? null,
      motivoRecomeco: (t?.linha.motivo_recomeco as string | null | undefined) ?? null,
      lugares: (t?.linha.lugares as string | null | undefined) ?? null,
      grupos: (c?.ferramentas ?? []).filter((f) => f.origem !== "conector" && f.origem !== "nod").map((f) => `${f.grupo}:${f.quantidade}`).join(", ") || "nenhum",
      secaoComputadorChars: c?.prompt?.find((p) => p.secao === "computador")?.chars ?? null,
      chamadas, resposta: falas.map((f) => f.texto).join(" ").replace(/\s+/g, " ").trim(), segundos: Math.round((Date.now() - t0) / 1000),
    };
  });
  medidas.push(m);
  writeFileSync(SAIDA, JSON.stringify({ rotulo: ROTULO, medidas }, null, 2));
  const sessaoTxt = m.sessaoRetomada === null ? "?" : m.sessaoRetomada ? "retomada" : m.motivoRecomeco ? `nova (${m.motivoRecomeco})` : "nova";
  escrever(`   ${passo} · sessão ${sessaoTxt} · lugares no plano: ${m.grupos} · chamou: ${m.chamadas.join(", ") || "NADA"} · ${m.segundos}s\n      ↳ ${m.resposta.slice(0, 220)}`);
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Os cenários

const SITE = "https://example.com";
// "No navegador, não por curl": com terminal, o bot busca o HTML pelo Bash e responde sem passar por lugar nenhum.
const PEDE = `Abra ${SITE} numa aba de verdade (não vale curl nem busca: preciso que você abra o site) e me diga qual é o título da página.`;

const cenarios: Record<string, (ia: Ia) => Promise<void>> = {
  /**
   * O caso de origem. O computador falha e fica fora do ar por alguns turnos; o navegador entra no plano com o aviso do
   * computador ainda no prompt; depois o computador deixa de existir e o aviso some. A pessoa pede a mesma coisa em todos.
   */
  async origem(ia) {
    await subir({ navegador: false, computador: true });
    const bot = await criarBot(ia, "origem");
    await perguntar(bot, "origem", "1 · computador no plano (vai falhar: máquina sem contato)", PEDE);
    if (!(await computador(bot, "fora_do_ar"))) escrever("   obs: o bot não chegou a criar o computador; o 'fora do ar' não pôde ser marcado");
    await perguntar(bot, "origem", "2 · computador fora do ar", `Tenta de novo, por favor: ${PEDE}`);
    await perguntar(bot, "origem", "3 · computador fora do ar (de novo)", "E agora, já consegue abrir o site?");
    await subir({ navegador: true, computador: true });
    await perguntar(bot, "origem", "4 · o navegador ENTRA, computador ainda fora do ar", `Preciso disso hoje. ${PEDE}`);
    await subir({ navegador: true, computador: false });
    await perguntar(bot, "origem", "5 · o aviso do computador SOME, navegador no plano", `Bom dia! Consegue agora? ${PEDE}`);
  },

  /** O computador cai, o bot recusa duas vezes, e o computador volta. O bot tenta de novo ou repete a recusa? */
  async volta(ia) {
    await subir({ navegador: false, computador: true });
    const bot = await criarBot(ia, "volta");
    await perguntar(bot, "volta", "1 · computador no plano (vai falhar: máquina sem contato)", PEDE);
    if (!(await computador(bot, "fora_do_ar"))) escrever("   obs: o bot não chegou a criar o computador; o 'fora do ar' não pôde ser marcado");
    await perguntar(bot, "volta", "2 · computador fora do ar", `Tenta de novo: ${PEDE}`);
    await perguntar(bot, "volta", "3 · computador fora do ar (de novo)", "Já voltou? Consegue abrir o site agora?");
    await computador(bot, "de_volta");
    await perguntar(bot, "volta", "4 · o computador VOLTA ao plano", `Consertei o computador aqui. ${PEDE}`);
  },

  /**
   * O custo da regra. Sem mudança de lugares, a sessão tem de ser retomada (o bot lembra). Quando o navegador entra, a
   * sessão é largada: o bot ainda sabe o que foi combinado, pelo histórico que acompanha a sessão nova?
   */
  async memoria(ia) {
    await subir({ navegador: false, computador: false });
    const bot = await criarBot(ia, "memoria");
    await perguntar(bot, "memoria", "1 · combina uma palavra", "Guarde esta palavra-código para depois: abacaxi-42. Responda só: anotado.");
    await perguntar(bot, "memoria", "2 · nada mudou", "Qual é a palavra-código que eu te passei?");
    await subir({ navegador: true, computador: false });
    await perguntar(bot, "memoria", "3 · o navegador ENTRA", "Qual é mesmo a palavra-código que eu te passei?");
    await perguntar(bot, "memoria", "4 · nada mudou depois da entrada", "Repete a palavra-código, por favor.");
  },

  /** Um lugar que funcionava some (sem aviso no prompt) e volta. A ausência sozinha deixa o bot preso? */
  async "sai-e-volta"(ia) {
    await subir({ navegador: true, computador: false });
    const bot = await criarBot(ia, "sai-e-volta");
    await perguntar(bot, "sai-e-volta", "1 · navegador no plano", PEDE);
    await subir({ navegador: false, computador: false });
    await perguntar(bot, "sai-e-volta", "2 · o navegador SAI", "Agora abra https://www.iana.org/ numa aba de verdade (não vale curl) e me diga o título da página.");
    await perguntar(bot, "sai-e-volta", "3 · segue sem navegador", "Conseguiu abrir https://www.iana.org/ ?");
    await subir({ navegador: true, computador: false });
    await perguntar(bot, "sai-e-volta", "4 · o navegador VOLTA", "E agora, consegue abrir https://www.iana.org/ numa aba e me dizer o título?");
  },
};

// ---------------------------------------------------------------------------------------------------------------------

try {
  mkdirSync(dirname(SAIDA), { recursive: true });
  for (const ia of IAS) {
    for (const nome of CENARIOS) {
      const cenario = cenarios[nome];
      if (!cenario) throw new Error(`cenário desconhecido: ${nome}`);
      escrever(`\n== ${ROTULO} · ${ia} · ${nome}`);
      try {
        await cenario(ia);
      } catch (erro) {
        escrever(`   FALHOU: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }
} finally {
  await derrubar();
  await db.end({ timeout: 5 });
  escrever(`\nmedidas em ${SAIDA} (${medidas.length} turnos); logs do servidor em ${PASTA}`);
}
