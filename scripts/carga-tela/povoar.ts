// Povoa um banco no tamanho da conta de produção que travava (2026-11-19): 40 bots da pessoa, conversas longas e quadros
// com mais de 150 tarefas. Tudo pela API com o catcher (custo zero), pelos mesmos caminhos do app — turnos, mensagens,
// eventos —, nunca por INSERT. Idempotente: completa o que falta (bots, trocas e tarefas já contadas) em vez de duplicar.
//
//   CARGA_BANCO_PORTA=5440 CARGA_API_PORTA=8897 node scripts/carga-tela/povoar.ts [pessoa]
//
// Nunca no banco diário (5434). A pessoa é a do login stub (padrão: a primeira do cadastro com o nome pedido).
// Tamanho por ambiente: POVOAR_BOTS (40), POVOAR_LONGAS (6 conversas com POVOAR_TROCAS_LONGAS=250 trocas),
// POVOAR_TROCAS (40 nas outras), POVOAR_QUADROS (3 quadros com POVOAR_TAREFAS=160 tarefas), POVOAR_PARALELO (6).
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, CONFIG, entrar, escrever, respostaRica, urlWeb, type Sessao } from "./comum.ts";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const BOTS = Number(process.env.POVOAR_BOTS ?? 40);
const LONGAS = Number(process.env.POVOAR_LONGAS ?? 6);
const TROCAS_LONGAS = Number(process.env.POVOAR_TROCAS_LONGAS ?? 250);
const TROCAS = Number(process.env.POVOAR_TROCAS ?? 40);
const QUADROS = Number(process.env.POVOAR_QUADROS ?? 3);
const TAREFAS = Number(process.env.POVOAR_TAREFAS ?? 160);
const PARALELO = Number(process.env.POVOAR_PARALELO ?? 6);
const PREFIXO = "Prod ";
/** As colunas do quadro padrão (src/contracts/quadro.ts) menos "voce", em que a tarefa espera a pessoa. */
const COLUNAS = ["backlog", "afazer", "fazendo", "revisao", "bloqueado", "feito", "cancelado"] as const;
const TITULOS = ["Revisar o contrato do fornecedor", "Fechar o relatório mensal", "Responder o cliente sobre o prazo", "Atualizar a planilha de custos", "Preparar a apresentação da diretoria", "Conferir as notas fiscais", "Migrar os dados do CRM", "Agendar a reunião com o time", "Corrigir o bug do checkout", "Escrever a documentação da API"];

type BotApi = { id: string; nome: string; conversaId: string; ownerId: string };

if (CONFIG.bancoPorta === 5434) throw new Error("povoar: a porta 5434 é a do banco diário — use um banco efêmero");

async function subirApi(): Promise<ChildProcess> {
  const p = spawn(process.execPath, [join(AQUI, "servidor.ts")], { env: process.env, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await fetch(`${urlWeb()}/api/sessao/modo`)).ok) return p;
    } catch {
      // subindo
    }
  }
  p.kill("SIGTERM");
  throw new Error(`a API não subiu em ${urlWeb()}`);
}

async function meusBots(s: Sessao): Promise<BotApi[]> {
  const f = await api<{ agentes: BotApi[] }>(s, "GET", "frota");
  return f.agentes.filter((a) => a.ownerId === s.pessoaId && a.nome.startsWith(PREFIXO)).sort((a, b) => a.nome.localeCompare(b.nome));
}

async function ocioso(s: Sessao, conversaId: string): Promise<number> {
  for (;;) {
    const c = await api<{ turnosEmCurso?: unknown[]; mensagens?: unknown[] }>(s, "GET", `conversas/${conversaId}/mensagens`);
    if ((c.turnosEmCurso?.length ?? 0) === 0) return c.mensagens?.length ?? 0;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Trocas que a conversa já tem (pessoa + bot por troca), pela contagem do servidor — a API devolve só as 200 últimas. */
async function trocasFeitas(s: Sessao, bot: BotApi): Promise<number> {
  const c = await api<{ mensagens?: { texto?: string }[]; temMais?: boolean }>(s, "GET", `conversas/${bot.conversaId}/mensagens`);
  const ultima = [...(c.mensagens ?? [])].reverse().find((m) => /^Rodada \d+:/.test(m.texto ?? ""));
  return ultima ? Number(/^Rodada (\d+):/.exec(ultima.texto ?? "")?.[1] ?? -1) + 1 : 0;
}

async function conversar(s: Sessao, bot: BotApi, alvo: number): Promise<void> {
  const ja = await trocasFeitas(s, bot);
  for (let i = ja; i < alvo; i++) {
    await api(s, "POST", `conversas/${bot.conversaId}/mensagens`, { texto: `Rodada ${i}: me dá o panorama dos PRs e do deploy. [[delta: Olhando… ]] [[texto: ${respostaRica(i)}]]` });
    await ocioso(s, bot.conversaId);
  }
  escrever(`povoar: ${bot.nome} com ${alvo} trocas (${alvo - ja} novas)`);
}

async function quadro(s: Sessao, bot: BotApi): Promise<void> {
  try {
    await api(s, "POST", `agentes/${bot.id}/quadro`, { nome: `Quadro ${bot.nome}` });
  } catch {
    // já existe
  }
  const { quadro: q } = await api<{ quadro: { tarefas: unknown[] } | null }>(s, "GET", `agentes/${bot.id}/quadro`);
  const ja = q?.tarefas.length ?? 0;
  for (let i = ja; i < TAREFAS; i++) {
    const titulo = `${TITULOS[i % TITULOS.length]} (${i + 1})`;
    await api(s, "POST", `agentes/${bot.id}/quadro/tarefas`, { titulo, status: COLUNAS[i % COLUNAS.length], agente: null });
  }
  escrever(`povoar: quadro de ${bot.nome} com ${TAREFAS} tarefas (${Math.max(0, TAREFAS - ja)} novas)`);
}

/** Roda `fn` em cada item com no máximo `n` ao mesmo tempo. */
async function emLotes<T>(itens: readonly T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const fila = [...itens];
  await Promise.all(Array.from({ length: Math.min(n, fila.length) }, async () => {
    for (let x = fila.shift(); x !== undefined; x = fila.shift()) await fn(x);
  }));
}

const processo = await subirApi();
try {
  const s = await entrar(process.argv[2] ?? "Marlon");
  await api(s, "PUT", "preferencias", { experimentos: { quadro: true } });
  const existentes = new Set((await meusBots(s)).map((b) => b.nome));
  for (let i = 1; i <= BOTS; i++) {
    const nome = `${PREFIXO}${String(i).padStart(2, "0")}`;
    if (!existentes.has(nome)) await api(s, "POST", "agentes", { dono: "pessoa", nome });
  }
  const bots = await meusBots(s);
  escrever(`povoar: ${bots.length} bots "${PREFIXO}NN" de ${s.pessoaId.slice(0, 8)}…`);
  const inicio = Date.now();
  // As longas primeiro (são as que demoram), em paralelo com as curtas.
  await emLotes(bots, PARALELO, (b) => conversar(s, b, bots.indexOf(b) < LONGAS ? TROCAS_LONGAS : TROCAS));
  await emLotes(bots.slice(0, QUADROS), 1, (b) => quadro(s, b));
  escrever(`povoar: pronto em ${Math.round((Date.now() - inicio) / 1000)} s`);
} finally {
  processo.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
}
